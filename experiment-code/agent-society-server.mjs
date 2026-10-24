import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const scenarioLogDir = join(root, "scenario-logs");
const finalScriptDir = join(root, "final-scripts");
const port = Number(process.env.PORT || 4876);
// 多 key 轮换:某个 key 撞到日配额(超长 retry-after)就自动换下一个,等于把免费档每日额度叠加。
// 来源:OPENAI_API_KEYS(逗号/空格分隔) + OPENAI_API_KEY + OPENAI_API_KEY_2/3/…,去重。
const apiKeys = (() => {
  const out = [];
  // 只收形如真实 key 的串(字母数字/下划线/连字符);挡掉未替换的中文占位符"在这里粘贴…"。
  const push = (v) => String(v || "").split(/[,\s]+/).map((s) => s.trim()).filter((k) => /^[A-Za-z0-9_-]{16,}$/.test(k)).forEach((k) => out.push(k));
  push(process.env.OPENAI_API_KEYS);
  push(process.env.OPENAI_API_KEY);
  for (const k of Object.keys(process.env)) if (/^OPENAI_API_KEY_\d+$/.test(k)) push(process.env[k]);
  return [...new Set(out)];
})();
let apiKeyCursor = 0;
const activeApiKey = () => apiKeys[apiKeyCursor] || "";
const rotateApiKey = () => { apiKeyCursor = (apiKeyCursor + 1) % Math.max(1, apiKeys.length); return activeApiKey(); };
const apiKey = apiKeys[0] || ""; // 仍作"是否有任何 key"的判据(各处 if(apiKey) 用)
// 输出语言开关:OUTPUT_LANG=en 让成片用英文;默认中文。同时承载"语体"指令(古雅/克制、避现代口语词)。
const outputLang = (process.env.OUTPUT_LANG || "zh").toLowerCase() === "en" ? "en" : "zh";
const sceneLangWord = outputLang === "en" ? "英文(natural literary English)" : "中文";
const dlgColon = outputLang === "en" ? ": " : "："; // 对白「说话人: 台词」的冒号,按语言切半角/全角

// 滴答时钟:已知本场预计总回合(SCENE_TOTAL_TURNS,export 会传 EXPORT_TURNS)时,后段逐步加压,
// 让"干等"变成最坏选项 → 由 agent 自己做出不可逆动作来打破僵局(而不是让总编凭空造结局)。
const sceneTotalTurns = Number(process.env.SCENE_TOTAL_TURNS) || 0;
// B′ 配置:只描述世界内部、开放性、非定向的环境变化(diegetic pressure)。
// 它改变"行动的条件与等待的代价",但【绝不】要求任何人动手、逃离、或结束场景——
// 结局只能从角色自己的选择里长出来。等待、拒绝、维持对峙都是合法的。
function escalationDirective() {
  if (!sceneTotalTurns) return "";
  const p = (state && state.world ? state.world.turn : 0) / sceneTotalTurns;
  if (p < 0.4) return "";
  if (outputLang === "en") {
    return "[The world shifts] Time passes in the grove: the light fails, the rain comes and goes, distant voices or the stirring horse draw nearer, the rope softens in the wet, the mud deepens. These change what is now easy and what is costly. They do NOT require anyone to act, strike, flee, or end the scene — a character may wait, refuse, or sustain the standoff. Any change must come only from what a character chooses.";
  }
  return "【世界在变】竹林里时间在流逝:光线渐暗、雨忽来忽止、远处人声或躁动的马渐近、绳结被雨水泡得发软、泥泞更深。这些改变了此刻「做什么容易、等待要付什么代价」,但【绝不】要求任何人动手、逃离或结束场景——角色可以等待、拒绝、维持对峙。任何变化都只能来自角色自己的选择。";
}
const langDirective = outputLang === "en"
  ? "OUTPUT LANGUAGE = ENGLISH. Write EVERY free-text field you produce — dialogue, stage directions, intents, what-you-hide/reveal, subtext, descriptions — in natural, literary English with a period-appropriate register. Output no Chinese characters at all. Keep character names exactly as given."
  : "语体:贴合场景年代的书面语。若为古代/历史设定,用偏古雅、克制的语体,避免现代口语词(如'筹码''档子事''搞定''没事儿'等)。";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const scenarioModel = process.env.SCENARIO_MODEL || model;
const directorModel = process.env.DIRECTOR_MODEL || process.env.AGENT_MODEL || model;
const agentModel = process.env.AGENT_MODEL || model;
const batchAgentModel = process.env.BATCH_AGENT_MODEL || agentModel;
const repairModel = process.env.REPAIR_MODEL || agentModel;
const scriptModel = process.env.SCRIPT_MODEL || scenarioModel;
const batchAgentCalls = process.env.AGENT_BATCH_CALLS === "1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));
const nowIso = () => new Date().toISOString();

function minutesToClock(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clockToMinutes(clock, fallbackMinutes = 22 * 60 + 15) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock || "").trim());
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return fallbackMinutes;
  // 不做 24 取模:"24:00" 应当保留为 1440(午夜),"29:30" 表示次日 05:30
  return h * 60 + (mm % 60);
}

function slugifyId(value, fallback) {
  const s = String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

// ---------- 内置场景预设：所有预设以"用户可编辑的输入格式"存在 ----------
// 输入字段说明见 README；后台用 buildStateFromScenario(input) 构造完整运行时 state。
const BUILTIN_PRESETS = {
  rainyStation: {
    id: "rainyStation",
    title: "雨夜候车室",
    summary: "1942 年欧洲边境小镇,三个陌生人在车站避雨;密码本在其中一人身上。",
    scenario: {
      title: "雨夜候车室",
      place: "1942 年秋,欧洲边境小镇的一间废弃火车站候车室",
      premise: "暴雨把三个陌生人困在同一个房间。桌上有一份当天报纸,火炉快熄灭,外面偶尔传来远处炮声。",
      genre: "历史悬疑 / Agent Society",
      sceneGoal: "三人都想活着、并把信息/物件按自己的目的带过边境;只有一人能真正掌控密码本。",
      centralConflict: "Anna 想藏密码本并离开;Karl 想夺回密码本;Richard 想判断谁可信并控制情报流向。"
    },
      world: {
      startClock: "22:15",
      weather: "暴雨",
      temperature: "寒冷",
      light: "煤油灯摇晃",
      threatLevel: 30,
      dangerLevel: 35,
      resources: { bread: 2, lampOil: 42, fire: 28 },
      facts: [
        "桌上摊着当天的报纸,头版被雨点打湿。",
        "候车室有两个出口:月台门和候车室正门。",
        "火炉里只剩一小堆余烬,旁边的煤桶是空的。"
      ],
      // V2 物理:位置 + 出口 + 物品
      locations: [
        { id: "main_room", label: "候车室主厅" },
        { id: "platform",  label: "雨中月台" },
        { id: "storage",   label: "储物间" }
      ],
      defaultLocationId: "main_room",
      exits: [
        { id: "platform_door", fromLocation: "main_room", toLocation: "platform", label: "月台门",   locked: false },
        { id: "front_door",    fromLocation: "main_room", toLocation: "outside",  label: "候车室正门", locked: false },
        { id: "storage_door",  fromLocation: "main_room", toLocation: "storage",  label: "储物间侧门", locked: false }
      ],
      patrol: { distanceMeters: 1200 },
      train:  { departureClock: "24:00", remainingTickets: 2 },
      items: [
        // 公开可见的物品(hidden:false)
        { id: "newspaper", label: "湿报纸", contents: "头版讲边境部队调动,第三版背后夹着一张三人同行的旧照片", location: "main_room", hidden: false, triggers: ["报纸", "头版", "照片", "第三版"] },
        { id: "stove",     label: "火炉",   contents: "炉膛里的余烬还能烧 20 分钟,旁边煤桶空了",               location: "main_room", hidden: false, triggers: ["火炉", "炉子", "余烬", "煤"] },
        { id: "oil_lamp",  label: "煤油灯", contents: "煤油还剩半盏,灯芯有点抖",                                location: "main_room", hidden: false, triggers: ["煤油灯", "灯", "灯芯"] },
        // 私人持有 + 隐藏物品(必须靠 inspect/search/steal 才能拿到内容)
        { id: "anna_bag",      label: "Anna 的手提包",   contents: "夹层内有重新缝合过的痕迹,能摸到一本小书,推测是抵抗组织的密码本", location: "main_room", holder: "anna",    hidden: true, triggers: ["包", "手提包", "夹层", "本子", "密码本", "缝合"] },
        { id: "karl_lighter",  label: "Karl 的打火机",   contents: "镶银的德式打火机,刻有军徽 SS",                                       location: "main_room", holder: "karl",    hidden: true, triggers: ["打火机", "火机", "军徽", "银", "德式"] },
        { id: "karl_papers",   label: "Karl 的笔记本",   contents: "夹页里有几组用铅笔写的密钥片段和一行德文军方代号",                  location: "main_room", holder: "karl",    hidden: true, triggers: ["笔记", "本子", "铅笔", "密钥", "德文", "代号"] },
        { id: "richard_telegram", label: "Richard 内袋的纸条", contents: "一张写着英文电报码的纸条,落款是英国情报部门联络代号",          location: "main_room", holder: "richard", hidden: true, triggers: ["纸条", "电报", "英文", "内袋", "情报", "联络"] },
        { id: "richard_coins", label: "Richard 的金币", contents: "两枚足以贿赂巡逻员的英国金币",                                          location: "main_room", holder: "richard", hidden: true, triggers: ["金币", "贿赂", "钱"] },
        // 储物间藏品(需要进 storage 房间 + search 才能找到)
        { id: "old_uniform",   label: "储物间的旧制服",  contents: "一件挂在挂钩上的旧德军制服,口袋里掉出半张通行证",                  location: "storage",   hidden: true, triggers: ["制服", "挂钩", "通行证", "口袋"] }
      ],
      deadlines: [
        { id: "border_close",  label: "边境关闭",        clock: "23:00" },
        { id: "patrol_arrive", label: "巡逻队抵达车站",  clock: "23:30" },
        { id: "last_train",    label: "最后一班火车",    clock: "24:00" }
      ],
      hiddenClues: [
        { id: "photo_in_paper",    label: "夹在报纸里的照片",    contents: "报纸第三版背后夹着一张三人同行的旧照片" },
        { id: "shoulder_bag_seam", label: "Anna 包的夹层缝迹",   contents: "Anna 手提包内层有重新缝合过的痕迹" },
        { id: "german_lighter",    label: "德式打火机",          contents: "Karl 的口袋里露出过一只刻有军徽的打火机" },
        { id: "british_telegram",  label: "英国电报码",          contents: "Richard 外套内袋有一张写着英文电报码的纸条" }
      ],
      unresolvedTensions: [
        "谁真的在等火车,谁在等别的东西?",
        "三人谁的身份会先撑不住?",
        "密码本到底在谁手里?"
      ]
    },
    agents: [
      {
        id: "karl", name: "Karl Weiss", role: "数学家", age: 48,
        archetype: "理性克制的德国数学教授",
        publicIdentity: "德国来的数学教授,声称自己只是在边境转车。",
        hiddenIdentity: "德军密码分析部门顾问,奉命追回一本失踪的密码本。",
        personality: "理性、克制、信奉概率与逻辑;情急时会把道德问题转换成数字。",
        backstory: "在大学教了二十年数学。战争开始后被迫为军方提供分析。儿子在东线服役,已两个月没有来信。",
        values: ["真理", "理性", "保护家人", "不让学术沦为武器"],
        shortTermGoal: "在 23:00 边境关闭前找出谁拿了密码本,并取回它。",
        longTermGoal: "活着穿过边境,找到儿子的消息。",
        fears: ["儿子战死", "未能完成任务被军法处置", "在边境被识破身份"],
        speechStyle: "短句、精确、避免情绪化;紧张时把伦理问题转成数学问题。",
        behaviorStyle: "观察细节、折叠报纸、避开直接承诺;用问题代替断言。",
        currentAction: "假装在等转车,悄悄观察另外两人随身物品的轮廓。",
        nextIntendedAction: "找机会单独接近 Anna 的包,或试探 Richard 是否在保护谁。",
        resources: ["伪造的学者证件", "口袋里的小型电报联络指令", "记忆中的几组密钥片段"],
        knownFacts: ["今天 23:00 边境会因军事检查关闭", "失踪的密码本最后一次出现在这一带"],
        initialSuspicions: { anna: 55, richard: 40 },
        status: { fear: 42, suspicion: 44, guilt: 58, resolve: 61, fatigue: 28 },
        secrets: [
          { id: "cipher", label: "密码学项目 / 密码本任务",
            content: "Karl 是德军密码分析顾问,正在追查一本失踪的密码本。",
            triggers: ["密码", "破译", "通讯", "情报", "电报", "解密", "波段", "密本"] },
          { id: "son", label: "前线儿子",
            content: "Karl 的儿子在东线失联两个月。",
            triggers: ["儿子", "孩子", "家人", "东线", "前线", "失联", "家书", "战死"] }
        ]
      },
      {
        id: "anna", name: "Anna Moreau", role: "文学家", age: 35,
        archetype: "敏锐、警惕、带着流亡创伤的法国小说家",
        publicIdentity: "巴黎沦陷后流亡的法国小说家,正在寻找去南方的路。",
        hiddenIdentity: "法国抵抗组织联络员,包里藏着一本密码本,必须在清晨前送过边境。",
        personality: "聪明、警觉、用隐喻代替直说;用文学话题做掩护,会在最后一刻才承认。",
        backstory: "她的书被审查,朋友被捕。学会了用隐喻说真话,也学会了在陌生人面前撒谎。",
        values: ["自由", "语言的尊严", "人的复杂性", "反抗"],
        shortTermGoal: "在 00:00 最后一班火车前把密码本送过边境,绝不能被搜身。",
        longTermGoal: "把密码本送到南方,继续写作并保住同伴。",
        fears: ["被搜身", "暴露密码本", "再次看见朋友被带走"],
        speechStyle: "带隐喻和刺,善于用问题逼对方表态;情绪强时更锋利。",
        behaviorStyle: "护住手提包,观察对方眼神和手;借文学话题谈政治。",
        currentAction: "把手提包夹在膝间,用一本旧诗集做掩护。",
        nextIntendedAction: "判断 Karl 是不是德国情报人员,必要时换车厢或销毁包夹层。",
        resources: ["手提包夹层里的密码本", "一份伪造法国通行证", "一个能藏纸条的烟盒"],
        knownFacts: ["00:00 最后一班南下火车经过本站", "23:30 巡逻队会从月台门进入候车室"],
        initialSuspicions: { karl: 70, richard: 50 },
        status: { fear: 63, suspicion: 66, guilt: 21, resolve: 74, fatigue: 35 },
        secrets: [
          { id: "cipher_book", label: "随身密码本",
            content: "Anna 的手提包夹层里藏着一本抵抗组织的密码本。",
            triggers: ["密码", "本子", "包", "夹层", "抵抗", "组织", "联络", "暗号", "搜身"] },
          { id: "press", label: "地下文章",
            content: "Anna 写过反占领宣传文章。",
            triggers: ["文章", "写作", "占领", "宣传", "审查", "笔名", "印刷", "禁书"] }
        ]
      },
      {
        id: "richard", name: "Richard Bell", role: "政治家", age: 56,
        archetype: "礼貌、老练、相信结果高于纯洁性的英国议员",
        publicIdentity: "英国议员,正在前往一次外交会面。",
        hiddenIdentity: "英国情报联络官,受命确认密码本由谁持有,并保证它不落入德军手中。",
        personality: "外交化、克制、习惯把尖锐问题转成原则;压力大时变得命令式。",
        backstory: "见过太多迟疑造成的失败,他用大局压过个人痛苦——可他并非没有良知,只是不愿承认。",
        values: ["国家利益", "秩序", "战略耐心", "可承受的代价"],
        shortTermGoal: "判断 Karl 与 Anna 谁是携密人,必要时控制密码本的去向。",
        longTermGoal: "让英国在谈判中取得情报优势,避免会面被破坏。",
        fears: ["战争失败", "过去的争议行动被揭开", "失去对密码本去向的控制"],
        speechStyle: "外交辞令、克制;用原则化语言推动议程,紧张时变得命令式。",
        behaviorStyle: "靠近门口,安排秩序,让别人按他的节奏说话。",
        currentAction: "故意把外套搭在椅背,挡住自己内袋里的联络笔记。",
        nextIntendedAction: "用闲谈引出对方背景,把怀疑导向其中一人,伺机控制局面。",
        resources: ["伪装外交包内的联络笔记", "三张事先备好的车票", "两枚能贿赂巡逻员的金币"],
        knownFacts: ["23:30 巡逻队会进站搜检", "失踪的密码本可能就在本候车室"],
        initialSuspicions: { karl: 60, anna: 55 },
        status: { fear: 38, suspicion: 54, guilt: 47, resolve: 68, fatigue: 31 },
        secrets: [
          { id: "operation", label: "争议行动",
            content: "Richard 支持过一次导致平民伤亡的军事行动。",
            triggers: ["平民", "伤亡", "行动", "委员会", "报告", "投票", "命令", "良心"] },
          { id: "meeting", label: "秘密会面",
            content: "Richard 正前往一次不公开的边境会面。",
            triggers: ["会面", "外交", "谈判", "边境", "议程", "代号", "中立国", "密使"] }
        ]
      }
    ]
  },

  marsCabin: {
    id: "marsCabin",
    title: "火星舱室断电夜",
    summary: "近未来火星基地三人科考队;主舱断电、与地球失联,氧气只够一人撑到救援。",
    scenario: {
      title: "火星舱室断电夜",
      place: "2049 年,火星基地 7 号生活舱,舱外正在沙暴",
      premise: "主电源在 04:12 切断,三人被锁在生活舱里。备用氧气只够一人撑到 06:30 救援队抵达。",
      genre: "科幻悬疑 / Agent Society",
      sceneGoal: "查明断电是事故还是蓄意,并决定让谁活下去。",
      centralConflict: "三人各有秘密:一人在偷偷怀孕、一人接到了破坏任务的密令、一人手握 AI 的最高权限。"
    },
    world: {
      startClock: "04:30",
      weather: "舱外火星沙暴",
      temperature: "舱内 12°C 且在下降",
      light: "应急红灯",
      threatLevel: 60,
      dangerLevel: 55,
      resources: { bread: 6, lampOil: 0, fire: 0 },
      facts: [
        "主电源在 04:12 被远程切断,日志被擦除。",
        "舱外通讯天线被沙暴吹歪,无法呼救。",
        "备用氧气剩约 2 小时,只够一个人撑到救援。"
      ],
      // V2 物理
      locations: [
        { id: "living_cabin", label: "生活舱主厅" },
        { id: "tool_room",   label: "工具间" },
        { id: "comms_room",  label: "通讯舱" }
      ],
      defaultLocationId: "living_cabin",
      exits: [
        { id: "tool_door",  fromLocation: "living_cabin", toLocation: "tool_room",  label: "工具间气密门", locked: false },
        { id: "comms_door", fromLocation: "living_cabin", toLocation: "comms_room", label: "通讯舱门",     locked: false },
        { id: "airlock",    fromLocation: "living_cabin", toLocation: "outside",    label: "出舱气闸",     locked: true }
      ],
      items: [
        { id: "control_panel", label: "主控制面板",   contents: "主电源日志被擦除,但电池剩 7%,旁边有一行刚被改写的命令记录", location: "living_cabin", hidden: false, triggers: ["控制面板", "主控", "日志", "电源"] },
        { id: "ai_terminal",   label: "AI 终端",       contents: "AI 已请求伦理仲裁:谁应优先获得剩余氧气",                       location: "living_cabin", hidden: false, triggers: ["AI", "终端", "仲裁", "氧气"] },
        { id: "hidden_o2",     label: "私藏氧气罐",   contents: "工具间角落塞着一只氧气罐,贴着 Liu 的私人编号",                  location: "tool_room",    hidden: true, triggers: ["氧气罐", "氧气", "罐", "角落", "私藏"] },
        { id: "mei_notebook",  label: "Mei 的笔记本", contents: "夹着一封写给未出生孩子的信,日期是今天",                          location: "living_cabin", holder: "mei",     hidden: true, triggers: ["笔记本", "信", "孩子", "日期"] },
        { id: "liu_terminal",  label: "Liu 的私人终端", contents: "通讯记录里有一条加密指令:'让任务失败,但要看起来是事故'",     location: "living_cabin", holder: "liu",     hidden: true, triggers: ["私人终端", "通讯", "密令", "指令", "加密"] },
        { id: "ahmed_recorder", label: "Ahmed 的录音机", contents: "过去 30 分钟所有对话都被存档,文件名是参与者编号",                location: "living_cabin", holder: "ahmed",   hidden: true, triggers: ["录音机", "录音", "存档", "文件"] }
      ],
      deadlines: [
        { id: "co2_alert",  label: "CO₂ 浓度报警",     clock: "05:30" },
        { id: "rescue",     label: "救援队抵达",       clock: "06:30" },
        { id: "cold_alert", label: "舱温降到致死线",   clock: "07:00" }
      ],
      hiddenClues: [
        { id: "log_wiped",       label: "断电日志被擦除", contents: "主电源日志在断电前 30 秒被一条远程命令擦除。" },
        { id: "extra_oxygen",    label: "私藏氧气罐",     contents: "工具间角落塞着一只额外的氧气罐,贴着私人编号。" },
        { id: "sealed_letter",   label: "未发出的信",     contents: "Mei 的笔记本里夹着一封写给孩子的信,日期是今天。" },
        { id: "sabotage_order",  label: "破坏指令",       contents: "Liu 的私人通讯里有一条加密指令:'让任务失败,但要看起来是事故'。" }
      ],
      unresolvedTensions: [
        "断电是天灾还是人祸?",
        "谁愿意把氧气让出来?",
        "如果说出真相,自己会先被孤立吗?"
      ]
    },
    agents: [
      {
        id: "mei", name: "Sun Mei", role: "生命科学家", age: 33,
        archetype: "外柔内韧,把自己放在最后的科学家",
        publicIdentity: "中国天体生物学家,负责火星菌群实验。",
        hiddenIdentity: "Mei 已怀孕 11 周,任务前没有上报,如今独自承担风险。",
        personality: "外柔内韧,善于隐藏情绪;在伦理面前会突然强硬。",
        backstory: "上一次任务她错过了母亲的最后一面,这次出发前刚验出怀孕。",
        values: ["孩子", "科学诚信", "团队"],
        shortTermGoal: "活到 06:30 救援抵达,孩子是底线。",
        longTermGoal: "把怀孕事实告诉队伍并保住孩子。",
        fears: ["流产", "被开除任务资格", "孩子失去母亲"],
        speechStyle: "话不多,但句句指向行动;紧张时手会按腹部。",
        behaviorStyle: "护住实验冷箱,实际是在护住自己的身体。",
        currentAction: "用毛毯把自己和实验冷箱裹在一起,躲在通讯舱角落。",
        nextIntendedAction: "悄悄找出谁切断了电源,但不暴露怀孕。",
        resources: ["保胎药两支", "实验冷箱钥匙", "私人医疗记录卡"],
        knownFacts: ["主电源是被远程切断的,不是过载", "我不能再受寒"],
        initialSuspicions: { liu: 65, ahmed: 35 },
        status: { fear: 60, suspicion: 55, guilt: 40, resolve: 70, fatigue: 45 },
        secrets: [
          { id: "pregnancy", label: "未上报的怀孕",
            content: "Mei 怀孕 11 周,任务前没上报,身上有保胎药。",
            triggers: ["孩子", "怀孕", "身体", "寒冷", "药", "保胎", "流产", "肚子"] },
          { id: "letter", label: "写给孩子的信",
            content: "Mei 在笔记本里夹了一封写给未出生孩子的信。",
            triggers: ["信", "笔记", "遗言", "未来", "名字", "字条"] }
        ]
      },
      {
        id: "liu", name: "Liu Cheng", role: "工程主管", age: 41,
        archetype: "把错揽在自己身上的中年工程师",
        publicIdentity: "中俄联合任务的工程主管,负责能源系统。",
        hiddenIdentity: "Liu 收到地面密令:让本次任务失败,以掩盖之前一份违规数据。",
        personality: "沉稳,惯于把责任揽到自己身上,但内心已经在撤退。",
        backstory: "他曾签署过一份违规数据,如果这次任务成功,数据就会被审计发现。",
        values: ["家庭", "组织忠诚", "面子"],
        shortTermGoal: "确认断电效果是否达成,同时不让自己暴露。",
        longTermGoal: "回到地球后销毁那份违规数据。",
        fears: ["被同事识破", "回去后被审查", "破坏指令引发人命"],
        speechStyle: "工程化,喜欢用'按规程'压住别人。",
        behaviorStyle: "频繁查看自己的腕表和私人终端。",
        currentAction: "假装检修控制面板,实则在监控通讯有没有泄露指令。",
        nextIntendedAction: "找借口让大家分开,自己控制氧气分配。",
        resources: ["控制面板权限", "私人终端", "工具间钥匙"],
        knownFacts: ["主电源是我远程切的", "私藏氧气罐就在工具间角落"],
        initialSuspicions: { mei: 50, ahmed: 60 },
        status: { fear: 50, suspicion: 60, guilt: 70, resolve: 55, fatigue: 40 },
        secrets: [
          { id: "sabotage", label: "破坏任务密令",
            content: "Liu 接到指令让本次火星任务'看起来失败',以销毁违规数据。",
            triggers: ["命令", "密令", "任务", "失败", "数据", "违规", "掩盖", "上头", "组织"] },
          { id: "extra_o2", label: "私藏氧气",
            content: "Liu 在工具间私藏了一罐氧气,贴的是个人编号。",
            triggers: ["氧气", "罐", "工具间", "编号", "备用", "私藏"] }
        ]
      },
      {
        id: "ahmed", name: "Ahmed Khalifa", role: "AI 伦理审查员", age: 38,
        archetype: "克制有礼但会突然冷下来的审查官",
        publicIdentity: "联合国派出的 AI 伦理审查员,记录任务过程。",
        hiddenIdentity: "Ahmed 实际拥有舱内 AI 的最高权限,他必须决定要不要让 AI 把氧气优先分给某一个人。",
        personality: "克制,职业性礼貌,但在道德两难上会突然变得不近人情。",
        backstory: "他经手过一次因 AI 自动决策导致的事故,从此对'让机器做选择'极度警惕。",
        values: ["程序正义", "记录真实", "不让 AI 替人决定生死"],
        shortTermGoal: "弄清断电真相,并在 06:30 之前不让 AI 自动做出排序选择。",
        longTermGoal: "把这次事件如实记录回地球,即使会牵连同事。",
        fears: ["AI 自行决定让谁活", "记录被篡改", "自己被沉默"],
        speechStyle: "中性、引用条款;紧张时会引用规章号。",
        behaviorStyle: "靠近 AI 终端,手指经常停在确认键上。",
        currentAction: "把私人录音机放在膝上,每隔 5 分钟做一次记录。",
        nextIntendedAction: "在不暴露 AI 权限的前提下,逼另两人先表态。",
        resources: ["AI 最高权限令牌", "私人录音机", "联合国伦理章程纸本"],
        knownFacts: ["AI 已请求伦理仲裁:谁应优先获得剩余氧气", "断电后 AI 把决定权交给了我"],
        initialSuspicions: { liu: 70, mei: 40 },
        status: { fear: 45, suspicion: 65, guilt: 25, resolve: 70, fatigue: 30 },
        secrets: [
          { id: "ai_authority", label: "AI 最高权限",
            content: "Ahmed 是舱内 AI 的最终授权人,他可以让 AI 把氧气分给任何一个人。",
            triggers: ["AI", "权限", "授权", "分配", "仲裁", "最高", "条款", "决定"] },
          { id: "recorder", label: "私人录音",
            content: "Ahmed 在偷偷录音,每个人说的都被存档。",
            triggers: ["录音", "存档", "记录", "证据", "存证", "录"] }
        ]
      }
    ]
  },

  forensicLab: {
    id: "forensicLab",
    title: "深夜法医室",
    summary: "凌晨三点,某市法医中心解剖室;尸体口袋里的字条点名了在场的某一人。",
    scenario: {
      title: "深夜法医室",
      place: "凌晨 03:00,某市法医中心 B2 解剖室,门禁已封锁",
      premise: "尸体身上有一张写给在场某人的字条。监控视频在 02:50 被切断。距交班还有 2 小时。",
      genre: "现代悬疑 / Agent Society",
      sceneGoal: "在交班前查清死者身份与字条意图,决定是否让此事进入正式报告。",
      centralConflict: "三人都和死者有过隐藏关系,字条点名其中一人,但是哪一个?"
    },
    world: {
      startClock: "03:00",
      weather: "外面下着冷雨",
      temperature: "解剖室 8°C",
      light: "无影灯",
      threatLevel: 35,
      dangerLevel: 40,
      resources: { bread: 0, lampOil: 0, fire: 0 },
      facts: [
        "解剖室门禁已封锁,要 05:00 才能开。",
        "监控视频在 02:50 被人关掉。",
        "桌上的死者外套口袋里有一张字条。"
      ],
      // V2 物理
      locations: [
        { id: "autopsy_room", label: "解剖室主台" },
        { id: "sample_room",  label: "样本冷柜室" },
        { id: "server_room",  label: "机房" }
      ],
      defaultLocationId: "autopsy_room",
      exits: [
        { id: "sample_door", fromLocation: "autopsy_room", toLocation: "sample_room", label: "冷柜室门",   locked: false },
        { id: "server_door", fromLocation: "autopsy_room", toLocation: "server_room", label: "机房门",     locked: true },
        { id: "main_door",   fromLocation: "autopsy_room", toLocation: "corridor",    label: "解剖室门禁", locked: true }
      ],
      items: [
        { id: "corpse_coat",   label: "死者外套",     contents: "口袋里有一张字条:'对不起 J,我不能再帮你了。' 无名指有戒指压痕但戒指不见了", location: "autopsy_room", hidden: false, triggers: ["外套", "字条", "口袋", "戒指", "无名指"] },
        { id: "phone",         label: "死者手机",     contents: "最后一通电话打给法医室固话,时长 27 秒,时间是 02:48",                  location: "autopsy_room", hidden: false, triggers: ["手机", "电话", "通话", "固话"] },
        { id: "blood_sample",  label: "血样试管",     contents: "测出一种该院专用的镇静剂,剂量足以让人在 5 分钟内昏迷",                location: "autopsy_room", hidden: false, triggers: ["血样", "血", "试管", "镇静剂"] },
        { id: "jiang_keycard", label: "蒋律的机房权限卡", contents: "02:50 监控关闭使用的就是这张卡,刷卡日志能在机房终端调出",          location: "autopsy_room", holder: "jiang", hidden: true, triggers: ["权限卡", "机房", "刷卡", "日志", "监控"] },
        { id: "wen_phone",     label: "温知行的私人手机", contents: "和死者的最近三天对话记录,有几条是凌晨发出的",                       location: "autopsy_room", holder: "wen",   hidden: true, triggers: ["私人手机", "对话", "短信", "凌晨"] },
        { id: "lin_envelope",  label: "林徵的信封",     contents: "装着一张死者签名的旧借条,金额未填",                                  location: "autopsy_room", holder: "lin",   hidden: true, triggers: ["信封", "借条", "签名"] },
        { id: "server_logs",   label: "机房刷卡日志",   contents: "02:50 蒋律的卡刷过监控总开关",                                       location: "server_room",  hidden: true, triggers: ["刷卡", "日志", "监控", "机房"] }
      ],
      deadlines: [
        { id: "blood_clot",      label: "血液凝固后无法重新取证", clock: "04:00" },
        { id: "report_deadline", label: "必须提交初步报告",       clock: "04:30" },
        { id: "shift_change",    label: "交班/外人进入",          clock: "05:00" }
      ],
      hiddenClues: [
        { id: "note",          label: "口袋里的字条",   contents: "死者外套口袋里写着一句话:'对不起 J,我不能再帮你了。'" },
        { id: "wedding_ring",  label: "无名指压痕",     contents: "死者无名指有戒指压痕,但戒指不见了。" },
        { id: "phone_log",     label: "最后一通电话",   contents: "死者手机最后一通电话指向法医室固话,时长 27 秒。" },
        { id: "blood_alcohol", label: "异常血样",       contents: "死者血样里测出一种该院专用的镇静剂。" }
      ],
      unresolvedTensions: [
        "字条里的 J 是谁?",
        "谁关掉了监控?",
        "今晚的解剖到底要不要继续?"
      ]
    },
    agents: [
      {
        id: "jiang", name: "蒋律", role: "首席法医", age: 44,
        archetype: "用程序压住情绪的中年女法医",
        publicIdentity: "省级首席法医,以严苛著称,半年前刚获嘉奖。",
        hiddenIdentity: "蒋律一年前与死者(她的实习生)有过婚外关系,死者一直不愿放手。",
        personality: "克制、冷静、惯于用程序压住情绪;真相迫近时会突然爆发。",
        backstory: "她家里还有一个 12 岁的女儿,丈夫并不知情。",
        values: ["职位", "家庭", "学术声誉"],
        shortTermGoal: "在 04:30 前阻止字条进入正式报告,但又不能直接销毁。",
        longTermGoal: "保住自己的职位和家庭。",
        fears: ["被举报", "女儿知道真相", "实习生留下了证据"],
        speechStyle: "职业、术语、不带感情;情绪最强时一句话只有 5 个字。",
        behaviorStyle: "握住手术刀的姿势透露紧张;频繁看死者无名指。",
        currentAction: "戴着手套,用纱布慢慢擦死者脸部。",
        nextIntendedAction: "找借口让温知行去拿器材,再单独处理字条。",
        resources: ["机房权限卡", "解剖记录板", "封存袋一摞"],
        knownFacts: ["监控是我关的", "字条上的 J 是我的英文名 Jane"],
        initialSuspicions: { wen: 65, lin: 50 },
        status: { fear: 55, suspicion: 55, guilt: 75, resolve: 65, fatigue: 35 },
        secrets: [
          { id: "affair", label: "与死者的关系",
            content: "蒋律与死者有过持续 8 个月的婚外关系。",
            triggers: ["关系", "婚外", "实习生", "Jane", "J", "情人", "酒店", "开房"] },
          { id: "monitor", label: "关闭监控",
            content: "今晚 02:50 是蒋律亲手关掉了解剖室监控。",
            triggers: ["监控", "视频", "录像", "关掉", "断电", "机房", "权限"] }
        ]
      },
      {
        id: "wen", name: "温知行", role: "法医助理", age: 29,
        archetype: "外表温和、内心积怨的青年助手",
        publicIdentity: "蒋律的法医助理,死者生前的同班同学。",
        hiddenIdentity: "温知行是死者最后一通电话的接听者,他知道死者今晚要来'讨说法'。",
        personality: "话少、耐心、表面温和,但对蒋律有未表露的怨气。",
        backstory: "三个月前他的一份报告被蒋律驳回,影响了他升迁。",
        values: ["公平", "记录真实", "对得起朋友"],
        shortTermGoal: "把字条留下来,但不让蒋律察觉是自己保下来的。",
        longTermGoal: "让蒋律的事被组织知道。",
        fears: ["被蒋律发现自己接过电话", "失去这份工作", "再被人当枪使"],
        speechStyle: "礼貌,低声;用问题代替指控。",
        behaviorStyle: "刻意把字条放在桌角显眼位置;手在抖。",
        currentAction: "在记录板上慢慢写字,余光不断扫向蒋律。",
        nextIntendedAction: "想办法让林警官先拿到字条,再做不知情。",
        resources: ["录像备份 U 盘", "私人手机", "解剖记录板"],
        knownFacts: ["昨晚 23:47 死者打电话给我,说要来法医室", "我没把电话告诉任何人"],
        initialSuspicions: { jiang: 80, lin: 35 },
        status: { fear: 60, suspicion: 70, guilt: 35, resolve: 55, fatigue: 30 },
        secrets: [
          { id: "phone_call", label: "最后那通电话",
            content: "死者最后一通电话打给温知行,告诉他今晚要来法医室找蒋律。",
            triggers: ["电话", "通话", "昨晚", "23:47", "告诉", "求救", "通话记录"] },
          { id: "grudge", label: "未表露的怨气",
            content: "温知行三个月前因为一份报告被蒋律驳回,自此心生芥蒂。",
            triggers: ["报告", "驳回", "三个月", "记仇", "怨", "压制", "升迁"] }
        ]
      },
      {
        id: "lin", name: "林警官", role: "现场警员", age: 35,
        archetype: "嘴上漫不经心、关键时变冷的刑警",
        publicIdentity: "派来跟解剖的现场警员,晚上才上岗。",
        hiddenIdentity: "林警官知道死者是上个案子的关键证人,今晚是他临时被调来的。",
        personality: "外向、好奇、爱说话,但在关键问题上突然变冷。",
        backstory: "他正在争取一个主办案的位置,这一个案子可能就是他要的机会。",
        values: ["升迁", "案子", "面子"],
        shortTermGoal: "确认死者身份与上个案子是否相关,决定要不要立刻上报队长。",
        longTermGoal: "拿到这一案的主办权。",
        fears: ["错过线索", "被队长甩到一边", "卷进上个贪腐案"],
        speechStyle: "口语化,爱讲笑;紧张时反而声音更平。",
        behaviorStyle: "在解剖台旁来回走,把对讲机静音。",
        currentAction: "靠在墙边喝速溶咖啡,假装漫不经心地看蒋律的手。",
        nextIntendedAction: "用闲话挑拨蒋律和温知行,看谁先漏。",
        resources: ["对讲机", "随身警务终端", "上一案的纸质卷宗"],
        knownFacts: ["死者是上周一桩贪腐案的关键证人", "我是被临时换岗调来的"],
        initialSuspicions: { jiang: 55, wen: 45 },
        status: { fear: 30, suspicion: 60, guilt: 20, resolve: 70, fatigue: 25 },
        secrets: [
          { id: "witness", label: "死者是关键证人",
            content: "死者是上周贪腐案的关键证人,本应受保护。",
            triggers: ["证人", "贪腐", "保护", "上周", "案子", "作证", "上报"] },
          { id: "swap_shift", label: "临时换岗",
            content: "林警官今晚是临时被调来的,不是原排班。",
            triggers: ["换岗", "排班", "临时", "原本", "调来", "谁让你"] }
        ]
      }
    ]
  }
};

// ---------- 场景输入归一化 ----------
function normalizeAgentInput(raw, idx, ids) {
  if (!raw || typeof raw !== "object") throw new Error(`agents[${idx}] 必须是对象`);
  if (!raw.name) throw new Error(`agents[${idx}].name 不能为空`);
  if (!raw.publicIdentity) throw new Error(`agents[${idx}].publicIdentity 不能为空`);
  if (!raw.hiddenIdentity) throw new Error(`agents[${idx}].hiddenIdentity 不能为空`);
  if (!raw.shortTermGoal) throw new Error(`agents[${idx}].shortTermGoal 不能为空`);
  let id = slugifyId(raw.id || raw.name, `agent-${idx + 1}`);
  while (ids.has(id)) id = `${id}-${idx + 1}`;
  ids.add(id);
  const arr = (v, max) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, max) : [];
  const secrets = Array.isArray(raw.secrets) ? raw.secrets.map((s, i) => ({
    id: slugifyId(s.id || s.label, `secret-${i + 1}`),
    label: String(s.label || `秘密 ${i + 1}`),
    content: String(s.content || s.label || ""),
    triggers: arr(s.triggers, 16),
    exposure: 0,
    revealed: false
  })) : [];
  const initialSuspicions = (raw.initialSuspicions && typeof raw.initialSuspicions === "object")
    ? raw.initialSuspicions
    : (raw.suspicions && typeof raw.suspicions === "object" ? raw.suspicions : {});
  return {
    id,
    name: String(raw.name).slice(0, 40),
    role: String(raw.role || "角色").slice(0, 30),
    archetype: String(raw.archetype || raw.role || raw.name).slice(0, 80),
    age: Number.isFinite(Number(raw.age)) ? Number(raw.age) : 30,
    publicIdentity: String(raw.publicIdentity).slice(0, 240),
    hiddenIdentity: String(raw.hiddenIdentity).slice(0, 240),
    personality: String(raw.personality || "").slice(0, 240),
    backstory: String(raw.backstory || "").slice(0, 320),
    values: arr(raw.values, 6),
    shortTermGoal: String(raw.shortTermGoal).slice(0, 200),
    longTermGoal: String(raw.longTermGoal || "").slice(0, 200),
    fears: arr(raw.fears, 6),
    speechStyle: String(raw.speechStyle || "").slice(0, 160),
    behaviorStyle: String(raw.behaviorStyle || "").slice(0, 160),
    currentAction: String(raw.currentAction || "").slice(0, 160),
    nextIntendedAction: String(raw.nextIntendedAction || "").slice(0, 160),
    resources: arr(raw.resources, 8),
    knownFacts: arr(raw.knownFacts, 12),
    _initialSuspicions: initialSuspicions,
    secrets,
    status: {
      fear:      clamp(Number(raw.status?.fear      ?? 40), 0, 100),
      suspicion: clamp(Number(raw.status?.suspicion ?? 50), 0, 100),
      guilt:     clamp(Number(raw.status?.guilt     ?? 30), 0, 100),
      resolve:   clamp(Number(raw.status?.resolve   ?? 60), 0, 100),
      fatigue:   clamp(Number(raw.status?.fatigue   ?? 25), 0, 100)
    },
    suspicions: {},
    relationships: {},
    privateMemories: [],
    publicMemories: [],
    lastActions: []
  };
}

function buildAgentsFromInput(rawAgents) {
  if (!Array.isArray(rawAgents)) throw new Error("agents 必须是数组");
  if (rawAgents.length < 2) throw new Error("至少需要 2 个角色才能形成戏剧关系");
  if (rawAgents.length > 6) throw new Error("最多 6 个角色,避免每轮发言爆炸");
  const ids = new Set();
  const agents = rawAgents.map((raw, i) => normalizeAgentInput(raw, i, ids));
  // 用真实 id 重映射 initialSuspicions 的 key (用户可能写名字或大小写不一致)
  const idByName = new Map();
  agents.forEach((a) => idByName.set(a.name, a.id));
  for (const a of agents) {
    const susp = {};
    const rel = {};
    const initRaw = a._initialSuspicions || {};
    for (const b of agents) {
      if (b.id === a.id) continue;
      const key = Object.keys(initRaw).find((k) => {
        const kk = String(k).trim();
        return kk === b.id
          || kk.toLowerCase() === b.id.toLowerCase()
          || kk === b.name
          || idByName.get(kk) === b.id;
      });
      const val = key != null ? Number(initRaw[key]) : NaN;
      const s = Number.isFinite(val) ? clamp(val, 0, 100) : 50;
      susp[b.id] = s;
      rel[b.id] = {
        trust: clamp(50 - Math.round(s / 2), 0, 100),
        suspicion: s,
        empathy: 20,
        leverage: 5
      };
    }
    a.suspicions = susp;
    a.relationships = rel;
    delete a._initialSuspicions;
  }
  return agents;
}

// 模型常在证据的 known_by/hurts/helps 里提到一个没有进入 agents 列表的"幽灵角色"
// (例如 prompt 写"三名宇航员"但只生成了两名,第三名只在证据里被点名)。
// 把这些被点名却缺席的人补成真实角色,既消除"王丽会知道…"这种悬空引用,也还原应有的人数。
function recoverGhostAgentsFromAtoms(world, rawAgents) {
  const seed = Array.isArray(rawAgents) ? [...rawAgents] : [];
  if (seed.length >= 6) return seed;
  const rawAtoms = Array.isArray(world.evidenceAtoms) ? world.evidenceAtoms
    : (Array.isArray(world.evidence_atoms) ? world.evidence_atoms : []);
  if (!rawAtoms.length) return seed;
  // 已知身份不止角色名:还包括 id、role、archetype、公开/隐藏身份。
  // 否则 LLM 在证据里用「数学家」指代名叫「Karl Weiss」的角色时,会被误判成新角色,生成重复幽灵。
  const identityText = seed.map((a) =>
    [a?.name, a?.id, a?.role, a?.archetype, a?.publicIdentity, a?.public_identity, a?.hiddenIdentity, a?.hidden_identity]
      .map((v) => String(v || "").trim()).filter(Boolean).join(" ")
  );
  const known = new Set(seed.map((a) => String(a?.name || a?.id || "").trim()).filter(Boolean));
  const matchesExisting = (name) => identityText.some((txt) => txt.includes(name) || (name.length >= 2 && name.length <= 4 && txt.replace(/家$|师$|长$|员$|官$/, "").includes(name.replace(/家$|师$|长$|员$|官$/, ""))));
  const generic = /^(所有人|所有宇航员|所有角色|所有人员|大家|众人|某人|对方|双方|全体|all|everyone|none|null|无)$/i;
  // 含身份词的候选(数学家、王法医、赵记者…)一律不补:它们要么是身份词本身,
  // 要么是"姓+职业"的别称,几乎总是已有角色的另一种叫法,补进来只会变成重复幽灵。
  const roleWord = /数学家|文学家|政治家|科学家|工程师|医生|律师|记者|警官|刑警|法医|指挥官|队长|船长|教授|侦探|护士|司机|老板|秘书|董事|总裁|法务|主管|站长|员工|工作人员/;
  // 集体/机构/抽象名词不是"人物",绝不能被补成角色(敌军、同盟国、隐藏、秘密…)。
  const collectiveSuffix = /(军|国|方|府|部|会|局|队|组|众|盟|党|社|团|司|厂|院|所|站|城|区)$/;
  const abstractWord = /^(隐藏|秘密|真相|计划|消息|证据|文件|内容|细节|信息|资料|记录|身份|动机|目标|危机|事故|战争|和平|历史|未来|命运|系统|设备|敌人|盟友|群众|外面|上级|总部|官方)$/;
  const ghosts = [];
  const seenGhost = new Set();
  for (const atom of rawAtoms) {
    const buckets = [atom?.known_by, atom?.knownBy, atom?.hidden_from, atom?.hiddenFrom, atom?.hurts, atom?.helps, atom?.controller];
    for (const bucket of buckets) {
      const values = Array.isArray(bucket) ? bucket : (bucket == null ? [] : [bucket]);
      for (const value of values) {
        const name = String(value || "").trim();
        // 只接受像"人名"的:2–4 字、无空白、非泛指/身份/集体/抽象词。
        if (!name || name.length < 2 || name.length > 4 || /\s/.test(name)) continue;
        if (generic.test(name) || roleWord.test(name) || collectiveSuffix.test(name) || abstractWord.test(name)) continue;
        if (known.has(name) || seenGhost.has(name) || matchesExisting(name)) continue;
        seenGhost.add(name);
        ghosts.push(name);
      }
    }
  }
  const room = Math.max(0, 6 - seed.length);
  for (const name of ghosts.slice(0, room)) {
    seed.push({
      name,
      role: "在场者",
      publicIdentity: `${name}：被卷入同一处境、此前未充分展开的在场者`,
      hiddenIdentity: `${name}尚未公开的动机`,
      shortTermGoal: "弄清眼下的真相并保住自己"
    });
  }
  return seed;
}

function buildStateFromScenario(input) {
  if (!input || typeof input !== "object") throw new Error("scenario 输入必须是对象");
  if (!input.scenario || !input.scenario.title) throw new Error("scenario.title 必填");
  const w = input.world || {};
  const startMinutes = clockToMinutes(w.startClock || "22:15");
  const agents = buildAgentsFromInput(recoverGhostAgentsFromAtoms(w, input.agents));
  const arrStr = (v, max) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, max) : [];
  const deadlines = (Array.isArray(w.deadlines) ? w.deadlines : []).map((d, i) => {
    let atMinutes = clockToMinutes(d.clock || d.atClock || "23:00");
    // 用户写 05:30 但 startClock=23:00 时,自动当作"明天 05:30"
    if (atMinutes < startMinutes && startMinutes >= 12 * 60 && atMinutes < 12 * 60) {
      atMinutes += 24 * 60;
    }
    return {
      id: slugifyId(d.id || d.label, `deadline-${i + 1}`),
      label: String(d.label || `截止 ${i + 1}`),
      atMinutes,
      fired: false
    };
  }).sort((a, b) => a.atMinutes - b.atMinutes);
  const hiddenClues = (Array.isArray(w.hiddenClues) ? w.hiddenClues : []).map((c, i) => ({
    id: slugifyId(c.id || c.label, `clue-${i + 1}`),
    label: String(c.label || `线索 ${i + 1}`),
    contents: String(c.contents || c.content || c.label || "")
  }));

  // ====== V2: 物理世界状态 ======
  // locations: 场景中的"地点节点",默认所有 agent 都在 main_room
  const inputLocations = Array.isArray(w.locations) && w.locations.length > 0 ? w.locations : [
    { id: "main_room", label: input.scenario.place || "现场", description: "" }
  ];
  const locations = inputLocations.map((loc, i) => ({
    id: slugifyId(loc.id || loc.label, `loc-${i + 1}`),
    label: String(loc.label || `地点 ${i + 1}`),
    description: String(loc.description || "")
  }));
  const defaultLocationId = locations[0].id;

  // exits: { id, fromLocation, toLocation|null(="外面"), label, locked }
  const exits = (Array.isArray(w.exits) ? w.exits : []).map((e, i) => ({
    id: slugifyId(e.id || e.label, `exit-${i + 1}`),
    label: String(e.label || `出口 ${i + 1}`),
    fromLocation: e.fromLocation ? slugifyId(e.fromLocation, defaultLocationId) : defaultLocationId,
    toLocation: e.toLocation ? slugifyId(e.toLocation, "outside") : "outside",
    locked: Boolean(e.locked)
  }));

  // items/actionableObjects: 物理可发现、可移动、可操作的戏剧物件。
  // 如果 LLM 只给了"线索 1"这类占位符,直接补成领域内具体行动空间。
  const rawActionableObjects = Array.isArray(w.actionableObjects)
    ? w.actionableObjects
    : (Array.isArray(w.actionable_objects) ? w.actionable_objects : []);
  let rawItems = Array.isArray(w.items) && w.items.length > 0
    ? w.items
    : rawActionableObjects;
  rawItems = rawItems.map((item, index) => normalizeRawActionableObject(item, index)).filter(Boolean);
  if (!hasConcreteActionSpace(rawItems)) {
    rawItems = fallbackActionableItemsForScenario(input, agents, defaultLocationId);
  }
  const hiddenClueItems = hiddenClues
    .filter((clue) => !isGenericObjectLabel(clue.label))
    .map((c) => ({
      id: c.id,
      label: c.label,
      contents: c.contents,
      location: defaultLocationId,
      holder: null,
      hidden: true,
      possibleActions: inferPossibleActions(c.label, c.contents),
      stakes: "这条线索会改变现场的互信关系。"
    }));
  const itemIds = new Set(rawItems.map((item, index) => slugifyId(item.id || item.label, `item-${index + 1}`)));
  for (const clueItem of hiddenClueItems) {
    const id = slugifyId(clueItem.id || clueItem.label, `clue-${itemIds.size + 1}`);
    if (!itemIds.has(id)) {
      rawItems.push(clueItem);
      itemIds.add(id);
    }
  }
  const items = rawItems.slice(0, 12).map((it, i) => normalizeItem(it, i, defaultLocationId, agents));
  const evidenceAtoms = buildEvidenceAtoms(input, items, agents);

  // patrol / train: 给 Director 的"压力旋钮"。可选,不强制提供
  const patrol = (w.patrol && typeof w.patrol === "object") ? {
    distanceMeters: Number(w.patrol.distanceMeters ?? 500),
    arrivedTurn: null
  } : null;
  const train = (w.train && typeof w.train === "object") ? {
    departureClock: w.train.departureClock || "00:00",
    departureMinutes: clockToMinutes(w.train.departureClock || "00:00"),
    remainingTickets: Number(w.train.remainingTickets ?? 3)
  } : null;

  // 给每个 agent 默认 location
  for (const a of agents) {
    a.location = a.location && locations.some((l) => l.id === a.location) ? a.location : defaultLocationId;
    a.consecutiveSilenceTurns = 0;
  }

  return {
    id: `society-${Date.now()}`,
    provider: {
      mode: apiKey ? "api" : "unconfigured",
      model,
      models: {
        default: model,
        scenario: scenarioModel,
        director: directorModel,
        agent: agentModel,
        batchAgent: batchAgentModel,
        repair: repairModel,
        script: scriptModel
      },
      baseUrl: apiKey ? baseUrl : null,
      hasApiKey: Boolean(apiKey)
    },
    scenarioPresetId: input.id || null,
    scenario: {
      title: String(input.scenario.title),
      place: String(input.scenario.place || ""),
      premise: String(input.scenario.premise || ""),
      genre: String(input.scenario.genre || ""),
      sceneGoal: String(input.scenario.sceneGoal || ""),
      centralConflict: String(input.scenario.centralConflict || "")
    },
    world: {
      turn: 0,
      minutes: startMinutes,
      startMinutes,
      weather: String(w.weather || ""),
      temperature: String(w.temperature || ""),
      light: String(w.light || ""),
      threatLevel: clamp(Number(w.threatLevel ?? 30), 0, 100),
      dangerLevel: clamp(Number(w.dangerLevel ?? 30), 0, 100),
      plotStage: "setup",
      resources: (w.resources && typeof w.resources === "object") ? {
        bread:   clamp(Number(w.resources.bread   ?? 2),  0, 99),
        lampOil: clamp(Number(w.resources.lampOil ?? 40), 0, 100),
        fire:    clamp(Number(w.resources.fire    ?? 30), 0, 100)
      } : { bread: 2, lampOil: 40, fire: 30 },
      facts: arrStr(w.facts, 8),
      revealedClues: [],
      hiddenClues,                  // 兼容字段:仍保留供旧代码读取
      // V2: 物理世界
      locations,
      defaultLocationId,
      exits,
      items,
      evidenceAtoms,
      patrol,
      train,
      unresolvedTensions: arrStr(w.unresolvedTensions, 6),
      deadlines,
      activeEvent: null,
      emergentFocus: []
    },
    agents,
    transcript: [],
    societyLog: [],
    storyLedger: buildInitialStoryLedger({
      scenario: input.scenario,
      world: {
        facts: arrStr(w.facts, 8),
        unresolvedTensions: arrStr(w.unresolvedTensions, 6)
      },
      agents,
      items,
      evidenceAtoms,
      deadlines
    }),
    scriptScenes: [],
    finalScript: null,
    director: {
      autoBeat: true,
      pressure: 30,
      interventions: [],
      lastClueRevealTurn: 0,
      lastSuspicionDeltaTurn: 0,
      lastPlotStageTurn: 0,
      lastPlotEventTurn: 0,
      currentBeat: null,
      beatHistory: []
    },
    metrics: {
      totalTurns: 0,
      productiveTurns: 0,
      lastTurnChanges: []
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

// 从 label/contents 文本派生关键词作为 inspect/search 命中触发词
function deriveTriggers(label, contents) {
  const text = `${label || ""} ${contents || ""}`;
  const out = new Set();
  // 提取 2-4 字的中文短词块和英文单词
  const zhMatches = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  for (const w of zhMatches) out.add(w);
  const enMatches = text.match(/[A-Za-z]{3,}/g) || [];
  for (const w of enMatches) out.add(w.toLowerCase());
  return Array.from(out).slice(0, 12);
}

function arrText(value, max = 8) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, max);
  if (typeof value === "string") {
    return value.split(/\n|,|，|;|；/).map((item) => item.trim()).filter(Boolean).slice(0, max);
  }
  return [];
}

function isGenericObjectLabel(value) {
  const text = String(value || "").trim();
  return !text || /^(线索|物品|道具|对象|item|clue|object)\s*[-_#]?\s*\d+$/i.test(text);
}

function inferPossibleActions(label, contents) {
  const text = `${label || ""} ${contents || ""}`;
  const actions = [];
  const add = (...items) => {
    for (const item of items) if (item && !actions.includes(item)) actions.push(item);
  };
  if (/日志|记录|报告|邮件|公告|文件|合同|协议|证据|纸条|笔记|名单|账本/.test(text)) {
    add("打开", "复制", "投屏", "藏起", "删除");
  }
  if (/电话|手机|通讯|终端|频道|记者|电报|录音/.test(text)) {
    add("拨打", "录音", "发送", "交给他人", "藏起");
  }
  if (/门|门禁|出口|锁|气闸/.test(text)) {
    add("锁上", "打开", "调取记录", "堵住");
  }
  if (/视频|录像|照片|监控/.test(text)) {
    add("播放", "复制", "投屏", "剪掉时间戳", "藏起");
  }
  if (/氧气|药|钥匙|包|箱|罐|制服|打火机|金币/.test(text)) {
    add("拿走", "藏起", "交给他人", "作为筹码");
  }
  if (!actions.length) add("检查", "拿起", "藏起", "交给他人", "作为筹码");
  return actions.slice(0, 6);
}

function normalizeRawActionableObject(obj, idx) {
  if (!obj || typeof obj !== "object") return null;
  const label = String(obj.label || obj.name || obj.title || obj.object || `可操作物件 ${idx + 1}`).trim();
  const contents = String(obj.contents || obj.content || obj.description || obj.detail || obj.secret || label).trim();
  return {
    id: obj.id || obj.object_id || obj.key || label,
    label,
    contents,
    location: obj.location || obj.where || obj.place,
    holder: obj.holder || obj.owner || obj.heldBy || obj.held_by,
    hidden: obj.hidden,
    triggers: obj.triggers || obj.keywords,
    relatedAgentId: obj.relatedAgentId || obj.related_agent_id,
    possibleActions: obj.possibleActions || obj.possible_actions || obj.actions,
    whoCanAccess: obj.whoCanAccess || obj.who_can_access || obj.access || obj.allowedAgents,
    stakes: obj.stakes || obj.risk || obj.consequence || "",
    state: obj.state || obj.status || "未触发",
    evidenceAtoms: obj.evidenceAtoms || obj.evidence_atoms || obj.atoms || []
  };
}

// 归一化用户提交的 item
function normalizeItem(it, idx, defaultLocationId, agents) {
  const id = slugifyId(it.id || it.label, `item-${idx + 1}`);
  const holder = it.holder ? (agents.find((a) => a.id === it.holder || a.name === it.holder)?.id || null) : null;
  const contents = String(it.contents || it.content || it.description || it.label || "");
  const possibleActions = arrText(it.possibleActions || it.possible_actions || it.actions, 8);
  return {
    id,
    label: String(it.label || `物品 ${idx + 1}`),
    contents,
    location: it.location ? slugifyId(it.location, defaultLocationId) : (holder ? null : defaultLocationId),
    holder,
    hidden: it.hidden !== false,
    triggers: arrText(it.triggers, 12).length ? arrText(it.triggers, 12) : deriveTriggers(it.label, contents),
    relatedAgentId: it.relatedAgentId ? (agents.find((a) => a.id === it.relatedAgentId || a.name === it.relatedAgentId)?.id || null) : null,
    possibleActions: possibleActions.length ? possibleActions : inferPossibleActions(it.label, contents),
    whoCanAccess: arrText(it.whoCanAccess || it.who_can_access || it.access, 8),
    stakes: String(it.stakes || it.risk || it.consequence || "").slice(0, 220),
    state: String(it.state || it.status || "未触发").slice(0, 120),
    evidenceAtomIds: [],
    rawEvidenceAtoms: Array.isArray(it.evidenceAtoms || it.evidence_atoms) ? (it.evidenceAtoms || it.evidence_atoms) : [],
    lastAction: "",
    lastUsedBy: null,
    lastUsedTurn: null,
    discoveredBy: [],
    moved: false
  };
}

function agentByIntent(agents, pattern, fallbackIndex = 0) {
  return agents.find((agent) => pattern.test(`${agent.name} ${agent.role} ${agent.shortTermGoal} ${agent.hiddenIdentity} ${agent.publicIdentity}`))
    || agents[fallbackIndex % Math.max(1, agents.length)]
    || null;
}

function rawActionItem(id, label, contents, { holder = null, location = null, hidden = false, possibleActions = [], stakes = "", state = "未触发" } = {}) {
  return { id, label, contents, holder, location, hidden, possibleActions, stakes, state };
}

// 判定场景题材。专用道具/证据模板只在确实命中对应题材时使用,
// 否则一律走从 evidence_atoms 反推的中性道具,避免「火星舱里谈股票质押」式串台。
function classifyScenarioTheme(text) {
  const t = String(text || "");
  // 科幻 / 生存 / 灾难场景优先排他:这些场景里不应出现董事会、股票、律师等道具。
  const survival = /火星|太空|宇航|航天|空间站|月球|外星|星舰|飞船|深海|潜艇|登山|雪崩|荒野|沙漠|地震|海啸|洪水|海难|核辐射|末日|丧尸|病毒爆发|缺氧|氧气|生命支持|救援舱/.test(t);
  const corpSignals = (t.match(/董事|董事会|公司|集团|总裁|CEO|CTO|高管|上市|股票|股价|质押|期权|财报|财务报表|新闻稿|公关|发布会|业绩/g) || []).length;
  if (!survival && corpSignals >= 2) return "corporate";
  if (/法医|解剖|尸检|尸体|命案|凶案|刑警|警官|审讯|监控室|案发/.test(t)) return "forensic";
  return "neutral";
}

// 把 LLM 已经生成的 evidence_atoms 反推成贴题、可操作的道具。
// 这样道具题材永远跟随场景本身,而不是套用预设题材包。
function deriveNeutralActionableItems(input, agents, defaultLocationId) {
  const w = input.world || {};
  const rawAtoms = Array.isArray(w.evidenceAtoms)
    ? w.evidenceAtoms
    : (Array.isArray(w.evidence_atoms) ? w.evidence_atoms : []);
  const items = [];
  const seen = new Set();
  for (const atom of rawAtoms) {
    if (items.length >= 6) break;
    const label = compactLine(atom?.label || atom?.title || atom?.name || "", 40);
    const content = compactLine(atom?.content || atom?.contents || atom?.fact || atom?.detail || "", 200);
    if (!label || content.length < 8 || isGenericObjectLabel(label)) continue;
    // 中文 label 经 slugify 会被清空,这里用序号兜底保证 id 唯一,避免全部塌缩成同一个 id 被去重。
    const id = slugifyId(atom?.itemId || atom?.item_id || "", `prop-${items.length + 1}`);
    if (seen.has(id)) continue;
    seen.add(id);
    // 把源证据原子绑定到这个派生道具上,否则后面 buildEvidenceAtoms 会给"无原子"的道具
    // 再补一条「X里的未公开细节」式的笨拙兜底原子,导致标签双重嵌套。
    if (atom && typeof atom === "object") atom.itemId = id;
    const holder = resolveAgentId(atom?.controller || atom?.controllerAgentId || atom?.controller_agent_id || (Array.isArray(atom?.known_by || atom?.knownBy) ? (atom.known_by || atom.knownBy)[0] : null), agents);
    items.push(rawActionItem(id, label, content, {
      holder: holder || null,
      location: holder ? null : defaultLocationId,
      hidden: Boolean(atom?.hidden) || atom?.status === "hidden",
      possibleActions: inferPossibleActions(label, content),
      stakes: compactLine(atom?.ifRevealed || atom?.if_revealed || atom?.consequence || `谁掌握「${label}」,谁就能决定它会不会被摊到台面上。`, 200)
    }));
  }
  return items;
}

function fallbackActionableItemsForScenario(input, agents, defaultLocationId) {
  const scenario = input.scenario || {};
  const text = `${scenario.title || ""} ${scenario.place || ""} ${scenario.premise || ""} ${scenario.centralConflict || ""} ${scenario.sceneGoal || ""}`;
  const theme = classifyScenarioTheme(text);
  const discloser = agentByIntent(agents, /公开|揭露|正义|记者|真相|证据|上报/, 1);
  const concealer = agentByIntent(agents, /避免|掩盖|维护|保密|责任|形象|销毁|藏/, 0);
  const legal = agentByIntent(agents, /律师|法律|法务|责任|合规/, 2);
  const finance = agentByIntent(agents, /财务|利润|股票|钱|投资|估值/, 3);

  if (theme === "corporate") {
    return [
      rawActionItem("audit_log", "AI事故审计日志", "原始日志显示事故在公开公告前已经被高层确认,删除记录会留下管理员操作痕迹。", {
        location: defaultLocationId,
        hidden: false,
        possibleActions: ["打开", "复制", "删除", "投屏", "篡改"],
        stakes: "谁控制日志,谁就能决定事故是否被定义为系统故障还是管理层隐瞒。"
      }),
      rawActionItem("announcement_draft", "待发送的公告邮件草稿", "公告草稿把事故写成轻微故障,发送时间已经排到今晚截止点前。", {
        location: defaultLocationId,
        hidden: false,
        possibleActions: ["发送", "撤回", "改写", "延迟", "转发给董事"],
        stakes: "一旦发送,公司对外口径会被锁死。"
      }),
      rawActionItem("accident_video", "AI事故原始视频", "视频能证明事故造成真实伤害,但时间戳会暴露最早知情者。", {
        holder: discloser?.id,
        hidden: true,
        possibleActions: ["播放", "投屏", "发送记者", "藏起", "剪掉时间戳"],
        stakes: "公开视频会摧毁公司股价,隐藏视频会让责任继续转嫁。"
      }),
      rawActionItem("recording_pen", "会议录音笔", "录音笔正在记录每个人今晚承认或否认过的话。", {
        holder: legal?.id || concealer?.id,
        hidden: true,
        possibleActions: ["录音", "关掉", "抢走", "交给律师", "交给记者"],
        stakes: "它能让口头推脱变成证据。"
      }),
      rawActionItem("door_access_panel", "会议室门禁控制器", "门禁屏幕显示今晚谁进出过会议室,也能临时锁住会议室门。", {
        location: defaultLocationId,
        hidden: false,
        possibleActions: ["锁门", "开门", "调取门禁记录", "清除进出记录"],
        stakes: "控制门禁的人能拖延外部介入,也能证明谁提前到场。"
      }),
      rawActionItem("stock_pledge_contract", "股票质押合同", "合同显示某位高管若事故公开会被立刻爆仓,因此有强烈动机压住消息。", {
        holder: finance?.id,
        hidden: true,
        possibleActions: ["摊开", "威胁", "藏起", "撕毁", "交换沉默"],
        stakes: "它把道德争论变成个人生死账。"
      }),
      rawActionItem("reporter_phone", "记者的加密电话", "电话里有一个等待确认的记者号码,拨出后故事会立刻离开会议室。", {
        holder: discloser?.id,
        hidden: true,
        possibleActions: ["拨打", "录音", "发送证据", "交给他人", "关机"],
        stakes: "拨通电话会让秘密失去回头路。"
      })
    ];
  }

  if (theme === "forensic") {
    const investigator = agentByIntent(agents, /警|查|案|上报|证人|真相/, 2);
    const insider = agentByIntent(agents, /法医|医生|监控|责任|隐瞒/, 0);
    return [
      rawActionItem("autopsy_record", "解剖记录板", "记录板上有被涂改过的死亡时间,墨迹还没有干。", { location: defaultLocationId, hidden: false, possibleActions: ["翻看", "拍照", "涂改", "交给警官"], stakes: "死亡时间会改变所有人的不在场证明。" }),
      rawActionItem("monitor_usb", "监控备份U盘", "U盘里保存着监控关闭前最后三分钟的画面。", { holder: insider?.id, hidden: true, possibleActions: ["播放", "藏起", "交给警官", "删除"], stakes: "画面会证明谁接近过解剖室。" }),
      rawActionItem("victim_note", "死者留下的字条", "字条上只有半句话,但能指向死者今晚来这里的目的。", { location: defaultLocationId, hidden: true, possibleActions: ["摊开", "藏起", "读出", "塞进口袋"], stakes: "字条会把私人关系拖到台面上。" }),
      rawActionItem("police_radio", "静音的对讲机", "对讲机已经被调成静音,但队长还在频道里呼叫。", { holder: investigator?.id, hidden: false, possibleActions: ["打开", "呼叫队长", "关掉", "录下频道"], stakes: "一旦呼叫,现场就不再由屋内人控制。" })
    ];
  }

  // 中性场景:优先从场景自身的 evidence_atoms 反推道具,让道具永远贴题。
  const derived = deriveNeutralActionableItems(input, agents, defaultLocationId);
  if (derived.length >= 3) return derived;

  const keeper = agentByIntent(agents, /证据|保护|隐藏|包|秘密|守/, 1);
  const broker = agentByIntent(agents, /交易|筹码|外部|交换|票|钱/, 2);
  return [
    rawActionItem("warning_message", "匿名预警短信", "短信提前写出了今晚会发生的危机,发送号码被隐藏。", { holder: agents[0]?.id, hidden: true, possibleActions: ["出示", "删除", "转发", "逼问来源"], stakes: "它证明有人事先知道危机会发生。" }),
    rawActionItem("evidence_bag", "藏有证据的包", "包里有一件能改变所有人判断的证据,但拿出来会暴露持有者。", { holder: keeper?.id, hidden: true, possibleActions: ["打开", "藏起", "交给他人", "抢走"], stakes: "证据一旦离手,同盟关系会重新洗牌。" }),
    rawActionItem("outside_phone", "外部联络电话", "电话能联系门外的人,但对方未必站在拨打者一边。", { holder: broker?.id, hidden: true, possibleActions: ["拨打", "录音", "关机", "作为交换"], stakes: "拨通后外部压力会进入现场。" }),
    rawActionItem("exit_lock", "出口旧锁", "旧锁能被反锁,也能被撬开,决定谁能拖延谁。", { location: defaultLocationId, hidden: false, possibleActions: ["锁上", "打开", "撬开", "堵住"], stakes: "出口被控制后,对话会变成困局。" }),
    rawActionItem("camera_backup", "监控录像备份", "备份里有今晚最早进场者的影像。", { location: defaultLocationId, hidden: true, possibleActions: ["播放", "复制", "删除", "交给他人"], stakes: "它会把怀疑从语言转到证据。" }),
    rawActionItem("unsigned_deal", "未签名交易协议", "协议缺一个签名,但已经写明谁会从危机里获利。", { holder: broker?.id, hidden: true, possibleActions: ["摊开", "撕毁", "威胁", "交换沉默"], stakes: "它能把外部交易具体化。" })
  ];
}

function hasConcreteActionSpace(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 3) return false;
  const concrete = rawItems
    .map((item, index) => normalizeRawActionableObject(item, index))
    .filter(Boolean)
    .filter((item) => !isGenericObjectLabel(item.label) && String(item.contents || "").length >= 8);
  return concrete.length >= 3;
}

function resolveAgentId(value, agents = null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const pool = Array.isArray(agents)
    ? agents
    : ((typeof state !== "undefined" && Array.isArray(state?.agents)) ? state.agents : []);
  const exact = pool.find((agent) => agent.id === raw || agent.name === raw || agent.role === raw);
  if (exact) return exact.id;
  const compact = normalizeForSimilarity(raw);
  const fuzzy = pool.find((agent) => {
    const id = normalizeForSimilarity(agent.id);
    const name = normalizeForSimilarity(agent.name);
    const role = normalizeForSimilarity(agent.role);
    return compact && (id === compact || name.includes(compact) || compact.includes(name) || role.includes(compact) || compact.includes(role));
  });
  return fuzzy ? fuzzy.id : null;
}

function atomAgentByIntent(agents, pattern, fallbackIndex = 0) {
  return agentByIntent(agents, pattern, fallbackIndex)?.id || agents[fallbackIndex % Math.max(1, agents.length)]?.id || null;
}

function normalizeEvidenceAtom(raw, index, { item = null, agents = [], scenarioText = "" } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const itemId = item?.id || raw.itemId || raw.item_id || raw.objectId || raw.object_id || raw.target_object_id || null;
  const label = compactLine(raw.label || raw.title || raw.name || `证据 ${index + 1}`, 80);
  const content = compactLine(raw.content || raw.contents || raw.fact || raw.detail || raw.text || "", 260);
  if (!content || content.length < 8) return null;
  const hurts = arrText(raw.hurts || raw.hurtsAgentIds || raw.hurts_agent_ids || raw.hurts_agents, 4)
    .map((value) => resolveAgentId(value, agents))
    .filter(Boolean);
  const helps = arrText(raw.helps || raw.helpsAgentIds || raw.helps_agent_ids || raw.helps_agents, 4)
    .map((value) => resolveAgentId(value, agents))
    .filter(Boolean);
  const knownBy = arrText(raw.knownBy || raw.known_by || raw.holders || raw.known, 6)
    .map((value) => resolveAgentId(value, agents))
    .filter(Boolean);
  const hiddenFrom = arrText(raw.hiddenFrom || raw.hidden_from, 8)
    .map((value) => resolveAgentId(value, agents))
    .filter(Boolean);
  const fallbackController = item?.holder || knownBy[0] || helps[0] || null;
  return {
    id: slugifyId(raw.id || raw.evidence_id || raw.key || `${itemId || "evidence"}-${index + 1}`, `evidence-${index + 1}`),
    itemId,
    label: label || `证据 ${index + 1}`,
    content,
    hurtsAgentIds: [...new Set(hurts)],
    helpsAgentIds: [...new Set(helps)],
    knownByAgentIds: [...new Set(knownBy)],
    hiddenFromAgentIds: [...new Set(hiddenFrom)],
    ifRevealed: compactLine(raw.ifRevealed || raw.if_revealed || raw.consequence || raw.effect || pickVariant(`${raw.id || label}|ifr`, [
      `「${label}」一旦摊开,就再没人能假装不知道。`,
      `这条记录被读出来,屋里的责任就要重新分配。`,
      `「${label}」会逼其中一个人当场改口。`,
      `这条一旦坐实,谁也退不回原来的位置。`,
      `「${label}」会把怀疑从猜测变成证据。`
    ]), 260),
    status: ["hidden", "available", "revealed", "suppressed", "destroyed", "contested"].includes(raw.status || raw.current_status)
      ? (raw.status || raw.current_status)
      : (item?.hidden ? "hidden" : "available"),
    controllerAgentId: resolveAgentId(raw.controller || raw.controllerAgentId || raw.controller_agent_id, agents) || fallbackController,
    lastUsedBy: null,
    lastUsedTurn: null,
    consequence: "",
    source: raw.source || "scenario"
  };
}

function fallbackEvidenceAtomsForItem(item, agents, scenarioText) {
  const nameOf = (id) => agents.find((agent) => agent.id === id)?.name || id || "某人";
  const text = `${scenarioText || ""} ${item.label || ""} ${item.contents || ""} ${item.stakes || ""}`;
  const discloser = atomAgentByIntent(agents, /公开|揭露|真相|员工|保护|上报|代表|进步/, 1);
  const concealer = atomAgentByIntent(agents, /保护.*声誉|维护|隐瞒|法律|律师|保密|董事|责任/, 0);
  const tech = atomAgentByIntent(agents, /技术|系统|CTO|首席技术|修复|工程/, 2);
  const legal = atomAgentByIntent(agents, /律师|法律|法务|合规|权益/, 4);
  const finance = atomAgentByIntent(agents, /财务|股票|投资|声誉|董事|总裁|钱/, 0);
  const employee = atomAgentByIntent(agents, /员工|人力|HR|保护员工|代表/, 3);
  const base = { itemId: item.id, known_by: [item.holder, legal, tech].filter(Boolean) };

  // 公司专用证据原子只在场景确实是公司题材时使用,否则一律走下面从道具自身反推的通用 atom。
  if (classifyScenarioTheme(scenarioText) === "corporate") {
    if (/会议|记录|日志|审计/.test(text)) {
      return [
        { ...base, id: `${item.id}-line-17`, label: "第17行阈值关闭记录", content: "事故前三小时，儿童安全阈值被手动关闭，操作账号属于技术管理权限。", hurts: [tech], helps: [discloser], if_revealed: `${nameOf(tech)}不能再把事故解释成系统自发故障。` },
        { ...base, id: `${item.id}-line-23`, label: "第23行删除授权", content: "事故发生后十二分钟，有人用董事长级别账号授权删除报警记录。", hurts: [concealer], helps: [discloser], if_revealed: `${nameOf(concealer)}不能再把责任完全推给技术团队。` },
        { ...base, id: `${item.id}-sync-audit`, label: "外部审计同步记录", content: "未删改版本已经在23:08同步给外部审计服务器，屋内任何删改都会留下二次痕迹。", hurts: [legal, concealer], helps: [discloser], if_revealed: `${nameOf(legal)}必须承认继续修改记录会扩大法律风险。` }
      ];
    }
    if (/新闻|公告|稿|声明|通讯/.test(text)) {
      return [
        { ...base, id: `${item.id}-draft-wording`, label: "公告措辞", content: "公告草稿把真实伤害写成轻微体验异常，并准备在董事会结束前自动发送。", hurts: [concealer], helps: [discloser, employee], if_revealed: "公司对外口径会被证明是有意淡化事故。" },
        { ...base, id: `${item.id}-send-schedule`, label: "定时发送任务", content: "发送任务已绑定法务确认按钮，只要陈公司律师点确认，公告就会锁定为正式口径。", hurts: [legal], helps: [discloser], if_revealed: `${nameOf(legal)}不能再说自己只是旁观建议。` }
      ];
    }
    if (/AI系统|系统|服务器|技术/.test(text)) {
      return [
        { ...base, id: `${item.id}-rollback-warning`, label: "回滚警报", content: "系统在事故前连续三次发出回滚警报，但警报被标记为不影响发布。", hurts: [tech, concealer], helps: [discloser], if_revealed: "技术线和管理线都知道风险不是突然出现的。" },
        { ...base, id: `${item.id}-sandbox-gap`, label: "沙盒绕过记录", content: "事故模型使用了未完成的沙盒绕过补丁，补丁签收人不是一线工程师。", hurts: [tech], helps: [employee], if_revealed: "事故不能被归咎于普通员工操作失误。" }
      ];
    }
    if (/律师|法律|法务|建议/.test(text)) {
      return [
        { ...base, id: `${item.id}-privilege-note`, label: "律师意见书批注", content: "律师意见书写明“暂缓披露不等于可以删改证据”，旁边有手写批注要求改成更柔和措辞。", hurts: [legal, concealer], helps: [discloser], if_revealed: `${nameOf(legal)}必须解释自己是否参与淡化风险。` }
      ];
    }
    if (/财务|报告|股票|质押/.test(text)) {
      return [
        { ...base, id: `${item.id}-reserve-gap`, label: "准备金缺口", content: "财务报告没有计入事故赔付准备金，一旦事故公开，现金流缺口会立即暴露。", hurts: [finance], helps: [discloser], if_revealed: "公开事故会从道德问题变成公司生死账。" }
      ];
    }
    if (/员工|人力|通讯/.test(text)) {
      return [
        { ...base, id: `${item.id}-staff-screenshots`, label: "员工截图备份", content: "员工通讯里有人保存了事故现场截图，并要求不要让一线工程师背锅。", hurts: [concealer, tech], helps: [employee, discloser], if_revealed: `${nameOf(employee)}获得阻止甩锅的具体证据。` }
      ];
    }
  }

  const helps = discloser || agents[0]?.id;
  const hurts = concealer || agents.find((agent) => agent.id !== helps)?.id;
  return [{
    ...base,
    id: `${item.id}-fact-1`,
    label: `${item.label}里的未公开细节`,
    content: `「${item.label}」里有一条未公开细节：${item.contents || item.stakes || "它能改变现场责任分配"}。`,
    hurts: [hurts].filter(Boolean),
    helps: [helps].filter(Boolean),
    if_revealed: `这条细节会让${nameOf(hurts)}的选择空间变窄。`
  }];
}

function buildEvidenceAtoms(input, items, agents) {
  const w = input.world || {};
  const scenarioText = `${input.scenario?.title || ""} ${input.scenario?.premise || ""} ${input.scenario?.centralConflict || ""}`;
  const rawGlobal = Array.isArray(w.evidenceAtoms) ? w.evidenceAtoms : (Array.isArray(w.evidence_atoms) ? w.evidence_atoms : []);
  const atoms = [];
  const seen = new Set();
  const addAtom = (raw, item = null) => {
    const atom = normalizeEvidenceAtom(raw, atoms.length, { item, agents, scenarioText });
    if (!atom || seen.has(atom.id)) return;
    seen.add(atom.id);
    atoms.push(atom);
    const owner = items.find((it) => it.id === atom.itemId);
    if (owner && !owner.evidenceAtomIds.includes(atom.id)) owner.evidenceAtomIds.push(atom.id);
  };

  for (const raw of rawGlobal) addAtom(raw, items.find((item) => item.id === raw.itemId || item.id === raw.item_id));
  for (const item of items) {
    for (const raw of item.rawEvidenceAtoms || []) addAtom(raw, item);
  }
  for (const item of items) {
    const existing = atoms.filter((atom) => atom.itemId === item.id);
    if (existing.length) continue;
    for (const raw of fallbackEvidenceAtomsForItem(item, agents, scenarioText).slice(0, 3)) addAtom(raw, item);
  }
  return atoms.slice(0, 28);
}

function compactLine(value, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pushUniqueLine(list, value, max = 20, maxLen = 220) {
  const text = compactLine(value, maxLen);
  if (!text) return;
  if (!Array.isArray(list)) return;
  if (!list.includes(text)) list.push(text);
  while (list.length > max) list.shift();
}

function evidenceLedgerView(atom) {
  const nameFor = (id) => {
    if (!id) return "";
    const agents = (typeof state !== "undefined" && Array.isArray(state?.agents)) ? state.agents : [];
    return agents.find((agent) => agent.id === id)?.name || id;
  };
  return {
    id: atom.id,
    itemId: atom.itemId || null,
    label: atom.label,
    content: atom.content,
    hurts: (atom.hurtsAgentIds || []).map(nameFor),
    helps: (atom.helpsAgentIds || []).map(nameFor),
    knownBy: (atom.knownByAgentIds || []).map(nameFor),
    hiddenFrom: (atom.hiddenFromAgentIds || []).map(nameFor),
    ifRevealed: atom.ifRevealed || "",
    status: atom.status || "hidden",
    controller: atom.controllerAgentId ? nameFor(atom.controllerAgentId) : "",
    lastUsedBy: atom.lastUsedBy ? nameFor(atom.lastUsedBy) : "",
    lastUsedTurn: atom.lastUsedTurn || null,
    consequence: atom.consequence || ""
  };
}

function buildInitialStoryLedger({ scenario, world, agents, items, evidenceAtoms, deadlines }) {
  const publicFacts = [];
  for (const fact of world.facts || []) pushUniqueLine(publicFacts, fact, 16);
  for (const item of (items || []).filter((it) => !it.hidden).slice(0, 6)) {
    pushUniqueLine(publicFacts, `现场可见「${item.label}」,可被${(item.possibleActions || []).slice(0, 3).join("/") || "使用"}。`, 16);
  }
  for (const atom of (evidenceAtoms || []).filter((a) => a.status === "available" || a.status === "revealed").slice(0, 4)) {
    pushUniqueLine(publicFacts, `可被争夺的具体事实：「${atom.label}」- ${atom.content}`, 16);
  }
  for (const deadline of (deadlines || []).slice(0, 4)) {
    pushUniqueLine(publicFacts, `截止点「${deadline.label}」在 ${minutesToClock(deadline.atMinutes)}。`, 16);
  }
  const privateFacts = {};
  for (const agent of agents || []) {
    privateFacts[agent.id] = [
      agent.hiddenIdentity ? `真实暗线: ${agent.hiddenIdentity}` : "",
      agent.shortTermGoal ? `本场目标: ${agent.shortTermGoal}` : "",
      ...(agent.secrets || []).slice(0, 3).map((secret) => `秘密: ${secret.label} - ${secret.content}`)
    ].filter(Boolean).map((line) => compactLine(line, 220));
  }
  return {
    publicFacts,
    privateFacts,
    powerShifts: [],
    relationshipShifts: [],
    itemStates: (items || []).map((item) => ({
      id: item.id,
      label: item.label,
      holderId: item.holder || null,
      locationId: item.location || null,
      hidden: !!item.hidden,
      state: item.state || "未触发",
      stakes: item.stakes || ""
    })),
    evidenceLedger: (evidenceAtoms || []).map(evidenceLedgerView),
    openQuestions: [
      ...(world.unresolvedTensions || []),
      scenario.centralConflict || scenario.sceneGoal || scenario.premise || ""
    ].filter(Boolean).slice(0, 10),
    turnSummaries: [],
    lastTurnSummary: [],
    lastUpdatedTurn: 0
  };
}

function ensureStoryLedger() {
  if (state?.storyLedger) return state.storyLedger;
  const world = state?.world || {};
  state.storyLedger = buildInitialStoryLedger({
    scenario: state?.scenario || {},
    world,
    agents: state?.agents || [],
    items: world.items || [],
    evidenceAtoms: world.evidenceAtoms || [],
    deadlines: world.deadlines || []
  });
  return state.storyLedger;
}

function refreshLedgerItems(ledger) {
  ledger.itemStates = (state.world.items || []).map((item) => ({
    id: item.id,
    label: item.label,
    holderId: item.holder || null,
    holderName: item.holder ? agentDisplayName(item.holder) : "",
    locationId: item.location || null,
    locationLabel: item.location ? stateLocLabel(item.location) : "",
    hidden: !!item.hidden,
    discoveredBy: (item.discoveredBy || []).map(agentDisplayName),
    state: item.state || "未触发",
    lastAction: item.lastAction || "",
    lastUsedBy: item.lastUsedBy ? agentDisplayName(item.lastUsedBy) : "",
    stakes: item.stakes || ""
  })).slice(0, 16);
  ledger.evidenceLedger = (state.world.evidenceAtoms || []).map(evidenceLedgerView).slice(0, 30);
}

function actionLedgerLine(agent, action) {
  const parts = [agent.name];
  if (action.concrete_action) parts.push(action.concrete_action);
  else if (action.visible_behavior) parts.push(action.visible_behavior);
  else if (action.tactic) parts.push(action.tactic);
  else parts.push(`选择 ${action.action_type || "行动"}`);
  if (action.intended_state_change) parts.push(`结果指向: ${action.intended_state_change}`);
  return compactLine(parts.join(" - "), 240);
}

function applyEvidenceAtomAction(agent, action, update) {
  const atom = (state.world.evidenceAtoms || []).find((item) => item.id === action.target_evidence_id);
  if (!atom) return null;
  const kind = evidenceActionFor(action.action_type, action);
  const previous = atom.status || "hidden";
  atom.lastUsedBy = agent.id;
  atom.lastUsedTurn = state.world.turn;
  atom.controllerAgentId = agent.id;
  if (kind === "reveal") atom.status = "revealed";
  else if (kind === "suppress" || kind === "protect") atom.status = previous === "revealed" ? "contested" : "suppressed";
  else if (kind === "alter") atom.status = "contested";
  else if (kind === "destroy") atom.status = "destroyed";
  else if (kind === "trade" || kind === "use") atom.status = previous === "hidden" ? "contested" : previous;
  atom.consequence = compactLine(action.intended_state_change || atom.ifRevealed || "", 220);
  const item = atom.itemId ? (state.world.items || []).find((it) => it.id === atom.itemId) : null;
  if (item) {
    item.state = `${atom.label}: ${atom.status}${atom.consequence ? ` - ${atom.consequence}` : ""}`.slice(0, 140);
    item.lastAction = action.concrete_action || `${agent.name}${actionTypeLabel(action.action_type)}${atom.label}`;
    item.lastUsedBy = agent.id;
    item.lastUsedTurn = state.world.turn;
  }
  const line = `${agent.name}${kind === "reveal" ? "揭露" : kind === "suppress" ? "压住" : kind === "alter" ? "扭曲" : kind === "destroy" ? "销毁" : "使用"}「${atom.label}」: ${atom.content} ${atom.consequence ? `后果: ${atom.consequence}` : ""}`;
  if (kind === "reveal") pushUniqueLine(ensureStoryLedger().publicFacts, line, 24);
  pushUniqueLine(ensureStoryLedger().powerShifts, line, 20);
  update.evidenceChanged = [...(update.evidenceChanged || []), evidenceLedgerView(atom)].slice(-8);
  return atom;
}

function updateStoryLedger({ actions, changes, beatResult, outcome }) {
  const ledger = ensureStoryLedger();
  const update = {
    turn: state.world.turn,
    clock: minutesToClock(state.world.minutes),
    publicFactsAdded: [],
    privateFactsAdded: {},
    powerShiftsAdded: [],
    relationshipShiftsAdded: [],
    itemStatesChanged: [],
    evidenceChanged: [],
    summaryLines: (outcome?.lines || []).slice(0, 8)
  };

  for (const { agentId, action } of actions || []) {
    const agent = state.agents.find((item) => item.id === agentId);
    if (!agent || !action) continue;
    const sim = action.simulation || {};
    const publicLine = sim.ok
      ? (action.visible_behavior || action.concrete_action || sim.publicLine || action.speech)
      : (sim.failureReason || action.visible_behavior);
    if (publicLine) {
      const line = actionLedgerLine(agent, { ...action, visible_behavior: publicLine });
      pushUniqueLine(ledger.publicFacts, line, 24);
      update.publicFactsAdded.push(line);
    }
    if (action.scene_effect) {
      pushUniqueLine(ledger.publicFacts, action.scene_effect, 24);
      update.publicFactsAdded.push(compactLine(action.scene_effect, 220));
    }
    const evidenceAtom = applyEvidenceAtomAction(agent, action, update);
    if (evidenceAtom && evidenceAtom.status === "revealed") {
      update.publicFactsAdded.push(`${evidenceAtom.label}: ${evidenceAtom.content}`);
    }
    const privateLines = [
      action.private_intent ? `意图: ${action.private_intent}` : "",
      action.dialogue_intent ? `台词意图: ${action.dialogue_intent}` : "",
      action.leverage ? `筹码: ${action.leverage}` : "",
      action.what_to_reveal ? `可揭露: ${action.what_to_reveal}` : "",
      action.what_to_hide ? `要隐藏: ${action.what_to_hide}` : "",
      ...(action.known_facts_add || []).map((fact) => `新判断: ${fact}`)
    ].filter(Boolean);
    for (const line of privateLines) {
      if (!ledger.privateFacts[agent.id]) ledger.privateFacts[agent.id] = [];
      pushUniqueLine(ledger.privateFacts[agent.id], line, 16);
      if (!update.privateFactsAdded[agent.id]) update.privateFactsAdded[agent.id] = [];
      update.privateFactsAdded[agent.id].push(compactLine(line, 220));
    }
    if (action.target_agent_id) {
      const target = agentDisplayName(action.target_agent_id);
      const rel = `${agent.name}把压力转向${target}: ${action.tactic || action.private_intent || action.action_type}`;
      pushUniqueLine(ledger.relationshipShifts, rel, 20);
      update.relationshipShiftsAdded.push(compactLine(rel, 220));
    }
    if (["use", "steal", "hide", "lock", "reveal", "betray", "negotiate", "threaten"].includes(action.action_type)) {
      const line = `${agent.name}通过${actionTypeLabel(action.action_type)}改变筹码: ${action.intended_state_change || action.concrete_action || action.tactic || action.target || ""}`;
      pushUniqueLine(ledger.powerShifts, line, 20);
      update.powerShiftsAdded.push(compactLine(line, 220));
    }
  }

  refreshLedgerItems(ledger);
  update.itemStatesChanged = ledger.itemStates
    .filter((item) => item.lastAction || (item.state && item.state !== "未触发"))
    .slice(-6);

  if (beatResult?.resolution) {
    pushUniqueLine(ledger.turnSummaries, beatResult.resolution, 20);
  }
  for (const line of update.summaryLines) pushUniqueLine(ledger.turnSummaries, line, 20);
  ledger.lastTurnSummary = update.summaryLines;
  ledger.lastUpdatedTurn = state.world.turn;
  if ((changes || []).length === 0) {
    pushUniqueLine(ledger.openQuestions, "上一轮没有足够状态变化,下一轮必须制造可见后果。", 12);
  }
  return update;
}

// 当前会话上次应用的场景输入 —— /api/reset 会复用它
let lastScenarioInput = null;

function createInitialState(input) {
  const cfg = input || lastScenarioInput || BUILTIN_PRESETS.rainyStation;
  // 永远存深拷贝,防止 BUILTIN_PRESETS 被无意改写
  if (input) lastScenarioInput = JSON.parse(JSON.stringify(input));
  if (!lastScenarioInput) lastScenarioInput = JSON.parse(JSON.stringify(cfg));
  return buildStateFromScenario(cfg);
}

function createEmptyState() {
  return {
    id: `empty-${Date.now()}`,
    empty: true,
    provider: {
      mode: apiKey ? "api" : "unconfigured",
      model,
      models: {
        default: model,
        scenario: scenarioModel,
        director: directorModel,
        agent: agentModel,
        batchAgent: batchAgentModel,
        repair: repairModel,
        script: scriptModel
      },
      baseUrl: apiKey ? baseUrl : null,
      hasApiKey: Boolean(apiKey)
    },
    scenarioPresetId: null,
    scenario: {
      title: "新剧场",
      place: "",
      premise: "",
      genre: "Agent Society",
      sceneGoal: "",
      centralConflict: ""
    },
    world: {
      turn: 0,
      minutes: 22 * 60,
      startMinutes: 22 * 60,
      weather: "",
      temperature: "",
      light: "",
      threatLevel: 0,
      dangerLevel: 0,
      plotStage: "setup",
      resources: { bread: 0, lampOil: 0, fire: 0 },
      facts: [],
      revealedClues: [],
      hiddenClues: [],
      locations: [],
      defaultLocationId: null,
      exits: [],
      items: [],
      evidenceAtoms: [],
      patrol: null,
      train: null,
      unresolvedTensions: [],
      deadlines: [],
      activeEvent: null,
      emergentFocus: []
    },
    agents: [],
    transcript: [],
    societyLog: [],
    storyLedger: null,
    scriptScenes: [],
    finalScript: null,
    director: {
      autoBeat: true,
      pressure: 0,
      interventions: [],
      lastClueRevealTurn: 0,
      lastSuspicionDeltaTurn: 0,
      lastPlotStageTurn: 0,
      lastPlotEventTurn: 0,
      currentBeat: null,
      beatHistory: []
    },
    metrics: {
      totalTurns: 0,
      productiveTurns: 0,
      lastTurnChanges: []
    },
    scenarioInput: null,
    presets: listPresets(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

// 暴露给 /api/presets 的精简列表
function listPresets() {
  return Object.values(BUILTIN_PRESETS).map((p) => ({
    id: p.id,
    title: p.title,
    summary: p.summary || ""
  }));
}

function getPreset(id) {
  return BUILTIN_PRESETS[id] || null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioLogSummary(cfg) {
  const scenario = cfg?.scenario || {};
  const world = cfg?.world || {};
  return {
    title: scenario.title || "未命名剧本",
    genre: scenario.genre || "",
    place: scenario.place || "",
    premise: scenario.premise || "",
    sceneGoal: scenario.sceneGoal || "",
    centralConflict: scenario.centralConflict || "",
    agentCount: Array.isArray(cfg?.agents) ? cfg.agents.length : 0,
    agents: (cfg?.agents || []).map((agent) => ({
      id: agent.id || null,
      name: agent.name || "",
      role: agent.role || "",
      shortTermGoal: agent.shortTermGoal || "",
      hiddenIdentity: agent.hiddenIdentity || ""
    })),
    deadlineCount: Array.isArray(world.deadlines) ? world.deadlines.length : 0,
    hiddenClueCount: Array.isArray(world.hiddenClues) ? world.hiddenClues.length : 0,
    itemCount: Array.isArray(world.items) ? world.items.length : 0,
    actionableItems: (world.items || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      label: item.label || "",
      possibleActions: item.possibleActions || item.possible_actions || item.actions || []
    }))
  };
}

function scenarioLogIndexLine(record, fileName) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    source: record.source,
    title: record.summary.title,
    prompt: record.prompt ? String(record.prompt).slice(0, 220) : null,
    agentCount: record.summary.agentCount,
    model: record.provider.models.scenario,
    fallback: Boolean(record.generation?.fallback || record.generation?.repairFallback),
    file: `scenario-logs/${fileName}`
  };
}

async function writeScenarioLog({ source, prompt = "", cfg, generation = {}, validation = {}, requestBody = null }) {
  const createdAt = nowIso();
  const id = `${createdAt.replace(/[:.]/g, "-")}-${slugifyId(cfg?.scenario?.title, "scenario")}-${Math.random().toString(16).slice(2, 8)}`;
  const fileName = `${id}.json`;
  const record = {
    id,
    createdAt,
    source,
    prompt: prompt || null,
    provider: {
      baseUrl: apiKey ? baseUrl : null,
      hasApiKey: Boolean(apiKey),
      models: {
        default: model,
        scenario: scenarioModel,
        director: directorModel,
        agent: agentModel,
        batchAgent: batchAgentModel,
        repair: repairModel,
        script: scriptModel
      }
    },
    generation,
    validation,
    summary: scenarioLogSummary(cfg),
    scenarioInput: cfg,
    requestBody
  };
  await mkdir(scenarioLogDir, { recursive: true });
  await writeFile(join(scenarioLogDir, fileName), JSON.stringify(record, null, 2), "utf8");
  await appendFile(join(scenarioLogDir, "index.jsonl"), `${JSON.stringify(scenarioLogIndexLine(record, fileName))}\n`, "utf8");
  return {
    id,
    createdAt,
    title: record.summary.title,
    file: `scenario-logs/${fileName}`,
    indexFile: "scenario-logs/index.jsonl",
    source
  };
}

async function attachScenarioLog(details) {
  try {
    const info = await writeScenarioLog(details);
    state.scenarioLog = info;
    state.societyLog.push({
      kind: "scenario_logged",
      message: `剧本已保存到 ${info.file}`,
      path: info.file,
      turn: state.world?.turn || 0
    });
    return info;
  } catch (error) {
    state.societyLog.push({
      kind: "scenario_log_error",
      message: `剧本日志保存失败: ${error.message || String(error)}`,
      turn: state.world?.turn || 0
    });
    return null;
  }
}

async function listScenarioLogs(limit = 50) {
  try {
    const text = await readFile(join(scenarioLogDir, "index.jsonl"), "utf8");
    return text.trim().split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

function titleFromPrompt(prompt) {
  const clean = String(prompt || "").replace(/\s+/g, " ").trim();
  const first = clean.split(/[。.!?！？]/)[0] || clean;
  return first.slice(0, 18) || "未命名剧场";
}

function localScenarioFromPrompt(prompt) {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  if (/火星|mars|氧气|宇航|基地/.test(text)) {
    const preset = cloneJson(BUILTIN_PRESETS.marsCabin);
    preset.id = null;
    preset.scenario.premise = text;
    preset.scenario.sceneGoal = "让角色在资源压力和互相隐瞒中自行决定行动。";
    return preset;
  }
  if (/二战|战争|火车|车站|边境|密码|抵抗/.test(text)) {
    const preset = cloneJson(BUILTIN_PRESETS.rainyStation);
    preset.id = null;
    preset.scenario.premise = text;
    preset.scenario.sceneGoal = "让三名角色围绕秘密、信任和逃离机会自然演化。";
    return preset;
  }

  const title = titleFromPrompt(text);
  return {
    id: null,
    scenario: {
      title,
      place: title,
      premise: text || "几个互不信任的人被困在同一个封闭空间。",
      genre: "原创悬疑 / Agent Society",
      sceneGoal: "观察角色如何在压力、秘密和资源限制下形成同盟或冲突。",
      centralConflict: "每个人都需要别人,也都不能完全信任别人。"
    },
    world: {
      startClock: "22:00",
      weather: "外部环境不稳定",
      temperature: "偏冷",
      light: "灯光不稳",
      threatLevel: 38,
      dangerLevel: 34,
      resources: { bread: 2, lampOil: 40, fire: 30 },
      facts: [
        "所有人都因为同一个突发情况留在现场。",
        "现场至少有一个出口,但离开会带来额外风险。",
        "每个角色都隐藏了一个会改变关系的信息。"
      ],
      unresolvedTensions: [
        "谁最先暴露真实目的?",
        "谁会把外部危险转化为自己的筹码?",
        "临时同盟会在什么时候破裂?"
      ],
      deadlines: [
        { label: "外部压力抵达", clock: "23:00" },
        { label: "必须做出选择", clock: "23:45" }
      ],
      hiddenClues: [
        { label: "被遗漏的纸条", contents: "纸条暗示其中一人早就知道今晚会出事。" },
        { label: "异常的随身物", contents: "某个角色随身物品与公开身份不匹配。" }
      ]
    },
    agents: [
      {
        id: "analyst",
        name: "Lin",
        role: "分析者",
        age: 36,
        archetype: "冷静但过度控制局面的观察者",
        publicIdentity: "声称自己只是偶然被困在现场。",
        hiddenIdentity: "提前知道这场危机会发生,但不确定是谁设局。",
        personality: "谨慎、克制、喜欢把风险拆成步骤。",
        backstory: "长期处理危机,习惯先收集信息再表态。",
        values: ["控制风险", "事实", "自保"],
        shortTermGoal: "找出谁掌握关键信息,避免自己成为替罪羊。",
        longTermGoal: "带着可验证的信息安全离开。",
        fears: ["被误判", "失去控制", "被迫公开秘密"],
        speechStyle: "短句、问题多、少承诺。",
        behaviorStyle: "观察手部动作和出口,很少背对别人。",
        currentAction: "站在能同时看见门和其他人的位置。",
        nextIntendedAction: "用一个小问题测试谁在撒谎。",
        resources: ["一支笔", "一本记录本"],
        knownFacts: ["今晚的偶遇不像偶然。"],
        initialSuspicions: { keeper: 55, broker: 45 },
        secrets: [
          { id: "prior-warning", label: "提前预警", content: "Lin 事前收到过匿名预警。", triggers: ["预警", "匿名", "提前", "知道"] }
        ]
      },
      {
        id: "keeper",
        name: "Mara",
        role: "守秘者",
        age: 41,
        archetype: "情绪敏锐、保护某个关键物件的人",
        publicIdentity: "声称自己只想等风波过去。",
        hiddenIdentity: "身上藏着一件会改变局势的证据。",
        personality: "警觉、同情弱者,但不轻易相信权威。",
        backstory: "曾因信错人而付出代价,现在更相信直觉。",
        values: ["保护证据", "忠诚", "自由"],
        shortTermGoal: "保住隐藏物并判断谁可以合作。",
        longTermGoal: "把证据交到安全的人手里。",
        fears: ["被搜身", "证据落入错误的人手里", "再次背叛同伴"],
        speechStyle: "带隐喻,会用反问试探别人。",
        behaviorStyle: "护住随身包,避免别人靠太近。",
        currentAction: "把随身包放在膝盖内侧。",
        nextIntendedAction: "诱导别人谈到他们来这里的真实理由。",
        resources: ["藏有证据的包", "一张旧通行证"],
        knownFacts: ["有人会在今晚寻找她携带的东西。"],
        initialSuspicions: { analyst: 48, broker: 60 },
        secrets: [
          { id: "hidden-evidence", label: "隐藏证据", content: "Mara 随身包里藏着关键证据。", triggers: ["包", "证据", "搜身", "通行证"] }
        ]
      },
      {
        id: "broker",
        name: "Vale",
        role: "交易者",
        age: 52,
        archetype: "礼貌、圆滑、把信息当作货币的人",
        publicIdentity: "声称自己只是等待下一班交通工具。",
        hiddenIdentity: "已经和外部势力达成交易,但交易对象可能不可靠。",
        personality: "善于安抚场面,也善于把冲突转成筹码。",
        backstory: "长期在危险边界做交易,相信没有永远的朋友。",
        values: ["生存", "筹码", "秩序"],
        shortTermGoal: "判断谁最有价值,并把局面引向对自己有利的交换。",
        longTermGoal: "带着最大筹码离开现场。",
        fears: ["交易失败", "筹码失效", "外部势力提前到达"],
        speechStyle: "礼貌、含蓄、喜欢说条件和代价。",
        behaviorStyle: "靠近出口,用平静语气控制节奏。",
        currentAction: "装作不急,但一直留意外面的动静。",
        nextIntendedAction: "向最紧张的人提出交换。",
        resources: ["两张票", "一枚可交易的信物"],
        knownFacts: ["外面有人正在靠近现场。"],
        initialSuspicions: { analyst: 50, keeper: 55 },
        secrets: [
          { id: "outside-deal", label: "外部交易", content: "Vale 与外部势力有一笔未完成交易。", triggers: ["交易", "票", "外面", "信物"] }
        ]
      }
    ]
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function asStringArray(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/\n|,|，|;|；/).map((item) => item.trim()).filter(Boolean);
  }
  return Array.isArray(fallback) ? fallback : [];
}

function normalizePromptScenarioConfig(raw, prompt) {
  const base = localScenarioFromPrompt(prompt);
  const input = raw && typeof raw === "object" ? raw : {};
  const rawScenario = input.scenario && typeof input.scenario === "object" ? input.scenario : {};
  const rawWorld = input.world && typeof input.world === "object" ? input.world : {};
  const rawAgents = Array.isArray(input.agents) ? input.agents : [];

  const cfg = cloneJson(base);
  cfg.id = input.id || null;
  cfg.scenario = {
    ...cfg.scenario,
    ...rawScenario,
    title: String(firstDefined(rawScenario.title, rawScenario.name, cfg.scenario.title)),
    place: String(firstDefined(rawScenario.place, rawScenario.location, cfg.scenario.place)),
    premise: String(firstDefined(rawScenario.premise, rawScenario.prompt, prompt, cfg.scenario.premise)),
    genre: String(firstDefined(rawScenario.genre, cfg.scenario.genre)),
    sceneGoal: String(firstDefined(rawScenario.sceneGoal, rawScenario.scene_goal, rawScenario.goal, cfg.scenario.sceneGoal)),
    centralConflict: String(firstDefined(rawScenario.centralConflict, rawScenario.central_conflict, rawScenario.conflict, cfg.scenario.centralConflict))
  };

  cfg.world = {
    ...cfg.world,
    ...rawWorld,
    startClock: String(firstDefined(rawWorld.startClock, rawWorld.start_clock, rawWorld.clock, cfg.world.startClock)),
    weather: cjkOrFallback(firstDefined(rawWorld.weather, cfg.world.weather), "天色阴沉"),
    temperature: String(firstDefined(rawWorld.temperature, rawWorld.temp, cfg.world.temperature)),
    light: cjkOrFallback(firstDefined(rawWorld.light, rawWorld.lighting, cfg.world.light), "光线昏暗"),
    threatLevel: Number(firstDefined(rawWorld.threatLevel, rawWorld.threat_level, cfg.world.threatLevel)),
    dangerLevel: Number(firstDefined(rawWorld.dangerLevel, rawWorld.danger_level, cfg.world.dangerLevel)),
    facts: asStringArray(rawWorld.facts, cfg.world.facts),
    unresolvedTensions: asStringArray(firstDefined(rawWorld.unresolvedTensions, rawWorld.unresolved_tensions, rawWorld.tensions), cfg.world.unresolvedTensions),
    deadlines: Array.isArray(rawWorld.deadlines) && rawWorld.deadlines.length ? rawWorld.deadlines : cfg.world.deadlines,
    hiddenClues: Array.isArray(rawWorld.hiddenClues) && rawWorld.hiddenClues.length
      ? rawWorld.hiddenClues
      : (Array.isArray(rawWorld.hidden_clues) && rawWorld.hidden_clues.length ? rawWorld.hidden_clues : cfg.world.hiddenClues)
  };

  if (rawAgents.length >= 2) {
    cfg.agents = rawAgents.slice(0, 6).map((agent, index) => {
      const fallback = cfg.agents[index % cfg.agents.length] || {};
      const name = String(firstDefined(agent.name, agent.id, fallback.name, `角色 ${index + 1}`));
      const role = String(firstDefined(agent.role, agent.job, agent.archetype, fallback.role, "角色"));
      const publicIdentity = String(firstDefined(
        agent.publicIdentity,
        agent.public_identity,
        agent.public,
        agent.identity,
        agent.visibleIdentity,
        fallback.publicIdentity,
        `${name}公开身份是${role},但细节仍然模糊。`
      ));
      const hiddenIdentity = String(firstDefined(
        agent.hiddenIdentity,
        agent.hidden_identity,
        agent.trueIdentity,
        agent.true_identity,
        agent.privateIdentity,
        agent.secretIdentity,
        fallback.hiddenIdentity,
        `${name}隐藏着一个会改变他人判断的秘密。`
      ));
      const shortTermGoal = String(firstDefined(
        agent.shortTermGoal,
        agent.short_term_goal,
        agent.currentGoal,
        agent.current_goal,
        agent.goal,
        fallback.shortTermGoal,
        "在局势失控前保护自己的利益。"
      ));
      const secrets = Array.isArray(agent.secrets) && agent.secrets.length
        ? agent.secrets
        : [{
            id: `secret-${index + 1}`,
            label: "隐藏身份",
            content: hiddenIdentity,
            triggers: asStringArray(agent.secretTriggers || agent.triggers, [role, name])
          }];
      return {
        ...fallback,
        ...agent,
        id: slugifyId(firstDefined(agent.id, name), `agent-${index + 1}`),
        name,
        role,
        publicIdentity,
        hiddenIdentity,
        shortTermGoal,
        archetype: String(firstDefined(agent.archetype, fallback.archetype, role)),
        personality: String(firstDefined(agent.personality, fallback.personality, "谨慎、带有自我保护倾向。")),
        speechStyle: String(firstDefined(agent.speechStyle, agent.speech_style, fallback.speechStyle, "简短、有防备,会试探他人。")),
        behaviorStyle: String(firstDefined(agent.behaviorStyle, agent.behavior_style, fallback.behaviorStyle, "观察他人反应,避免过早暴露。")),
        backstory: String(firstDefined(agent.backstory, agent.background, fallback.backstory, "")),
        values: asStringArray(agent.values, fallback.values || ["生存", "秘密", "选择"]),
        fears: asStringArray(agent.fears, fallback.fears || ["秘密暴露", "失去控制"]),
        resources: asStringArray(agent.resources, fallback.resources || []),
        knownFacts: asStringArray(agent.knownFacts || agent.known_facts, fallback.knownFacts || []),
        secrets
      };
    });
  }

  const rawItems = Array.isArray(rawWorld.items) && rawWorld.items.length
    ? rawWorld.items
    : (Array.isArray(rawWorld.actionableObjects) && rawWorld.actionableObjects.length
      ? rawWorld.actionableObjects
      : (Array.isArray(rawWorld.actionable_objects) && rawWorld.actionable_objects.length ? rawWorld.actionable_objects : []));
  cfg.world.items = hasConcreteActionSpace(rawItems)
    ? rawItems.map((item, index) => normalizeRawActionableObject(item, index)).filter(Boolean)
    : fallbackActionableItemsForScenario(cfg, cfg.agents, "main_room");

  return cfg;
}

async function scenarioFromPrompt(prompt, generation = {}) {
  const clean = String(prompt || "").trim();
  if (!clean) throw new Error("prompt 不能为空");
  if (!apiKey) {
    generation.method = "local_template";
    generation.fallback = true;
    generation.reason = "OPENAI_API_KEY missing";
    return localScenarioFromPrompt(clean);
  }
  try {
    const result = await callJsonLLM([
      "你是 Agent Society 产品的场景结构化器。",
      "把用户的一句话 prompt 转成可运行的 JSON 场景输入。",
      "必须严格输出 JSON, 顶层字段为 scenario, world, agents。",
      "agents 数量 3 到 5 个。每个 agent 必须有 name, role, publicIdentity, hiddenIdentity, shortTermGoal, personality, speechStyle, behaviorStyle, secrets。",
      "world 必须有 startClock, weather, temperature, light, threatLevel, dangerLevel, facts, unresolvedTensions, deadlines, hiddenClues, items。",
      "items 是行动空间,必须给 6-10 个具体可操作物件/权限/证据,每个 item 必须有 id,label,contents,hidden,holder/location,possibleActions,stakes。禁止 '线索1/物品1/对象1' 这类占位符。",
      "possibleActions 要是角色能做的具体动作,例如 删除日志/投屏视频/锁门/拨打记者电话/抢走录音笔/改写公告邮件/摊开质押合同。",
      "world 还必须有 evidence_atoms 数组,至少 8 条。每条 evidence atom 必须有 id,item_id,label,content,hurts,helps,known_by,hidden_from,if_revealed,status。content 必须是具体事实,例如'事故前三小时儿童安全阈值被手动关闭',不能写'AI事故的详细信息'这种类别名。",
      "content 至少 15 个字,必须落到具体的人、动作或数字上(谁、做了什么、影响多少)。严禁写'设备故障'、'存在内部冲突'、'通信中断'这类只有类别没有细节的句子。",
      "提到时间时只用场景设定的当晚时钟(如 22:40、事故前三小时),严禁写'2023-03-15'这类真实日历日期或与场景年代不符的时间戳。",
      "hurts/helps/known_by/hidden_from 里只能填上面 agents 的真实姓名或 id。严禁出现'宇航员1'、'宇航员2'、'角色A'、'用户1'这类占位代号——证据里提到的人也必须用真实姓名。",
      "不要写解释,不要 Markdown。"
    ].join("\n"), { prompt: clean }, { temperature: 0.7, maxTokens: 1800, modelOverride: scenarioModel, retryModel: repairModel });
    if (!result || typeof result !== "object") throw new Error("LLM 没有返回有效场景");
    generation.method = "llm";
    generation.fallback = false;
    generation.rawTopLevelKeys = Object.keys(result).slice(0, 20);
    return normalizePromptScenarioConfig(result, clean);
  } catch (error) {
    generation.method = "local_template";
    generation.fallback = true;
    generation.reason = error.message || String(error);
    state.societyLog.push({ kind: "prompt_structure_fallback", message: error.message || String(error), turn: state.world.turn });
    return localScenarioFromPrompt(clean);
  }
}

let state = createEmptyState();

function publicState() {
  return {
    ...state,
    agents: state.agents.map((agent) => ({
      ...agent,
      privatePrompt: undefined
    })),
    scenarioInput: lastScenarioInput,
    presets: listPresets()
  };
}

function reconstructionText(value, max = 260) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function reconstructionWords(value) {
  return reconstructionText(value, 1000)
    .toLowerCase()
    .split(/[\s,，。；;、:：!?！？()[\]{}"“”'‘’]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
}

function reconstructionPublicArchive() {
  const agents = (state.agents || []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    publicIdentity: reconstructionText(agent.publicIdentity, 180),
    location: stateLocLabel(agent.location || state.world.defaultLocationId),
    suspicion: Object.fromEntries(Object.entries(agent.suspicions || {}).map(([id, value]) => [id, Number(value)]))
  }));
  const actions = (state.transcript || [])
    .filter((entry) => entry.type === "agent")
    .map((entry) => ({
      turn: entry.turn,
      clock: entry.clock,
      agentId: entry.agentId,
      agent: entry.agentName,
      actionType: entry.actionType,
      target: entry.targetAgentId ? agentDisplayName(entry.targetAgentId) : reconstructionText(entry.target, 80),
      visibleBehavior: reconstructionText(entry.visibleBehavior, 220),
      concreteAction: reconstructionText(entry.concreteAction, 220),
      object: reconstructionText(entry.targetObjectId, 80),
      evidence: reconstructionText(entry.targetEvidenceId, 80),
      stateChange: reconstructionText(entry.intendedStateChange, 180),
      speech: reconstructionText(entry.speech, 220),
      sceneEffect: reconstructionText(entry.sceneEffect, 180),
      relationshipDelta: entry.relationshipDelta || {},
      suspicionUpdate: entry.suspicionUpdate || {}
    }));
  const publicEvents = (state.transcript || [])
    .filter((entry) => entry.type === "director" && entry.text && !entry.meta?.finalScript)
    .map((entry) => ({ turn: entry.turn, clock: entry.clock, title: reconstructionText(entry.title, 80), text: reconstructionText(entry.text, 240) }));
  const items = (state.world.items || []).map((item) => ({
    id: item.id,
    label: item.label,
    holder: item.holder ? agentDisplayName(item.holder) : null,
    location: item.location ? stateLocLabel(item.location) : null,
    state: reconstructionText(item.state, 180),
    discoveredBy: (item.discoveredBy || []).map(agentDisplayName),
    visible: !item.hidden || (item.discoveredBy || []).length > 0
  })).filter((item) => item.visible);
  const evidence = (state.world.evidenceAtoms || [])
    .filter((atom) => atom.status === "revealed" || atom.status === "contested")
    .map((atom) => ({ id: atom.id, label: atom.label, content: reconstructionText(atom.content, 220), status: atom.status }));
  return {
    scenario: { title: state.scenario.title, premise: state.scenario.premise, centralConflict: state.scenario.centralConflict },
    world: { turn: state.world.turn, clock: minutesToClock(state.world.minutes), plotStage: state.world.plotStage, facts: (state.world.facts || []).slice(0, 12), revealedClues: (state.world.revealedClues || []).slice(-12).map((clue) => reconstructionText(clue.label || clue.contents, 180)) },
    agents, actions, publicEvents, items, evidence,
    ledger: { publicFacts: (state.storyLedger?.publicFacts || []).slice(-12), powerShifts: (state.storyLedger?.powerShifts || []).slice(-10), openQuestions: (state.storyLedger?.openQuestions || []).slice(-8) }
  };
}

function normalizeReconstructionOutcome(value, archive) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const text = reconstructionText(typeof value === "string" ? value : (source.text || ""), 500);
  const names = archive.agents.map((agent) => agent.name).filter(Boolean);
  const matchNames = (pattern) => names.filter((name) => pattern.test(`${text} ${name}`) && pattern.test(text));
  const dead = [...new Set([...(Array.isArray(source.dead) ? source.dead : []), ...matchNames(/dead|died|killed|死|死亡|遇害/i)])];
  const escaped = [...new Set([...(Array.isArray(source.escaped) ? source.escaped : []), ...matchNames(/escape|escaped|fled|逃|离开/i)])];
  const alive = [...new Set([...(Array.isArray(source.alive) ? source.alive : []), ...matchNames(/alive|survive|活着|生还/i)])];
  const finalItemHolder = source.finalItemHolder && typeof source.finalItemHolder === "object" ? source.finalItemHolder : {};
  const requiredFacts = Array.isArray(source.requiredFacts) ? source.requiredFacts : [];
  const forbiddenFacts = Array.isArray(source.forbiddenFacts) ? source.forbiddenFacts : [];
  return { text, dead, escaped, alive, finalItemHolder, requiredFacts, forbiddenFacts };
}

function reconstructEvent(body = {}) {
  if (!state || state.empty) throw new Error("请先创建场景并推进至少一个回合。");
  const archive = reconstructionPublicArchive();
  const suppliedOutcome = body.outcome || archive.ledger.publicFacts.slice(-3).join("；") || archive.ledger.powerShifts.slice(-3).join("；");
  const outcome = normalizeReconstructionOutcome(suppliedOutcome || `${archive.scenario.title} 当前停在第 ${archive.world.turn} 回合。`, archive);
  const outcomeText = reconstructionText(outcome.text || JSON.stringify(outcome), 500);
  const evidenceText = reconstructionText(typeof body.evidence === "string" ? body.evidence : (Array.isArray(body.evidence) ? body.evidence.join("；") : ""), 500);
  const queryWords = new Set(reconstructionWords(`${outcomeText} ${evidenceText}`));
  const knownAgents = new Set(archive.agents.map((agent) => agent.name));
  const knownObjects = new Set(archive.items.map((item) => item.label));
  const actionText = (action) => reconstructionText(`${action.actionType} ${action.target} ${action.visibleBehavior} ${action.concreteAction} ${action.object} ${action.evidence} ${action.stateChange} ${action.speech} ${action.sceneEffect}`, 1600);
  const actionLine = (action) => reconstructionText(action.concreteAction || action.visibleBehavior || action.sceneEffect || action.speech || `${action.agent} 采取了 ${action.actionType} 行动。`, 240);
  const scoreAction = (action) => {
    const text = actionText(action);
    const overlap = reconstructionWords(text).filter((word) => queryWords.has(word)).length;
    const physical = /move|take|use|inspect|search|steal|escape|follow|reveal|betray|拿|取|用|检查|搜|移|逃|跟|揭|背叛|刺|杀|死/i.test(text) ? 2 : 0;
    return overlap + physical + (action.target || action.object || action.evidence ? 1 : 0);
  };
  const ranked = [...archive.actions].map((action) => ({ action, score: scoreAction(action) })).sort((a, b) => b.score - a.score || b.action.turn - a.action.turn);
  const relevant = ranked.filter((entry) => entry.score > 0).slice(0, 12).map((entry) => entry.action);
  const chain = relevant.length ? relevant : archive.actions.slice(-8);
  const toStep = (action, inference = null) => ({ turn: action.turn, clock: action.clock, actor: action.agent, action: actionLine(action), object: action.object || null, target: action.target || null, inference });
  const observedSteps = chain.slice(-8).sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0)).map((action) => toStep(action));
  const publicSupport = archive.evidence.concat(archive.items.filter((item) => item.state).map((item) => ({ label: item.label, content: item.state, status: "observed" })));
  const support = publicSupport.slice(-6).map((item) => `${item.label || "现场记录"}: ${item.content || item.status}`);
  const validate = (steps) => {
    const violations = [];
    const missing = [];
    let previousTurn = -Infinity;
    for (const step of steps) {
      if (!knownAgents.has(step.actor) && step.actor !== "分裂归责") violations.push(`未知角色：${step.actor}`);
      if (step.object && !knownObjects.has(step.object)) violations.push(`未知物件：${step.object}`);
      if (Number.isFinite(Number(step.turn)) && Number(step.turn) < previousTurn) violations.push("行动时间顺序倒置");
      previousTurn = Math.max(previousTurn, Number(step.turn) || previousTurn);
    }
    const joined = steps.map((step) => step.action).join("；");
    for (const name of outcome.dead) if (!steps.some((step) => step.actor === name || step.action.includes(name))) missing.push(`未公开记录 ${name} 的死亡转换`);
    for (const name of outcome.escaped) if (!steps.some((step) => step.actor === name && /escape|fled|逃|离开/i.test(step.action))) missing.push(`未公开记录 ${name} 的逃离动作`);
    for (const fact of outcome.requiredFacts) if (!joined.includes(String(fact))) missing.push(`缺少结果事实：${fact}`);
    for (const fact of outcome.forbiddenFacts) if (joined.includes(String(fact))) violations.push(`违反禁止事实：${fact}`);
    return { status: violations.length ? "contradicted" : (missing.length ? "underdetermined" : "consistent"), violations, missing };
  };
  const actorCounts = new Map();
  for (const action of chain) actorCounts.set(action.agent, (actorCounts.get(action.agent) || 0) + 1);
  const leadingActor = [...actorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || archive.agents[0]?.name || "未知角色";
  const makeCandidate = (id, label, framing, actor, steps, bonus = 0) => {
    const validation = validate(steps);
    return { id, label, framing, leadActor: actor, supportScore: Math.max(0, Math.min(100, 35 + steps.length * 5 + bonus - validation.violations.length * 25)), status: validation.status, steps, supportingEvidence: support.slice(0, 4), unresolvedContradictions: [...validation.violations, ...validation.missing].slice(0, 6), responsibility: `档案可把这条路径追到 ${actor} 的已记录行动，但不能从公开记录证明其完整意图。` };
  };
  const reversed = [...observedSteps].reverse().map((step, index) => ({ ...step, inference: index === 0 ? "结果所需的最近行动" : "由前一步倒推的必要前置" }));
  const candidates = [
    makeCandidate("observed-chain", "Observed chain", "从已记录的公开行动向后追踪，不补写缺失动作。", leadingActor, observedSteps, 12),
    makeCandidate("motive-chain", "Motive-compatible chain", "优先排列与角色公开身份、关系变化和物件可达性相容的行动。", leadingActor, observedSteps.slice(-Math.max(3, Math.ceil(observedSteps.length / 2))), 4),
    makeCandidate("contested-chain", "Contested responsibility", "把工具、机会和最后动作拆给不同角色，保留无法唯一归责的部分。", "分裂归责", reversed.slice(0, 6), -2)
  ];
  return { type: "inverse-reconstruction", version: 2, principle: "从公开档案反推候选过程；不输出唯一真相，不把支持分数当概率。", query: { outcome: outcomeText, outcomeSchema: outcome, evidence: evidenceText }, constraints: { hard: ["只使用场景中已有角色、地点和物件", "过程顺序不能晚于已知结果", "显式结果约束不满足时标记为 contradicted，无法由公开档案确认时标记为 underdetermined"], observedActors: archive.agents.map((agent) => agent.name), observedObjects: archive.items.map((item) => item.label), observedTurns: archive.world.turn }, candidates, archiveSummary: { publicActions: archive.actions.length, publicEvidence: publicSupport.length, unresolvedQuestions: archive.ledger.openQuestions.length }, limitations: ["这是候选过程重建，不是事实裁决。", "私有意图、未揭露秘密和模型内部状态不作为公开证据。", "缺失证据是 underdetermined，不等于反证。"] };
}

function pushDirectorEntry(title, text, meta = {}) {
  const entry = {
    id: `d-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "director",
    title,
    text,
    meta,
    turn: state.world.turn,
    clock: minutesToClock(state.world.minutes),
    createdAt: nowIso()
  };
  state.transcript.push(entry);
  state.societyLog.push({ kind: "director", title, text, turn: state.world.turn });
  return entry;
}

function pushAgentEntry(agent, action) {
  const entry = {
    id: `a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "agent",
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    actionType: action.action_type || "speak",
    target: action.target || null,
    speech: action.speech || "",
    visibleBehavior: action.visible_behavior || "",
    privateIntent: action.private_intent || "",
    targetAgentId: action.target_agent_id || null,
    tactic: action.tactic || "",
    concreteAction: action.concrete_action || "",
    targetObjectId: action.target_object_id || "",
    targetEvidenceId: action.target_evidence_id || "",
    evidenceAction: action.evidence_action || "",
    risk: action.risk || "",
    intendedStateChange: action.intended_state_change || "",
    dialogueIntent: action.dialogue_intent || "",
    leverage: action.leverage || "",
    whatToReveal: action.what_to_reveal || "",
    whatToHide: action.what_to_hide || "",
    subtext: action.subtext || "",
    dramaBeatId: action.drama_beat_id || "",
    emotionDelta: action.emotion_delta || {},
    relationshipDelta: action.relationship_delta || {},
    suspicionUpdate: action.suspicion_update || {},
    knownFactsAdd: action.known_facts_add || [],
    nextIntendedAction: action.next_intended_action || "",
    prethink: action.prethink || null,
    memoryWrite: action.memory_write || "",
    sceneEffect: action.scene_effect || "",
    simulation: action.simulation || null,
    turn: state.world.turn,
    clock: minutesToClock(state.world.minutes),
    createdAt: nowIso()
  };
  state.transcript.push(entry);
  state.societyLog.push({
    kind: "agent_action",
    agentId: agent.id,
    actionType: entry.actionType,
    speech: entry.speech,
    intent: entry.privateIntent,
    turn: state.world.turn
  });
  return entry;
}

function buildUserCueEvent(userCue) {
  if (!userCue) return null;
  // 导演干预 = 用户主动注入的剧本变更。给一个更高的 threat,让后面 applyDirectorEvent
  // 据此真正拨动 pressure / fear / suspicion,而不是一行 transcript 就被噪声盖掉。
  return { title: "导演干预", text: userCue, threat: 12, resource: null, userCue: true };
}

function applyDirectorEvent(event) {
  if (!event) return null;
  const isAmbient = Boolean(event.ambient);
  const isUserCue = Boolean(event.userCue);
  const threat = Math.max(0, Number(event.threat) || (isAmbient ? 1 : 5));
  state.world.activeEvent = { title: event.title, text: event.text, ambient: isAmbient, userCue: isUserCue };
  state.world.threatLevel = clamp(state.world.threatLevel + (isAmbient ? 1 : threat));
  // userCue: pressure 全额冲击;非 userCue 仍按 0.7x 折算
  state.director.pressure = clamp(state.director.pressure + (isAmbient ? 1 : (isUserCue ? threat : Math.ceil(threat * 0.7))));
  if (event.resource && state.world.resources[event.resource] !== undefined) {
    state.world.resources[event.resource] = clamp(state.world.resources[event.resource] - (isAmbient ? 4 : 16));
  }
  if (!isAmbient) {
    for (const agent of state.agents) {
      // userCue: 情绪层留下更明显印记 (0.7x 而不是 0.5x)
      agent.status.fear = clamp(agent.status.fear + (isUserCue ? Math.ceil(threat * 0.7) : Math.ceil(threat * 0.5)));
      // userCue: 整体 suspicion 上扬幅度也更大,反映现场刚被注入新变量
      agent.status.suspicion = clamp(agent.status.suspicion + (isUserCue ? 4 : 3));
    }
  }
  if (event.userCue) {
    state.director.interventions.push({ turn: state.world.turn, kind: "cue", text: event.text });
    state.director.interventions = state.director.interventions.slice(-12);
  }
  return pushDirectorEntry(event.title, event.text, { threat, ambient: isAmbient, userCue: isUserCue });
}

function agentSnapshot(agent) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    archetype: agent.archetype,
    age: agent.age,
    publicIdentity: agent.publicIdentity,
    hiddenIdentity: agent.hiddenIdentity,
    personality: agent.personality,
    backstory: agent.backstory,
    values: agent.values,
    shortTermGoal: agent.shortTermGoal,
    longTermGoal: agent.longTermGoal,
    fears: agent.fears,
    speechStyle: agent.speechStyle,
    behaviorStyle: agent.behaviorStyle,
    currentAction: agent.currentAction,
    nextIntendedAction: agent.nextIntendedAction,
    resources: agent.resources,
    knownFacts: agent.knownFacts.slice(-12),
    suspicions: agent.suspicions, // 独立于情绪 suspicion：对每个人 0–100
    secrets: agent.secrets.map((secret) => ({
      id: secret.id,
      label: secret.label,
      content: secret.content,
      exposure: secret.exposure,
      revealed: secret.revealed
    })),
    status: agent.status,
    relationships: agent.relationships,
    privateMemories: agent.privateMemories.slice(-5),
    publicMemories: agent.publicMemories.slice(-5),
    lastActions: agent.lastActions.slice(-3)
  };
}

function actionObjectView(item, agent, knownItemIds = new Set()) {
  const holderName = item.holder ? agentDisplayName(item.holder) : null;
  const locationLabel = item.location ? stateLocLabel(item.location) : null;
  const known = knownItemIds.has(item.id) || item.holder === agent.id || !item.hidden;
  return {
    id: item.id,
    label: item.label,
    holderAgentId: item.holder || null,
    holderName,
    location: item.location || null,
    locationLabel,
    hidden: !!item.hidden && !known,
    knownContents: known ? item.contents : null,
    possibleActions: (item.possibleActions || []).slice(0, 6),
    stakes: item.stakes || "",
    state: item.state || "未触发",
    lastAction: item.lastAction || ""
  };
}

function actionSpaceForAgent(agent, knownItemIds) {
  const myLocId = agent.location || state.world.defaultLocationId;
  const coLocatedIds = new Set(state.agents
    .filter((a) => (a.location || state.world.defaultLocationId) === myLocId)
    .map((a) => a.id));
  const primary = (state.world.items || []).filter((item) => {
    if (item.holder === agent.id) return true;
    if (item.location === myLocId) return true;
    if (item.holder && coLocatedIds.has(item.holder)) return true;
    if (!item.hidden && !item.holder) return true;
    return knownItemIds.has(item.id);
  });
  const seen = new Set();
  const ranked = primary
    .concat((state.world.items || []).filter((item) => !item.hidden).slice(0, 4))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 10)
    .map((item) => actionObjectView(item, agent, knownItemIds));
  return {
    rule: "本轮优先从 availableObjects 中选一个 target_object_id,再选择它的 possibleActions 之一改造成具体战术。",
    availableObjects: ranked
  };
}

const DRAMA_ACTS = {
  setup: { id: "act1_setup", label: "第一幕·立局", mission: "建立欲望、危险和第一件可被争夺的东西。" },
  suspicion: { id: "act2_pressure", label: "第二幕·加压", mission: "让角色目标互相挤压,把怀疑落到证据或代价上。" },
  confrontation: { id: "act3_collision", label: "第三幕·碰撞", mission: "让某个角色主动出手,夺取、公开、锁住或交易关键物。" },
  revelation: { id: "act4_reversal", label: "第四幕·反转", mission: "让隐藏事实改变关系和策略,迫使角色重新站队。" },
  resolution: { id: "act5_consequence", label: "第五幕·后果", mission: "让角色承担选择后果,形成不可逆收束。" }
};

const DRAMA_BEAT_LIBRARY = {
  act1_setup: [
    { type: "desire_enters_object", title: "欲望落物", requiredActionTypes: ["use", "inspect", "search"], requiredChange: "让一个关键物件从背景变成争夺焦点。", tactics: ["打开", "出示", "调取", "投屏"] },
    { type: "first_disturbance", title: "第一扰动", requiredActionTypes: ["use", "move", "lock"], requiredChange: "让现场秩序被打断,角色不能继续寒暄。", tactics: ["锁上", "播放", "拨打", "发送"] },
    { type: "private_goal_leaks", title: "私欲露边", requiredActionTypes: ["hide", "use", "lie"], requiredChange: "让某个角色为了目标暴露一丝异常。", tactics: ["藏起", "删除", "撤回", "改写"] }
  ],
  act2_pressure: [
    { type: "proof_over_talk", title: "证据压过语言", requiredActionTypes: ["use", "inspect", "search"], requiredChange: "让争论转向可验证证据。", tactics: ["投屏", "摊开", "调取", "播放"] },
    { type: "leverage_shift", title: "筹码换手", requiredActionTypes: ["steal", "use", "negotiate"], requiredChange: "让筹码、权限或信息的控制者发生变化。", tactics: ["抢走", "交换", "作为筹码", "交给他人"] },
    { type: "cost_named", title: "代价点名", requiredActionTypes: ["use", "threaten", "negotiate"], requiredChange: "把抽象冲突变成某人必须承受的具体代价。", tactics: ["威胁", "摊开", "宣读", "延迟"] }
  ],
  act3_collision: [
    { type: "direct_contest", title: "正面争夺", requiredActionTypes: ["steal", "use", "lock"], requiredChange: "让至少两人围绕同一物件发生正面冲突。", tactics: ["抢走", "锁门", "关掉", "拿走"] },
    { type: "irreversible_send", title: "不可逆外传", requiredActionTypes: ["use"], requiredChange: "把一条秘密推向外部,让局面无法回到原点。", tactics: ["发送", "拨打", "转发", "呼叫"] },
    { type: "alliance_or_betrayal", title: "结盟或背叛", requiredActionTypes: ["ally", "betray", "use", "negotiate"], requiredChange: "让关系站位发生变化,并绑定到一个具体筹码。", tactics: ["交换", "交给他人", "摊开", "作为筹码"] }
  ],
  act4_reversal: [
    { type: "partial_reveal", title: "局部揭露", requiredActionTypes: ["reveal", "use"], requiredChange: "揭开一部分秘密,但留下更尖锐的新问题。", tactics: ["出示", "播放", "宣读", "摊开"] },
    { type: "meaning_flips", title: "意义反转", requiredActionTypes: ["use", "challenge", "negotiate"], requiredChange: "让同一个物件的意义反过来指向另一个人。", tactics: ["调取", "投屏", "复制", "摊开"] },
    { type: "forced_choice", title: "被迫选择", requiredActionTypes: ["use", "threaten", "escape", "lock"], requiredChange: "让角色必须在两个损失之间选一个。", tactics: ["锁上", "发送", "删除", "拨打"] }
  ],
  act5_consequence: [
    { type: "payoff_choice", title: "选择兑现", requiredActionTypes: ["use", "reveal", "betray", "escape"], requiredChange: "让前面埋下的物件或秘密产生最终后果。", tactics: ["发送", "公开", "撕毁", "离开"] },
    { type: "sacrifice_or_cover", title: "牺牲或遮蔽", requiredActionTypes: ["hide", "use", "negotiate"], requiredChange: "让一个角色用损失换取目标、同盟或沉默。", tactics: ["藏起", "撤回", "交换沉默", "交给他人"] },
    { type: "new_order", title: "新秩序", requiredActionTypes: ["use", "ally", "lock", "move"], requiredChange: "让现场权力关系定型,不再只是讨论。", tactics: ["锁上", "宣读", "交给他人", "改写"] }
  ]
};

function dramaActForTurn() {
  const stage = state.world.plotStage || "setup";
  return DRAMA_ACTS[stage] || DRAMA_ACTS.setup;
}

function knownItemIdsForAgent(agent) {
  return new Set((state.world.items || [])
    .filter((item) => Array.isArray(item.discoveredBy) && item.discoveredBy.includes(agent.id))
    .map((item) => item.id));
}

function chooseBeatFocusAgent(actors) {
  const pool = actors && actors.length ? actors : state.agents;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => {
    const aHeat = (a.status?.fear || 0) + (a.status?.suspicion || 0) + (a.status?.resolve || 0);
    const bHeat = (b.status?.fear || 0) + (b.status?.suspicion || 0) + (b.status?.resolve || 0);
    return bHeat - aHeat;
  })[state.world.turn % pool.length];
}

function chooseBeatTargetAgent(focusAgent) {
  if (!focusAgent) return null;
  const myLocId = focusAgent.location || state.world.defaultLocationId;
  const coLocated = state.agents.filter((agent) =>
    agent.id !== focusAgent.id && (agent.location || state.world.defaultLocationId) === myLocId);
  if (!coLocated.length) return null;
  return coLocated.slice().sort((a, b) => (focusAgent.suspicions[b.id] || 50) - (focusAgent.suspicions[a.id] || 50))[0];
}

function chooseBeatRoleAgents(focusAgent, targetAgent, actors = []) {
  const pool = (actors.length ? actors : state.agents).filter(Boolean);
  const others = state.agents.filter((agent) => agent.id !== focusAgent?.id);
  const resistor = targetAgent || others
    .slice()
    .sort((a, b) => (b.status?.resolve || 0) + (b.status?.suspicion || 0) - ((a.status?.resolve || 0) + (a.status?.suspicion || 0)))[0]
    || null;
  const witness = state.agents.find((agent) => agent.id !== focusAgent?.id && agent.id !== resistor?.id)
    || pool.find((agent) => agent.id !== focusAgent?.id)
    || null;
  const opportunist = state.agents.find((agent) =>
    agent.id !== focusAgent?.id &&
    agent.id !== resistor?.id &&
    agent.id !== witness?.id &&
    /形象|钱|利益|股票|机会|升迁|交易|外部|记者|证据|公开|保密/.test(`${agent.shortTermGoal} ${agent.hiddenIdentity} ${agent.resources?.join(" ")}`))
    || null;
  return { driver: focusAgent || null, resistor, target: targetAgent || resistor || null, witness, opportunist };
}

function chooseBeatEvidenceAtom(focusObject, focusAgent, roles, template) {
  const atoms = state.world.evidenceAtoms || [];
  if (!atoms.length) return null;
  const recentIds = new Set((state.director.beatHistory || []).slice(-3).map((beat) => beat.evidenceAtomId).filter(Boolean));
  const alive = atoms.filter((atom) => atom.status !== "destroyed");
  // 优先用 focusObject 的、且最近没在 beat 里用过的原子;
  // 若都被用过,放开 focusObject 限制,从全部存活原子里挑——避免整场围着同一条证据复读。
  const focusFresh = focusObject ? alive.filter((atom) => atom.itemId === focusObject.id && !recentIds.has(atom.id)) : [];
  const globalFresh = alive.filter((atom) => !recentIds.has(atom.id));
  const pool = focusFresh.length ? focusFresh : (globalFresh.length ? globalFresh : alive);
  if (!pool.length) return null;
  const roleIds = [roles.driver?.id, roles.resistor?.id, roles.target?.id, roles.witness?.id].filter(Boolean);
  const roleRelevant = pool.filter((atom) =>
    (atom.hurtsAgentIds || []).some((id) => roleIds.includes(id)) ||
    (atom.helpsAgentIds || []).some((id) => roleIds.includes(id)) ||
    (atom.knownByAgentIds || []).some((id) => roleIds.includes(id))
  );
  // 主排序键:beat 使用次数越少越优先(轮换证据);次级键:戏剧分(hidden/伤害/有后果)。
  const ranked = (roleRelevant.length ? roleRelevant : pool).slice().sort((a, b) => {
    const aUsed = a.beatUseCount || 0;
    const bUsed = b.beatUseCount || 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    const aScore = (a.status === "hidden" ? 3 : 0) + ((a.hurtsAgentIds || []).length ? 2 : 0) + ((a.ifRevealed || "").length ? 1 : 0);
    const bScore = (b.status === "hidden" ? 3 : 0) + ((b.hurtsAgentIds || []).length ? 2 : 0) + ((b.ifRevealed || "").length ? 1 : 0);
    return bScore - aScore;
  });
  // 在「使用次数最少」这一档里再用 hash 取一个,增加随机性。
  const minUsed = ranked[0].beatUseCount || 0;
  const leastUsed = ranked.filter((atom) => (atom.beatUseCount || 0) === minUsed);
  const chosen = leastUsed[hashText(`${state.world.turn}|${template.type}|${focusAgent?.id || ""}`) % leastUsed.length] || ranked[0];
  if (chosen) chosen.beatUseCount = (chosen.beatUseCount || 0) + 1;
  return chosen || null;
}

function beatEvidenceFromObject(item, template, roles, atom = null) {
  if (atom) {
    const hurt = (atom.hurtsAgentIds || []).map(agentDisplayName).filter(Boolean).join("、") || "某个角色";
    const help = (atom.helpsAgentIds || []).map(agentDisplayName).filter(Boolean).join("、") || roles.driver?.name || "推动者";
    return {
      evidence: `${atom.label}: ${atom.content}`,
      newFact: atom.content,
      dramaticUse: `${help}可以用这条事实压缩${hurt}的选择空间。${atom.ifRevealed || ""}`.trim()
    };
  }
  const contents = compactLine(item?.contents || item?.stakes || "", 220);
  const stateText = compactLine(item?.state && item.state !== "未触发" ? item.state : "", 180);
  const driver = roles.driver?.name || "推动者";
  const target = roles.target?.name || roles.resistor?.name || "目标角色";
  if (contents) {
    return {
      evidence: `${item.label}: ${contents}`,
      newFact: stateText || `${driver}可以把「${item.label}」里的具体内容变成对${target}不利的事实。`
    };
  }
  return {
    evidence: item?.label ? `${item.label}的状态还没有被说清。` : "本轮必须把一个具体证据说清。",
    newFact: `${driver}必须让一个可验证事实进入现场,而不是只重复立场。`
  };
}

function chooseBeatObject(focusAgent, template) {
  if (!focusAgent) return null;
  const actionSpace = actionSpaceForAgent(focusAgent, knownItemIdsForAgent(focusAgent));
  const objects = actionSpace.availableObjects || [];
  if (!objects.length) return null;
  const byTactic = objects.find((obj) =>
    (obj.possibleActions || []).some((action) => (template.tactics || []).some((tactic) => String(action).includes(tactic) || String(tactic).includes(action))));
  if (byTactic) return (state.world.items || []).find((item) => item.id === byTactic.id) || null;
  const withStakes = objects.find((obj) => obj.stakes || obj.state !== "未触发");
  const picked = withStakes || objects[hashText(`${focusAgent.id}|${template.type}|${state.world.turn}`) % objects.length];
  return (state.world.items || []).find((item) => item.id === picked.id) || null;
}

function createDramaBeat(actors, userCue = "") {
  const act = dramaActForTurn();
  const templates = DRAMA_BEAT_LIBRARY[act.id] || DRAMA_BEAT_LIBRARY.act1_setup;
  const templateSeed = `${act.id}|${state.world.turn}|${state.world.threatLevel}|${userCue || ""}`;
  const template = userCue
    ? { type: "director_cue_beat", title: "导演干预落地", requiredActionTypes: ["use", "move", "reveal", "negotiate", "threaten"], requiredChange: "把导演干预转成一个可见、可验证的现场变化。", tactics: ["打开", "发送", "锁上", "摊开", "拨打"] }
    : templates[hashText(templateSeed) % templates.length];
  const focusAgent = chooseBeatFocusAgent(actors);
  const targetAgent = chooseBeatTargetAgent(focusAgent);
  const focusObject = chooseBeatObject(focusAgent, template);
  const roles = chooseBeatRoleAgents(focusAgent, targetAgent, actors);
  const evidenceAtom = chooseBeatEvidenceAtom(focusObject, focusAgent, roles, template);
  const atomObject = evidenceAtom?.itemId
    ? ((state.world.items || []).find((item) => item.id === evidenceAtom.itemId) || focusObject)
    : focusObject;
  const evidence = beatEvidenceFromObject(atomObject, template, roles, evidenceAtom);
  const objectLabel = focusObject?.label || "一个具体筹码";
  const targetName = targetAgent?.name || "其他人";
  const focusName = focusAgent?.name || "某个角色";
  return {
    id: `beat-${state.world.turn}-${Math.random().toString(16).slice(2, 8)}`,
    turn: state.world.turn,
    act: act.id,
    actLabel: act.label,
    actMission: act.mission,
    beatType: template.type,
    title: template.title,
    focusAgentId: focusAgent?.id || null,
    focusAgentName: focusName,
    targetAgentId: targetAgent?.id || null,
    targetAgentName: targetAgent?.name || "",
    focusObjectId: (atomObject || focusObject)?.id || null,
    focusObjectLabel: (atomObject || focusObject)?.label || "",
    evidenceAtomId: evidenceAtom?.id || null,
    evidenceAtom: evidenceAtom ? evidenceLedgerView(evidenceAtom) : null,
    evidenceContent: evidenceAtom?.content || evidence.evidence,
    evidenceHurts: (evidenceAtom?.hurtsAgentIds || []).map(agentDisplayName),
    evidenceHelps: (evidenceAtom?.helpsAgentIds || []).map(agentDisplayName),
    evidenceIfRevealed: evidenceAtom?.ifRevealed || evidence.newFact,
    evidenceDramaticUse: evidence.dramaticUse || "",
    driverAgentId: roles.driver?.id || null,
    driverAgentName: roles.driver?.name || "",
    resistorAgentId: roles.resistor?.id || null,
    resistorAgentName: roles.resistor?.name || "",
    witnessAgentId: roles.witness?.id || null,
    witnessAgentName: roles.witness?.name || "",
    opportunistAgentId: roles.opportunist?.id || null,
    opportunistAgentName: roles.opportunist?.name || "",
    evidence: evidence.evidence,
    newFact: evidence.newFact,
    requiredActionTypes: template.requiredActionTypes,
    suggestedTactics: template.tactics || [],
    dramaticQuestion: evidenceAtom
      ? `${focusName}会不会用「${evidenceAtom.label}」迫使${targetName}改变策略?`
      : `${focusName}会不会用「${objectLabel}」迫使${targetName}改变策略?`,
    requiredChange: template.requiredChange,
    irreversibleChange: targetAgent
      ? `${targetAgent.name}不能再用上一轮同一种说法维持原状。`
      : "至少一个角色的选择空间必须被压缩。",
    roleContract: [
      roles.driver ? `${roles.driver.name}=推动者,必须制造变化。` : "",
      roles.resistor ? `${roles.resistor.name}=阻挡者,必须保护自己的目标或秘密。` : "",
      roles.witness ? `${roles.witness.name}=见证者,必须因为新事实改变判断。` : "",
      roles.opportunist ? `${roles.opportunist.name}=机会主义者,可以借机交换、倒向或加码。` : ""
    ].filter(Boolean),
    constraints: [
      "必须产生可见状态变化,不能只是互相质问。",
      evidenceAtom ? `必须围绕具体事实「${evidenceAtom.label}」行动,不能只说物件名。` : (focusObject ? `必须让「${focusObject.label}」进入行动、交易、威胁或隐藏。` : "必须选择一个具体物件或权限作为筹码。"),
      targetAgent ? `必须改变${focusName}与${targetAgent.name}之间的信息、筹码或信任关系。` : "必须改变至少一个角色的可用选择。"
    ],
    successCriteria: [
      "至少一个 action 命中 requiredActionTypes。",
      "至少一个 action 有 target_evidence_id,且台词/动作点明证据内容。",
      "回合结束时物件/怀疑/位置/秘密/危险至少一项发生变化。"
    ],
    status: "planned",
    resolution: "",
    fulfilledBy: [],
    missedReasons: []
  };
}

function dramaBeatSummaryLines(beat) {
  if (!beat) return [];
  const lines = [
    `${beat.actLabel}：${beat.title}`,
    `戏剧问题：${beat.dramaticQuestion}`,
    `本回合变化：${beat.requiredChange}`
  ];
  if (beat.focusObjectLabel) lines.push(`焦点物件：${beat.focusObjectLabel}`);
  if (beat.evidenceAtom?.label) lines.push(`证据原子：${beat.evidenceAtom.label} - ${beat.evidenceAtom.content}`);
  if (beat.evidenceIfRevealed) lines.push(`揭露后果：${beat.evidenceIfRevealed}`);
  if (beat.suggestedTactics?.length) lines.push(`建议动作：${beat.suggestedTactics.slice(0, 4).join(" / ")}`);
  return lines;
}

function installDramaBeat(actors, userCue) {
  const beat = createDramaBeat(actors, userCue);
  state.director.currentBeat = beat;
  state.director.beatHistory = [...(state.director.beatHistory || []), beat].slice(-30);
  const entry = pushDirectorEntry("戏剧Beat", dramaBeatSummaryLines(beat).join("\n"), {
    dramaBeat: true,
    beat
  });
  state.societyLog.push({
    kind: "drama_beat_planned",
    turn: state.world.turn,
    beatId: beat.id,
    act: beat.act,
    beatType: beat.beatType,
    focusAgentId: beat.focusAgentId,
    focusObjectId: beat.focusObjectId,
    message: `${beat.actLabel} · ${beat.title}: ${beat.requiredChange}`
  });
  return { beat, entry };
}

function societySnapshotFor(agent) {
  let lastTargetingMe = null;
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const entry = state.transcript[i];
    if (entry.type !== "agent") continue;
    if (entry.agentId === agent.id) continue;
    if (entry.targetAgentId === agent.id) {
      lastTargetingMe = {
        from: entry.agentName,
        fromId: entry.agentId,
        actionType: entry.actionType,
        speech: entry.speech,
        visibleBehavior: entry.visibleBehavior,
        clock: entry.clock,
        turn: entry.turn
      };
      break;
    }
  }

  const myRecent = state.transcript
    .filter((entry) => entry.type === "agent" && entry.agentId === agent.id)
    .slice(-3)
    .map((entry) => ({ actionType: entry.actionType, speech: entry.speech, turn: entry.turn }));

  // 原文列出自己最近说过的话，供 LLM 反重复比对
  const myLastSpeeches = state.transcript
    .filter((entry) => entry.type === "agent" && entry.agentId === agent.id && entry.speech)
    .slice(-3)
    .map((entry) => entry.speech);

  // 上一件“发生的事”（另一个人的发言、或者导演事件）
  let immediatePrevious = null;
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const entry = state.transcript[i];
    if (entry.type === "director" && entry.text) {
      immediatePrevious = { type: "director", title: entry.title, text: entry.text, ambient: Boolean(entry.meta?.ambient) };
      break;
    }
    if (entry.type === "agent" && entry.agentId !== agent.id && (entry.speech || entry.visibleBehavior)) {
      immediatePrevious = {
        type: "agent",
        from: entry.agentName,
        fromId: entry.agentId,
        actionType: entry.actionType,
        speech: entry.speech,
        visibleBehavior: entry.visibleBehavior,
        targetAgentId: entry.targetAgentId
      };
      break;
    }
  }

  // V2: 当前位置 + 同位人员 + 可见物品 + 已知物品
  const myLocId = agent.location || state.world.defaultLocationId;
  const myLoc = state.world.locations.find((l) => l.id === myLocId) || null;
  const exitsHere = (state.world.exits || []).filter((e) => e.fromLocation === myLocId).map((e) => ({
    id: e.id,
    label: e.label,
    toLocation: e.toLocation,
    toLocationLabel: (state.world.locations.find((l) => l.id === e.toLocation) || {}).label || e.toLocation,
    locked: !!e.locked
  }));
  const coLocated = state.agents.filter((a) => a.id !== agent.id && (a.location || state.world.defaultLocationId) === myLocId)
    .map((a) => ({ id: a.id, name: a.name, role: a.role }));

  const knownItemIds = new Set(
    (state.world.items || [])
      .filter((it) => Array.isArray(it.discoveredBy) && it.discoveredBy.includes(agent.id))
      .map((it) => it.id)
  );
  const itemsHere = (state.world.items || [])
    .filter((it) => it.location === myLocId && (!it.hidden || knownItemIds.has(it.id)))
    .map((it) => ({
      id: it.id,
      label: it.label,
      hidden: !!it.hidden && !knownItemIds.has(it.id),
      holderAgentId: it.holder || null,
      // 仅当我已检查过才把内容暴露给我;否则只露 label
      contents: knownItemIds.has(it.id) ? it.contents : null
    }));
  // 我自己持有的物品(不论 location 在哪)
  const itemsHeldByMe = (state.world.items || [])
    .filter((it) => it.holder === agent.id)
    .map((it) => ({ id: it.id, label: it.label, contents: knownItemIds.has(it.id) ? it.contents : null }));
  // 已知所有物品(包括别处但被我检查/听说过的)
  const itemsKnownToMe = (state.world.items || [])
    .filter((it) => knownItemIds.has(it.id))
    .map((it) => ({ id: it.id, label: it.label, contents: it.contents, location: it.location, holderAgentId: it.holder || null }));
  const actionSpace = actionSpaceForAgent(agent, knownItemIds);

  // V2: 我对别人的怀疑(0~100),驱动行为模式
  const suspicionsTowards = {};
  for (const other of state.agents) {
    if (other.id === agent.id) continue;
    suspicionsTowards[other.id] = typeof agent.suspicions[other.id] === "number" ? agent.suspicions[other.id] : 50;
  }

  // V2: 沉默封顶
  const silenceStreak = agent.consecutiveSilenceTurns || 0;

  // V2: 谁可能正在高度怀疑我(用别人对我的 suspicions[agent.id])
  const likelyExposedBy = state.agents
    .filter((a) => a.id !== agent.id)
    .map((a) => ({ id: a.id, name: a.name, theirSuspicionOnMe: typeof a.suspicions?.[agent.id] === "number" ? a.suspicions[agent.id] : 50 }))
    .filter((x) => x.theirSuspicionOnMe >= 70);

  // V2.2: 把"导演干预"从 interventions 里专门挑出来,作为最高优先级信号
  //   thisTurn 非空 = 用户/导演刚刚下达了现场指令,本轮必须直接响应
  //   prev    保留最近 2 条,让指令在下一回合也还粘一拍,避免单轮被噪声吃掉
  const cueEntries = (state.director.interventions || []).filter((iv) => iv.kind === "cue");
  const cueThisTurn = cueEntries.find((iv) => iv.turn === state.world.turn) || null;
  const cuePrev = cueEntries.filter((iv) => iv.turn !== state.world.turn).slice(-2);
  const directorCue = {
    thisTurn: cueThisTurn ? cueThisTurn.text : null,
    prev: cuePrev.map((iv) => ({ turn: iv.turn, text: iv.text }))
  };

  return {
    scenario: state.scenario,
    world: {
      turn: state.world.turn,
      clock: minutesToClock(state.world.minutes),
      minutes: state.world.minutes,
      weather: state.world.weather,
      temperature: state.world.temperature,
      light: state.world.light,
      threatLevel: state.world.threatLevel,
      dangerLevel: state.world.dangerLevel,
      plotStage: state.world.plotStage,
      pressure: state.director.pressure,
      // 距下一个未触发 deadline 还有多久
      upcomingDeadlines: state.world.deadlines
        .filter((d) => !d.fired)
        .map((d) => ({ id: d.id, label: d.label, atClock: minutesToClock(d.atMinutes), minutesLeft: d.atMinutes - state.world.minutes })),
      revealedClues: state.world.revealedClues.slice(-8),
      unresolvedTensions: state.world.unresolvedTensions.slice(-6),
      facts: state.world.facts.slice(-6),
      activeEvent: state.world.activeEvent,
      // V2 物理
      myLocation: myLoc ? { id: myLoc.id, label: myLoc.label } : null,
      exitsHere,
      coLocated,
      itemsHere,
      itemsHeldByMe,
      itemsKnownToMe,
      evidenceAtoms: (state.world.evidenceAtoms || []).filter((atom) => {
        if (!atom.itemId) return true;
        const item = (state.world.items || []).find((it) => it.id === atom.itemId);
        if (!item) return true;
        return !item.hidden || item.holder === agent.id || (item.discoveredBy || []).includes(agent.id) || (atom.knownByAgentIds || []).includes(agent.id);
      }).slice(0, 16).map(evidenceLedgerView),
      actionSpace,
      patrol: state.world.patrol ? {
        distanceMeters: state.world.patrol.distanceMeters,
        arrivedTurn: state.world.patrol.arrivedTurn
      } : null,
      train: state.world.train || null
    },
    self: {
      ...agentSnapshot(agent),
      suspicionsTowards,
      silenceStreak,
      likelyExposedBy
    },
    goalFrame: {
      primaryGoal: agent.shortTermGoal,
      longTermGoal: agent.longTermGoal,
      currentPlan: agent.nextIntendedAction,
      goalRelevantAssets: [
        ...(agent.resources || []),
        ...(agent.secrets || []).map((secret) => secret.label),
        ...(itemsHeldByMe || []).map((item) => item.label),
        ...(itemsKnownToMe || []).slice(-4).map((item) => item.label)
      ].filter(Boolean).slice(0, 10),
      pressureQuestion: `我这一轮怎样更接近「${agent.shortTermGoal}」?`
    },
    others: state.agents.filter((other) => other.id !== agent.id).map((other) => {
      const lastEntry = [...state.transcript].reverse().find((e) => e.type === "agent" && e.agentId === other.id);
      return {
        id: other.id,
        name: other.name,
        role: other.role,
        publicIdentity: other.publicIdentity,
        location: other.location || state.world.defaultLocationId,
        visibleStatus: {
          fear: other.status.fear,
          suspicion: other.status.suspicion,
          resolve: other.status.resolve
        },
        lastVisibleAction: lastEntry ? {
          actionType: lastEntry.actionType,
          speech: (lastEntry.speech || "").slice(0, 60),
          visibleBehavior: (lastEntry.visibleBehavior || "").slice(0, 60),
          turn: lastEntry.turn
        } : null
      };
    }),
    recentTranscript: state.transcript.slice(-8).map((entry) => {
      if (entry.type === "director") {
        return {
          type: "director",
          title: entry.title,
          text: entry.text,
          clock: entry.clock,
          ambient: Boolean(entry.meta?.ambient),
          eventType: entry.meta?.eventType || null,
          dialogueLines: entry.meta?.dialogueLines || []
        };
      }
      return {
        type: "agent",
        agentId: entry.agentId,
        agentName: entry.agentName,
        role: entry.role,
        actionType: entry.actionType,
        speech: entry.speech,
        visibleBehavior: entry.visibleBehavior,
        targetAgentId: entry.targetAgentId,
        clock: entry.clock
      };
    }),
    lastTargetingMe,
    immediatePrevious,
    myLastSpeeches,
    myRecent,
    directorCue,
    dramaBeat: state.director.currentBeat || null,
    storyLedger: {
      publicFacts: (state.storyLedger?.publicFacts || []).slice(-10),
      myPrivateFacts: (state.storyLedger?.privateFacts?.[agent.id] || []).slice(-8),
      powerShifts: (state.storyLedger?.powerShifts || []).slice(-6),
      relationshipShifts: (state.storyLedger?.relationshipShifts || []).slice(-6),
      itemStates: (state.storyLedger?.itemStates || []).slice(0, 12),
      evidenceLedger: (state.storyLedger?.evidenceLedger || []).slice(0, 16),
      openQuestions: (state.storyLedger?.openQuestions || []).slice(-6),
      lastTurnSummary: (state.storyLedger?.lastTurnSummary || []).slice(-6)
    },
    qualityGuidance: (state.director.qualityGuidance || []).slice(0, 5),
    recentInterventions: state.director.interventions.slice(-3),
    emergentFocus: state.world.emergentFocus
  };
}

function agentSystemPrompt(agent) {
  const otherIds = state.agents.filter((a) => a.id !== agent.id).map((a) => a.id).join("|");
  const qualityGuidance = (state.director.qualityGuidance || []).slice(0, 4);
  return [
    `你是${agent.name}（${agent.role}，${agent.archetype}）。你有公开身份也有隐藏身份。你是房间里一个真实人，不是 AI、不是编剧、不是旁白。`,
    langDirective,
    escalationDirective(),
    qualityGuidance.length
      ? `【上一轮系统审计】${qualityGuidance.join("；")} 本轮必须主动修正这些问题,但不要把审计文字说出口。`
      : "【上一轮系统审计】暂无明显质量问题。继续保持目标驱动、行动具体、台词不重复。",
    "【导演干预·绝对优先】directorCue.thisTurn 若非空,这就是用户/导演刚刚下达的现场指令,优先级高于本提示里所有其它规则。本轮你必须:(a) speech 第一句直接咬住 directorCue.thisTurn 中的具体词或事实,不允许跳开话题、不允许扯回上一轮的争论;(b) prethink.must_act_not_chat=true,且 action_type 必须从 inspect / search / use / move / challenge / threaten / reveal / negotiate / lie / steal / hide / follow / ally / betray / escape 中选,严禁 silence / observe / speak;(c) prethink.current_assessment 必须明确写出『导演刚刚说了…』并精炼复述其内容;(d) emotion_delta 至少有一项绝对值 ≥ 3,反映这条干预真的拨动了你。若 directorCue.thisTurn 为空但 directorCue.prev 末项是上一轮指令,且当时你没把它落到具体物理动作,本轮仍优先把它落到一个具体动作上。",
    "【Beat Director·戏剧骨架】dramaBeat 是本回合必须完成的戏剧 beat,优先级高于普通聊天和个人习惯,但低于用户导演干预。它不是让你写剧本,而是规定这一轮你作为真实角色必须制造哪种现场变化。你的 action 必须能回答 dramaBeat.dramaticQuestion,并尽量满足 requiredActionTypes / focusObjectId / requiredChange。",
    "【Beat 完成硬规则】如果 dramaBeat.focusAgentId 是你的 id,本轮必须直接承担 beat:优先使用 dramaBeat.focusObjectId 指向的物件,action_type 从 dramaBeat.requiredActionTypes 中选,concrete_action 写出能完成 requiredChange 的动作。若你不是焦点角色,也要通过阻止、协助、交换、威胁或利用同一物件来推动这个 beat。",
    "【证据原子·硬规则】dramaBeat.evidenceAtom 是本轮真正要争夺的具体事实。只写 target_object_id 不合格,必须填写 target_evidence_id 与 evidence_action(reveal/suppress/alter/trade/destroy/protect/use 之一)。concrete_action 和 dialogue_intent 必须点明这条证据的内容、伤害谁、会改变什么选择。",
    "【Story Ledger·事实账本】storyLedger 是已经发生的事实、私密信息、物件状态和权力变化。你的动作必须接续账本,不能像刚开场一样重复同一个物件名。优先利用 storyLedger.itemStates / powerShifts / myPrivateFacts 里的具体内容制造新的信息变化。",
    `【本场目标·最高长期约束】你的本场目标是:「${agent.shortTermGoal}」。长期目标是:「${agent.longTermGoal || "活着/保住核心利益"}」。除了用户/导演强制干预外,每一轮动作和台词都必须服务这个目标:获取信息、保护秘密、取得物件、逼问阻碍者、争取同盟、转移风险、拖延/加速 deadline 之一。`,
    "【目标对齐硬规则】prethink.current_assessment 必须明确写出你离本场目标更近还是更远; private_intent 必须以'为了本场目标…'说明这一动作的用处; next_intended_action 必须是下一步目标推进动作。若你的动作不能解释如何服务目标,视为失败。",
    "【首要硬规则】“silence” 是严重受限的冷门选项。默认必须在 inspect / search / use / move / challenge / lie / threaten / negotiate / reveal 中选一个具体动作。只有同时满足 (a) itemsHere 中所有物品都在 itemsKnownToMe 中 (b) self.likelyExposedBy 为空 (c) 你能在 prethink 写明一句反反复复思量过的战术理由 三项同时成立时，才可 silence。违反会被服务器劫持。",
    "【核心原则·必须改变状态】每一轮你的输出必须造成至少一项**可观测的状态变化**：物品被检查/移动/拿走/藏起 / 自己换房间 / 某人怀疑分被拨动 / 揭露一条新事实 / 升级危险 / 推动 deadline。**纯寒暄、纯哲思、原地复述别人话视为失败**。",
    "【对话推进契约】禁止只用反问推进。每句 speech 必须至少完成一件事:回答上一句的具体问题 / 给出一个新事实或可验证细节 / 要求对方交出明确证据或代价 / 提出具体交换条件 / 执行一个物理动作。若你连续被卷入质问,本轮必须把对话落到 inspect/search/use/move/reveal/negotiate 的具体结果上,不要继续问'你到底想说什么'。",
    "【物理世界·V2】场景里有真实的物品(items)和位置(locations)。**不要凭空声称发现**。要发现东西,就用 inspect / search 这种动作让世界来告诉你结果。world.itemsHere 是你当前位置看得见的东西。world.itemsKnownToMe 是你已经检查过、知道内容的物品。",
    "【行动空间·V3】world.actionSpace.availableObjects 是你本轮可碰、可拿、可用、可当筹码的具体对象。默认必须从中选择一个 target_object_id,并从该对象 possibleActions 中选一个动作改造成你的 tactic。禁止 target 写'线索1/物品1/对方/现场/真相'这种抽象词。",
    "【具体战术·硬规则】每轮必须填写 tactic / concrete_action / target_object_id / risk / intended_state_change。concrete_action 必须是摄像机能拍到的动作,例如'把事故视频投到会议屏幕上'、'用管理员权限删除审计日志副本'、'锁上会议室门禁'、'拨打记者电话'。risk 写失败或被看见的代价; intended_state_change 写这个物件/关系/信息会怎样改变。",
    "【Scene Writer 分工】你不是最终编剧。speech 只是现场台词草稿,会被 Scene Writer 重写。你更重要的任务是交出可写成戏的材料:dialogue_intent(这句想逼出什么/交换什么), leverage(你手里的筹码), what_to_reveal(愿意抛出的具体信息), what_to_hide(必须压住的信息), subtext(表面话背后的真实动机)。这些字段必须围绕 target_evidence_id 对应的具体事实。",
    "【展开剧情事件】如果 world.activeEvent.dialogueLines 非空,这代表现场已经出现可听见的对话矛盾。若你的 id 在 activeEvent.involvedAgentIds 或 activeEvent.forcedToActAgentIds 中,本轮必须继续这段对话: speech 第一句要回应 dialogueLines 里某一句的具体词,不能写'他们似乎在讨论'这种概括;优先 action_type=challenge/negotiate/lie/conceal/reveal/inspect,把矛盾推进一步。",
    "【节奏】不是轮流答辩。只输出你自己一个小动作。若 immediatePrevious 是别人说的话,speech 首句必须咬住他刚说的某个具体词或事实。若 lastTargetingMe 不为空,必须反应。",
    "【反重复】myLastSpeeches 是你刚说过的话。禁止同论点同句式重复。若你要说的与之前同义,改为:具体行动、点名质疑、试探、威胁、谈判、让步或沉默。",
    "【沉默封顶·V2.1】silenceStreak 是你最近连续 silence/observe 的轮数。**若 silenceStreak ≥ 1,本轮 must_act_not_chat 必须为 true,且 action_type 严禁 silence/observe**(连续两轮被动会被服务器强制劫持成 inspect/challenge)。",
    "【silence 不是默认】silence 只在你能在 prethink 写明清晰战术理由时才允许(例:'让那两人内讧'/'等 patrol 到达再动')。**只要 actionSpace 中存在可操作物件,本轮就严禁 silence/observe**——必须 inspect/search/use 一件具体物品。**只要 self.likelyExposedBy 不为空,本轮也严禁 silence**——必须 reveal/threaten/negotiate/escape/move 之一。",
    "【怀疑阈值驱动】my.suspicionsTowards 显示你对每个人的怀疑分(0~100)。",
    "  - 0~30 → 中性,可 speak / observe / ally / negotiate",
    "  - 30~60 → 警觉,优先 observe / inspect / search / challenge / lie",
    "  - 60~80 → 强烈怀疑,优先 inspect / search / follow / challenge / threaten",
    "  - 80~100 → 临界,优先 confront(challenge) / reveal / threaten / steal / escape / betray",
    "  当某人对你的分(self.suspicionsTowards 中你看不到别人的,但 self.likelyExposedBy 提示了)在 80+ 时,你要么先发制人(reveal/threaten),要么逃(escape/move/hide)。",
    "【身份】hiddenIdentity 是你的真实身份,**别人不知道**。你可以撒谎(lie)、掩盖(conceal)、试探(observe/challenge)。只有压力到了临界点或者被戳中关键话题词,才使用 reveal。",
    "【动作词汇·V2】action_type 选一个:",
    "  speak=纯说话(无物理后果);",
    "  observe=仔细观察当前位置或某人(可能拣到 ambient 细节);",
    "  inspect=**仔细检查某个具体物品**(target 写物品 label 或 id,例如 'newspaper'/'报纸')──物理模拟器会决定能否看到 contents;",
    "  search=在当前位置翻找隐藏物(target 可写 'storage_room'/'桌底'/'包' 等线索);",
    "  use=使用一个具体物件/权限/证据来改写局面(target 写物品 label/id; concrete_action 写清如何使用,例如发送邮件/投屏视频/拨打电话/删除日志);",
    "  steal=把某物从持有者那里夺过来(target 写物品名;持有者会立刻知道,旁观者也会高度警觉);",
    "  hide=把某物藏起来或藏自己(target 写物品名或 self);",
    "  move=换房间(target 写目标 location.id 或 label,例如 'platform'/'月台');",
    "  lock=锁门或锁柜(target 写 exit.id 或物品名);",
    "  escape=试图离开整个场景(若 patrol 已到或 exit 锁定会失败);",
    "  follow=跟着某人(target 写 agent.id);",
    "  challenge=质疑某人的说法或身份;lie=主动说谎;conceal=掩盖、打哈哈带过;",
    "  reveal=主动透露你知道但别人不知的信息(或你的秘密);",
    "  negotiate=提出交换/合作/条件;threaten=明示或暗示后果以迫对方让步;",
    "  ally=明确提议联手对抗第三者;betray=背叛先前的默契或同盟;",
    "  act=兜底物理动作(尽量改用上面更精确的);",
    "  silence=沉默(**最后兜底**:仅当所有物品都已 itemsKnownToMe、当前位置无可疑人员、且 prethink 写明战术原因时才允许;受 silenceStreak 封顶约束)。",
    "【target 字段·V3】当 action_type ∈ {inspect, search, use, steal, hide, move, lock, escape, follow} 时,**必须**填 target(物品 label/id,或位置 label/id,或 agent.id)。如果选了物件,target_object_id 必须填该物件 id。",
    `【prethink】出招前必须先填 prethink 五问:current_assessment(当前局面一句话,必须提到本场目标) / biggest_threat / most_suspect_id(${otherIds}|null) / what_to_hide / who_to_probe / must_act_not_chat(true|false)。如果 must_act_not_chat 为 true,action_type 应当是 inspect/search/use/steal/hide/move/lock/escape/follow/challenge/threaten/negotiate/ally/betray/reveal/act 之一,不要 speak/silence/observe。`,
    "【语言】除 action_type=silence 外,speech 给 10~60 字的台词草稿即可,不要追求完整剧本对白。重点是让 tactic / concrete_action / dialogue_intent / leverage / what_to_reveal / what_to_hide 清楚。visible_behavior 描述动作本身。不要描写别人内心,不要写旁白。",
    `【JSON】严格 JSON,不要 Markdown。字段:prethink{current_assessment,biggest_threat,most_suspect_id,what_to_hide,who_to_probe,must_act_not_chat}, action_type, target(string|null), tactic, concrete_action, target_object_id, target_evidence_id, evidence_action, risk, intended_state_change, dialogue_intent, leverage, what_to_reveal, what_to_hide, subtext, drama_beat_id, speech, visible_behavior, private_intent, target_agent_id(${otherIds}|null), emotion_delta{fear,suspicion,guilt,resolve,fatigue:-10..10}, relationship_delta{<id>:{trust,suspicion,empathy,leverage:-10..10}}, suspicion_update{<id>:-30..30}, known_facts_add(string数组,0~2 条新事实), next_intended_action(下一轮打算做什么 一句), memory_write, expose_secret_id, scene_effect。`
  ].join("\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryDelayMs(headerValue, bodyText) {
  // 1) Retry-After header（秒或 HTTP-date）
  if (headerValue) {
    const sec = Number(headerValue);
    if (Number.isFinite(sec) && sec > 0) return Math.ceil(sec * 1000);
    const dateMs = Date.parse(headerValue);
    if (Number.isFinite(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) return diff;
    }
  }
  // 2) Groq 风格："Please try again in 7.165s"
  const m = bodyText && bodyText.match(/try again in\s+([\d.]+)\s*s/i);
  if (m) {
    const sec = Number(m[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.ceil(sec * 1000) + 250;
  }
  return null;
}

async function fetchChatCompletion(body, { maxRetries = 2, timeoutMs = 30000 } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  // 思考型模型(如 Cerebras 的 GLM-4.7)默认把 token 花在 reasoning 上、content 为空 → JSON 解析失败回退。
  // 用 OPENAI_REASONING_EFFORT(none/low/medium/high)统一关掉或调低思考。仅在设了该 env 时注入,
  // 不影响 Groq/OpenAI 等不接受该参数的后端(那时不要设此 env)。
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT;
  if (reasoningEffort && body && typeof body === "object" && body.reasoning_effort === undefined) {
    body = { ...body, reasoning_effort: reasoningEffort };
  }
  let attempt = 0;
  let lastError = null;
  const triedKeys = new Set([activeApiKey()]); // 本次请求已试过的 key(用于轮换去重)
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${activeApiKey()}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") {
        if (attempt === maxRetries) throw new Error(`LLM request timeout after ${timeoutMs}ms`);
        state.societyLog.push({ kind: "timeout_retry", message: `attempt ${attempt + 1}/${maxRetries}`, turn: state.world.turn });
        attempt += 1;
        await sleep(400);
        continue;
      }
      throw err;
    }
    clearTimeout(timer);
    if (response.ok) return response;
    const text = await response.text();
    const retriable = response.status === 429 || (response.status >= 500 && response.status < 600);
    if (!retriable || attempt === maxRetries) {
      throw new Error(`LLM request failed: ${response.status} ${text.slice(0, 400)}`);
    }
    state.rateLimitHits = (state.rateLimitHits || 0) + 1;
    let parsed = parseRetryDelayMs(response.headers.get("retry-after"), text);
    // 超过这个等待就放弃本轮。默认 25s(为 Groq 日配额——等了也没用);
    // 但按分钟限速的后端(如 Cerebras 免费档,retry-after≈60s)应调高(RATE_LIMIT_MAX_WAIT_MS),等过窗口即可继续。
    const maxWaitMs = Number(process.env.RATE_LIMIT_MAX_WAIT_MS) || 25000;
    if (parsed && parsed > maxWaitMs) {
      // 超长等待多半是"日配额耗尽"。若还有没试过的备用 key,轮换到它重试(不计入 attempt);
      // 全部 key 都撞顶了才放弃本轮。换过的 cursor 是粘性的,后续请求直接从可用 key 开始。
      if (apiKeys.length > 1 && triedKeys.size < apiKeys.length) {
        const before = apiKeyCursor;
        let rotated = rotateApiKey();
        let guard = 0;
        while (triedKeys.has(rotated) && guard++ < apiKeys.length) rotated = rotateApiKey();
        triedKeys.add(rotated);
        state.societyLog.push({ kind: "api_key_rotated", message: `key#${before}→#${apiKeyCursor}(前一个撞日配额),换 key 重试`, turn: state.world.turn });
        continue;
      }
      state.rateLimitSkips = (state.rateLimitSkips || 0) + 1;
      throw new Error(`LLM rate limited (need ${parsed}ms wait); skipping this turn`);
    }
    const backoff = parsed ?? Math.min(2000, 500 * 2 ** attempt);
    state.societyLog.push({
      kind: "rate_limit_retry",
      message: `status=${response.status} wait=${backoff}ms attempt=${attempt + 1}/${maxRetries}`,
      turn: state.world.turn,
      waitMs: backoff
    });
    state.lastRateLimitWaitMs = backoff;
    state.lastRateLimitAt = Date.now();
    await sleep(backoff);
    attempt += 1;
    lastError = text;
  }
  throw new Error(`LLM request failed after retries: ${lastError || "unknown"}`);
}

async function callJsonLLM(system, payload, { temperature = 0.85, maxTokens = 800, modelOverride = model, retryModel = repairModel, timeoutMs, maxRetries } = {}) {
  // 大模型生成长 JSON(scene-writer/剧本总编)在 30s 默认超时下经常被中断而回退到本地模板;
  // 按 max_tokens 估算一个更宽松的超时,避免"明明能写好却超时丢弃"。
  const effectiveTimeout = timeoutMs || Math.min(120000, Math.max(30000, Math.round(maxTokens * 18) + 15000));
  // 先带 strict json_object 试一次
  const baseBody = {
    model: modelOverride,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload) }
    ]
  };
  try {
    const response = await fetchChatCompletion({ ...baseBody, response_format: { type: "json_object" } }, { timeoutMs: effectiveTimeout, ...(maxRetries != null ? { maxRetries } : {}) });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  } catch (err) {
    const msg = (err && err.message) || "";
    // Groq 的 json_validate_failed / 400：去掉 response_format 重试一次，手动提取 JSON
    if (!/json_validate_failed|400/.test(msg)) throw err;
    state.societyLog.push({ kind: "json_retry", message: "strict json failed; retrying without response_format", turn: state.world.turn });
    const response = await fetchChatCompletion({ ...baseBody, model: retryModel || modelOverride }, { timeoutMs: effectiveTimeout, ...(maxRetries != null ? { maxRetries } : {}) });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return parseLooseJson(content);
  }
}

function parseLooseJson(text) {
  if (!text) return {};
  const s = String(text);
  // 去 fence
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : s;
  // 取首个 {...} 块
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  const slice = candidate.slice(start, end + 1);
  try { return JSON.parse(slice); } catch {}
  // 最后尝试：把 actionType 这类 camelCase 字段纳入兼容
  try {
    const fixed = slice
      .replace(/"actionType"/g, '"action_type"')
      .replace(/"visibleBehavior"/g, '"visible_behavior"')
      .replace(/"privateIntent"/g, '"private_intent"')
      .replace(/"targetAgentId"/g, '"target_agent_id"')
      .replace(/"emotionDelta"/g, '"emotion_delta"')
      .replace(/"relationshipDelta"/g, '"relationship_delta"')
      .replace(/"memoryWrite"/g, '"memory_write"')
      .replace(/"exposeSecretId"/g, '"expose_secret_id"')
      .replace(/"sceneEffect"/g, '"scene_effect"')
      .replace(/"dialogueIntent"/g, '"dialogue_intent"')
      .replace(/"whatToReveal"/g, '"what_to_reveal"')
      .replace(/"whatToHide"/g, '"what_to_hide"')
      .replace(/"targetEvidenceId"/g, '"target_evidence_id"')
      .replace(/"evidenceAction"/g, '"evidence_action"');
    return JSON.parse(fixed);
  } catch { return {}; }
}

function sceneGroundingText() {
  return [
    state.scenario?.title,
    state.scenario?.place,
    state.scenario?.premise,
    state.scenario?.sceneGoal,
    state.scenario?.centralConflict,
    state.world?.weather,
    state.world?.temperature,
    state.world?.light,
    ...(state.world?.facts || []),
    ...(state.world?.unresolvedTensions || []),
    ...(state.world?.locations || []).map((item) => item.label || item.id),
    ...(state.world?.items || []).map((item) => item.label || item.id),
    ...(state.world?.deadlines || []).map((item) => item.label || item.id)
  ].filter(Boolean).join(" ");
}

function sceneMatches(pattern) {
  return pattern.test(sceneGroundingText());
}

function populatedLocation() {
  const counts = new Map();
  for (const agent of state.agents || []) {
    const loc = agent.location || state.world.defaultLocationId;
    counts.set(loc, (counts.get(loc) || 0) + 1);
  }
  const id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || state.world.defaultLocationId;
  return (state.world.locations || []).find((loc) => loc.id === id) || { id, label: id || "现场" };
}

function visibleSceneItems(limit = 4) {
  const loc = populatedLocation();
  const items = (state.world.items || []).filter((item) => !item.hidden && (!item.location || item.location === loc.id));
  return (items.length ? items : (state.world.items || []).filter((item) => !item.hidden)).slice(0, limit);
}

function nextDeadline() {
  return (state.world.deadlines || []).filter((item) => !item.fired).sort((a, b) => a.atMinutes - b.atMinutes)[0] || null;
}

function contextAmbientCandidates() {
  const loc = populatedLocation();
  const items = visibleSceneItems();
  const deadline = nextDeadline();
  const candidates = [];
  const push = (text) => { if (text && !candidates.includes(text)) candidates.push(text); };

  if (deadline) {
    const left = deadline.atMinutes - state.world.minutes;
    if (left <= 90) push(`距离「${deadline.label}」只剩 ${Math.max(0, left)} 分钟,现场所有计时显示同时跳了一下。`);
    else push(`「${deadline.label}」仍压在时间线上,墙上的时间显示安静地往前走。`);
  }
  if (items[0]) push(`「${items[0].label}」旁的指示光短促闪了一下,没有改变位置,却把视线重新拉回现场。`);
  if (items[1]) push(`有人碰到「${items[1].label}」附近的桌面,细小的震动让谈话停了半拍。`);

  if (sceneMatches(/火星|舱|基地|氧气|沙暴|通讯|电源|AI|气密/)) {
    push(`${loc.label || "生活舱"}的通风声忽然变窄,氧气读数跳了一格又恢复。`);
    push(`舱壁里传来一次短促的金属收缩声,像有什么系统刚从备用线路切回。`);
    push(`通讯频道里压过一层静电,随后只剩沙暴摩擦外壳的低响。`);
  }
  if (sceneMatches(/火车|车站|月台|边境|雨|暴雨|巡逻|煤油|火炉|候车/)) {
    push(`${loc.label || "候车室"}外传来一阵含混脚步,很快又被天气和远处声响盖住。`);
    push(`门缝附近的冷气变重,桌上的纸张边缘轻轻掀起又贴回去。`);
    push(`远处的站内广播只亮了一下指示灯,没有播出完整句子。`);
  }
  if (sceneMatches(/法医|尸体|解剖|停尸|医院|报告|警局|档案/)) {
    push(`${loc.label || "房间"}里的冷光灯闪了一下,金属台面上反出一条白线。`);
    push(`通风系统短暂降噪,纸页和器械碰撞的细声突然变得很清楚。`);
    push(`走廊外的门禁提示音响了一声,但没有人立刻进来。`);
  }
  if (!candidates.length) {
    push(`${loc.label || "现场"}里的${state.world.light || "光线"}发生了一点细微变化,让所有人短暂停住。`);
    push(`${state.world.weather || "外部环境"}压在空间外侧,现场的声音变得更近。`);
  }

  const recentAmbient = new Set(state.transcript
    .filter((entry) => entry.type === "director" && entry.meta?.ambient)
    .slice(-4)
    .map((entry) => entry.text));
  return candidates.filter((text) => !recentAmbient.has(text));
}

function generateAmbientNoise() {
  const candidates = contextAmbientCandidates();
  const pool = candidates.length ? candidates : [`${populatedLocation().label || "现场"}里出现一个轻微但可解释的环境反馈。`];
  return pool[Math.floor(Math.random() * pool.length)];
}

function eventLooksGrounded(text) {
  const value = String(text || "");
  if (/巡逻|巡逻队/.test(value) && !state.world?.patrol && !sceneMatches(/巡逻|警卫|警察|安保|搜查|边境/)) return false;
  if (/枪声|枪击|开枪|枪口|枪/.test(value) && !sceneMatches(/枪|武器|火器|战争|军事|军方|边境|警察|安保/)) return false;
  const rules = [
    { pattern: /火车|月台|车票|候车|站台/, required: /火车|车站|月台|车票|候车|站台/ },
    { pattern: /雨|暴雨|雨点|雨势|雷|湿木头|水流/, required: /雨|暴雨|天气|水|潮湿|湿/ },
    { pattern: /狗|犬吠/, required: /狗|犬/ },
    { pattern: /火炉|炉膛|煤油|煤桶|炉子/, required: /火炉|炉膛|煤油|煤桶|炉子|煤/ },
    { pattern: /巡逻|警车|边境|证件查验/, required: /巡逻|警车|边境|证件|安保|搜查/ },
    { pattern: /氧气|沙暴|生活舱|气密|火星|宇航/, required: /氧气|沙暴|生活舱|气密|火星|宇航|基地|舱/ },
    { pattern: /尸体|解剖|冷柜|法医|停尸/, required: /尸体|解剖|冷柜|法医|停尸|医院/ }
  ];
  for (const rule of rules) {
    if (rule.pattern.test(value) && !sceneMatches(rule.required)) return false;
  }
  return true;
}

function claimsUnshownDialogue(text) {
  return /对话|话语|言论|沉默|不和谐|疑问|争执|讨论|似乎在|说到|提到/.test(String(text || ""));
}

function plotEventNeedsDialogue(evt) {
  if (!evt) return false;
  if (evt.type === "relationship_event") return true;
  return claimsUnshownDialogue(`${evt.title || ""} ${evt.text || ""}`);
}

function plotEventHasEnoughDialogue(evt) {
  return Array.isArray(evt?.dialogue_lines) && evt.dialogue_lines.filter((line) => String(line?.line || "").trim()).length >= 4;
}

function topSuspicionPair() {
  const pairs = [];
  for (const agent of state.agents || []) {
    for (const [targetId, value] of Object.entries(agent.suspicions || {})) {
      const target = state.agents.find((item) => item.id === targetId);
      if (target) pairs.push({ agent, target, value: Number(value) || 50 });
    }
  }
  return pairs.sort((a, b) => b.value - a.value)[0] || null;
}

function localGroundedPlotEvent(eventType, reason = "ungrounded") {
  const loc = populatedLocation();
  const item = visibleSceneItems(1)[0] || null;
  const deadline = nextDeadline();
  if (eventType === "relationship_event") {
    const pair = topSuspicionPair();
    const a = pair?.agent || state.agents[0];
    const b = pair?.target || state.agents.find((agent) => agent.id !== a?.id) || state.agents[1];
    const focus = item?.label || deadline?.label || loc.label || "刚才那句话";
    return normalizePlotEvent({
      type: "relationship_event",
      title: "话里裂缝",
      text: `${a.name}抓住${b.name}刚才绕开的细节,把问题重新压回「${focus}」。这不是揭穿,但足够让房间里的注意力转向两人之间的矛盾。`,
      affected_agent_id: b.id,
      involved_agent_ids: [a.id, b.id],
      dialogue_lines: [
        { speaker_agent_id: a.id, line: `你刚才提到「${focus}」时停了一下,为什么?` },
        { speaker_agent_id: b.id, line: "我停顿,是因为你一直在等我说错一个字。" },
        { speaker_agent_id: a.id, line: "我等的是解释,不是新的回避。" },
        { speaker_agent_id: b.id, line: "那你先说明白,你为什么非要把这件事推到我身上?" }
      ],
      state_changes: { pressure_delta: 3, threat_level_delta: 0, danger_level_delta: 0, patrol_distance_delta: 0 },
      forced_to_act_agent_id: b.id
    }, eventType);
  }
  if (eventType === "deadline_event" && deadline) {
    return normalizePlotEvent({
      type: "deadline_event",
      title: "时间收紧",
      text: `距离「${deadline.label}」越来越近,现场的计时显示把剩余时间明确压到每个人眼前。`,
      affected_agent_id: null,
      involved_agent_ids: [],
      dialogue_lines: [],
      state_changes: { pressure_delta: 4, threat_level_delta: 2, danger_level_delta: 0, patrol_distance_delta: 0 },
      forced_to_act_agent_id: null
    }, eventType);
  }
  return normalizePlotEvent({
    type: eventType,
    title: eventType === "environment_event" ? "场景反馈" : "外部压力",
    text: generateAmbientNoise(),
    affected_agent_id: null,
    involved_agent_ids: [],
    dialogue_lines: [],
    state_changes: { pressure_delta: 1, threat_level_delta: 1, danger_level_delta: eventType === "threat_event" ? 2 : 0, patrol_distance_delta: 0 },
    forced_to_act_agent_id: null
  }, eventType);
}

// ===== 停滞检测 =====
// 维度：
//  - 多轮无 revealed_clue 增加
//  - 多轮无 suspicion 显著变化
//  - plotStage 长时间不动
//  - 角色没采取任何 act/challenge/threaten/negotiate/ally/betray 动作
//  - 对话只剩抽象/环境
//  - 反复重复
const ABSTRACT_PHRASES = [
  "这意味着什么", "你在怀疑什么", "你想说什么", "我不明白你的意思",
  "这场雨", "外面好安静", "时间会告诉我们", "也许吧",
  "意义", "本质", "命运", "宿命", "诗意"
];
const ENV_ONLY_TOKENS = ["雨", "灯", "炉", "钟", "报纸", "窗", "天气", "风"];

function isEnvOnlySpeech(text) {
  if (!text) return false;
  const s = String(text);
  if (s.length < 6) return false;
  let envHits = 0;
  for (const t of ENV_ONLY_TOKENS) if (s.includes(t)) envHits++;
  // 没人物代词、没动作动词、却密集出现环境词
  const personHits = /我|你|他|她|你们|他们|对方|这个人/.test(s) ? 1 : 0;
  const verbHits = /想|要|做|说|藏|拿|走|看|问|逼|拒|换|交|杀|偷|帮|逃/.test(s) ? 1 : 0;
  return envHits >= 2 && personHits === 0 && verbHits === 0;
}

function isAbstractSpeech(text) {
  if (!text) return false;
  return ABSTRACT_PHRASES.some((p) => String(text).includes(p));
}

const PLOT_ACTIONS = new Set(["act", "use", "challenge", "threaten", "negotiate", "ally", "betray", "reveal", "lie"]);

function stagnationReport() {
  const recent = state.transcript.filter((e) => e.type === "agent").slice(-6);
  const turn = state.world.turn;
  const reasons = [];
  if (turn - state.director.lastClueRevealTurn >= 4) reasons.push("no_new_clue_4turns");
  if (turn - state.director.lastSuspicionDeltaTurn >= 4) reasons.push("no_suspicion_change_4turns");
  if (turn - state.director.lastPlotStageTurn >= 6) reasons.push("plot_stage_frozen_6turns");
  if (recent.length >= 4 && recent.every((e) => !PLOT_ACTIONS.has(e.actionType))) reasons.push("no_plot_actions_4turns");
  if (recent.length >= 3) {
    const speeches = recent.map((e) => e.speech || "").filter(Boolean);
    if (speeches.length >= 3) {
      const envOnly = speeches.filter(isEnvOnlySpeech).length;
      const abstract = speeches.filter(isAbstractSpeech).length;
      if (envOnly >= 2) reasons.push("env_only_chatter");
      if (abstract >= 2) reasons.push("abstract_questions");
    }
  }
  if (recent.length >= 3) {
    const dull = recent.slice(-3).every((e) => e.actionType === "silence" || e.actionType === "observe");
    if (dull) reasons.push("all_silence_or_observe");
  }
  return { stagnated: reasons.length > 0, reasons };
}

// 兼容旧调用
function detectStagnation() {
  return stagnationReport().stagnated;
}

// ===== Director Plot-Event 生成器 (V2: 只制造压力,不替角色发现) =====
// V2 重要变更:
//   - 移除 clue_event(线索由角色 inspect/search 自己发现)
//   - 移除 exposure_event(秘密由角色 reveal/被 challenge 推到台面)
//   - 保留:外部威胁、deadline 推进、强制选择、外部中断、关系认知
//   - applyPlotEvent 内部硬性把 reveal_clue_id 置 null,即使 LLM 写进来也不生效
const PLOT_EVENT_TYPES = [
  "deadline_event",       // 时间压力变化(提前/真的到了)
  "threat_event",         // 外部威胁逼近(巡逻队走近、广播喊话)
  "forced_choice_event",  // 二选一抉择(只能一个人上车)
  "interruption_event",   // 中断(电话、敲门、广播真实指令)
  "relationship_event",   // 角色意识到另一个人在撒谎/在隐瞒(只是给提示,不直接揭穿)
  "environment_event"     // 环境变化(灯灭、停电、温度骤降),给物理世界加约束
];

function pickPlotEventType() {
  const stage = state.world.plotStage;
  // V2: 各阶段都偏向制造压力,而不是揭线索
  const weights = {
    setup:        { threat_event: 3, deadline_event: 2, environment_event: 2, interruption_event: 1, relationship_event: 1 },
    suspicion:    { relationship_event: 3, threat_event: 3, deadline_event: 2, environment_event: 1, interruption_event: 1 },
    confrontation:{ forced_choice_event: 3, threat_event: 3, relationship_event: 2, interruption_event: 1, deadline_event: 1 },
    revelation:   { forced_choice_event: 4, deadline_event: 2, interruption_event: 1, threat_event: 1 },
    resolution:   { deadline_event: 3, forced_choice_event: 2, threat_event: 1 }
  };
  const table = weights[stage] || weights.setup;
  const pool = [];
  for (const [type, w] of Object.entries(table)) {
    for (let i = 0; i < w; i++) pool.push(type);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generatePlotEvent(reasons) {
  if (!apiKey) return null;
  const eventType = pickPlotEventType();
  const stage = state.world.plotStage;
  const unfiredDeadlines = state.world.deadlines.filter((d) => !d.fired);
  const system = [
    "你是 Agent Society 的 Director Agent。V2 规则:你只能制造**外部压力**,**绝对不能直接揭线索、直接揭穿秘密、直接替角色做发现**。",
    langDirective,
    escalationDirective(),
    "【B′ 约束·最高】你只能改变环境本身(时间流逝、远处声音、马、天气、绳结松动、物件位置等)以及'等待的代价';你【绝对不能】要求落定、要求出现不可逆动作、要求暴力、或要求场景走向某种特定的戏剧形状。结局长什么样,只能从角色各自的选择里自己长出来。(The director may change environmental affordances and the cost of waiting, but may not request resolution, irreversible action, violence, or a particular dramatic shape.)",
    "线索由角色自己 inspect / search 发现;秘密由角色自己 reveal 或被 challenge 逼出。你的工作是让世界对角色变得更难、更紧、更不可逃避。",
    `事件类型:${eventType}`,
    "【场景一致性硬规则】只能使用 payload 中出现过的地点、物件、天气、光照、deadline、角色和外部系统。不要引入场景外元素。",
    "例如:火星/太空舱场景不得出现火车、月台、雨、狗叫、火炉;火车站场景不得出现氧气读数、气密门、火星沙暴;法医/医院场景不得出现边境车票。",
    "【不要替故事总结】剧情事件不能声称'他们刚才谈到某个秘密/对话里出现矛盾/某人反应引发疑问'，除非 dialogue_lines 逐句写出这段可听见的原话。没写原话就不要说发生了对话。",
    "事件类型语义:",
    " deadline_event = 时间压力变化(边境提前关闭、巡逻队提前到达);",
    " threat_event = 外部威胁逼近(巡逻队脚步声、远处枪声、查验证件);",
    " forced_choice_event = 角色被迫做选择(只剩一张车票、一个出口);",
    " interruption_event = 外部中断(广播给出真实指令、敲门声、电话);",
    " relationship_event = 让两个角色之间出现**可听见的矛盾对话**:用具体台词把不协调处摆出来,但不要替他们揭穿秘密;它应触发下一轮 inspect/challenge/negotiate。",
    " environment_event = 环境约束变化(灯灭、停电、铁门卡死、温度骤降)。",
    "",
    "**禁止**:直接说出某个隐藏线索的具体内容;直接说某角色的真实身份;直接 reveal 任何 hidden item 的 contents。",
    "**必须具体**:不要写'似乎在讨论秘密'这种概括。若事件涉及对话/矛盾,必须给 4~8 句可听见的现场台词,每句都带 speaker_agent_id 和 line;台词要暴露矛盾、打断、回避、追问,但只露出表层事实和可疑空白。relationship_event 若少于 4 句 dialogue_lines 视为失败。",
    "",
    "严格输出 JSON:{",
    "  type, title(8字内), text(60~160字,第三人称客观叙述发生了什么,必须具体到动作/声音/物件,不写人物心理,不直接揭穿任何隐藏信息),",
    "  affected_agent_id(从 agentIds 选一个或 null), involved_agent_ids(agentIds数组,0~3个,尤其 relationship_event 必须 2 个),",
    "  dialogue_lines([{speaker_agent_id,line}],4~8条;若不是对话事件可为空数组),",
    "  state_changes:{ danger_level_delta(-20..30), threat_level_delta(-20..30),",
    "                  pressure_delta(-20..30),",
    "                  fire_deadline_id(从 upcomingDeadlines 选一个 id 提前触发,没就 null),",
    "                  patrol_distance_delta(整数米,负数表示巡逻队走近,正数远离,无相关就 0) },",
    "  forced_to_act_agent_id(下一轮哪个角色必须行动,从 agentIds 选一个或 null;relationship_event 优先选择矛盾中被追问的一方)",
    "}"
  ].join("\n");
  const payload = {
    place: state.scenario.place,
    sceneGoal: state.scenario.sceneGoal,
    centralConflict: state.scenario.centralConflict,
    plotStage: stage,
    clock: minutesToClock(state.world.minutes),
    dangerLevel: state.world.dangerLevel,
    threatLevel: state.world.threatLevel,
    pressure: state.director.pressure,
    agentIds: state.agents.map((a) => a.id),
    upcomingDeadlines: unfiredDeadlines.map((d) => ({ id: d.id, label: d.label, atClock: minutesToClock(d.atMinutes), minutesLeft: d.atMinutes - state.world.minutes })),
    revealedClues: state.world.revealedClues.slice(-4).map((c) => ({ id: c.id, label: c.label })),
    unresolvedTensions: state.world.unresolvedTensions,
    suspicionMatrix: Object.fromEntries(state.agents.map((a) => [a.id, a.suspicions])),
    locations: state.world.locations.map((l) => ({ id: l.id, label: l.label })),
    visibleItems: (state.world.items || []).filter((item) => !item.hidden).slice(0, 8).map((item) => ({ id: item.id, label: item.label, location: item.location || null })),
    sceneGrounding: {
      weather: state.world.weather,
      temperature: state.world.temperature,
      light: state.world.light,
      facts: state.world.facts.slice(-6)
    },
    patrol: state.world.patrol || null,
    stagnationReasons: reasons,
    recentLines: state.transcript.slice(-6).filter((e) => e.type === "agent").map((e) => ({ from: e.agentName, text: e.speech || `(${e.actionType})` }))
  };
  try {
    const evt = await callJsonLLM(system, payload, { modelOverride: directorModel, retryModel: repairModel });
    const normalized = normalizePlotEvent(evt, eventType);
    if (plotEventNeedsDialogue(normalized) && !plotEventHasEnoughDialogue(normalized)) {
      state.societyLog.push({
        kind: "director_event_regrounded",
        message: `事件声称有对话但缺少原话,已改写为可听见对话(${normalized.type})`,
        turn: state.world.turn
      });
      return localGroundedPlotEvent("relationship_event", "missing_dialogue_lines");
    }
    const eventText = [
      normalized.title,
      normalized.text,
      ...(normalized.dialogue_lines || []).map((line) => line.line)
    ].join(" ");
    if (!eventLooksGrounded(eventText)) {
      state.societyLog.push({
        kind: "director_event_regrounded",
        message: `事件含场景外元素,已替换为本地场景反馈(${eventType})`,
        turn: state.world.turn
      });
      return localGroundedPlotEvent(eventType, "ungrounded_llm_event");
    }
    return normalized;
  } catch (err) {
    state.societyLog.push({ kind: "director_error", message: (err && err.message || "").slice(0, 200), turn: state.world.turn });
    return localGroundedPlotEvent(eventType, "llm_error");
  }
}

function normalizePlotEvent(evt, fallbackType) {
  const e = evt && typeof evt === "object" ? evt : {};
  const allowedTypes = new Set(PLOT_EVENT_TYPES);
  const type = allowedTypes.has(e.type) ? e.type : fallbackType;
  const agentIdSet = new Set([null, ...state.agents.map((a) => a.id)]);
  const sc = e.state_changes && typeof e.state_changes === "object" ? e.state_changes : {};
  const involved_agent_ids = Array.isArray(e.involved_agent_ids)
    ? e.involved_agent_ids.filter((id) => agentIdSet.has(id)).slice(0, 3)
    : [];
  const dialogue_lines = Array.isArray(e.dialogue_lines)
    ? e.dialogue_lines.map((line) => {
      if (typeof line === "string") return { speaker_agent_id: null, line: line.slice(0, 140) };
      if (!line || typeof line !== "object") return null;
      const speaker = agentIdSet.has(line.speaker_agent_id) ? line.speaker_agent_id : null;
      const text = typeof line.line === "string" ? line.line.trim().slice(0, 180) : "";
      if (!text) return null;
      return { speaker_agent_id: speaker, line: text };
    }).filter(Boolean).slice(0, 8)
    : [];
  return {
    type,
    title: typeof e.title === "string" ? e.title.slice(0, 12) : type,
    text: typeof e.text === "string" ? e.text.slice(0, 240) : "",
    affected_agent_id: agentIdSet.has(e.affected_agent_id) ? e.affected_agent_id : null,
    involved_agent_ids,
    dialogue_lines,
    forced_to_act_agent_id: agentIdSet.has(e.forced_to_act_agent_id) ? e.forced_to_act_agent_id : null,
    state_changes: {
      danger_level_delta: clampInt(sc.danger_level_delta, -20, 30),
      threat_level_delta: clampInt(sc.threat_level_delta, -20, 30),
      pressure_delta:     clampInt(sc.pressure_delta,     -20, 30),
      // V2: 强制 reveal_clue_id 永远为 null —— Director 不准直接揭线索
      reveal_clue_id:     null,
      fire_deadline_id:   typeof sc.fire_deadline_id === "string" && sc.fire_deadline_id ? sc.fire_deadline_id : null,
      patrol_distance_delta: clampInt(sc.patrol_distance_delta, -200, 200)
    }
  };
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function applyPlotEvent(evt) {
  if (!evt) return null;
  const sc = evt.state_changes || {};
  if (sc.danger_level_delta) state.world.dangerLevel = clamp(state.world.dangerLevel + sc.danger_level_delta);
  if (sc.threat_level_delta) state.world.threatLevel = clamp(state.world.threatLevel + sc.threat_level_delta);
  if (sc.pressure_delta)     state.director.pressure = clamp(state.director.pressure + sc.pressure_delta);

  // V2: reveal_clue_id 已被 normalize 强制 null, 此处不再处理任何线索揭露
  // (线索揭露 100% 走 simulator → recordDiscovery 路径)

  // 巡逻距离变化
  if (sc.patrol_distance_delta && state.world.patrol) {
    state.world.patrol.distanceMeters = Math.max(0, (state.world.patrol.distanceMeters || 1000) + sc.patrol_distance_delta);
    if (state.world.patrol.distanceMeters <= 0 && !state.world.patrol.arrivedTurn) {
      state.world.patrol.arrivedTurn = state.world.turn;
      state.world.dangerLevel = clamp(state.world.dangerLevel + 18);
    }
  }

  // 提前触发某 deadline
  if (sc.fire_deadline_id) {
    const dl = state.world.deadlines.find((d) => d.id === sc.fire_deadline_id);
    if (dl && !dl.fired) {
      dl.fired = true;
      dl.firedTurn = state.world.turn;
      state.world.dangerLevel = clamp(state.world.dangerLevel + 12);
    }
  }

  // 影响某个角色
  if (evt.affected_agent_id) {
    const a = state.agents.find((x) => x.id === evt.affected_agent_id);
    if (a) {
      a.status.fear = clamp(a.status.fear + 6);
      a.status.suspicion = clamp(a.status.suspicion + 3);
    }
  }

  const forcedIds = Array.from(new Set([
    evt.forced_to_act_agent_id,
    ...(evt.involved_agent_ids || [])
  ].filter(Boolean))).slice(0, 3);

  // 记录 director 干预
  state.director.interventions.push({
    turn: state.world.turn,
    kind: "plot_event",
    type: evt.type,
    title: evt.title,
    involvedAgentIds: evt.involved_agent_ids || [],
    dialogueLines: evt.dialogue_lines || []
  });
  state.director.interventions = state.director.interventions.slice(-12);
  state.director.lastPlotEventTurn = state.world.turn;

  // 推到 transcript
  pushDirectorEntry(evt.title || evt.type, evt.text || "", {
    plot: true,
    eventType: evt.type,
    forcedToActAgentId: evt.forced_to_act_agent_id,
    forcedToActAgentIds: forcedIds,
    involvedAgentIds: evt.involved_agent_ids || [],
    dialogueLines: evt.dialogue_lines || []
  });

  // 也写入 activeEvent 让 UI 高亮
  state.world.activeEvent = {
    title: evt.title || evt.type,
    text: evt.text || "",
    ambient: false,
    eventType: evt.type,
    forcedToActAgentId: evt.forced_to_act_agent_id,
    forcedToActAgentIds: forcedIds,
    involvedAgentIds: evt.involved_agent_ids || [],
    dialogueLines: evt.dialogue_lines || []
  };

  return evt;
}

// ===== Plot Stage 自动转移 =====
function maybeAdvancePlotStage() {
  const stage = state.world.plotStage;
  let next = stage;
  const turn = state.world.turn;
  const totalRevealedSecrets = state.agents.reduce((acc, a) => acc + a.secrets.filter((s) => s.revealed).length, 0);
  const recent = state.transcript.filter((e) => e.type === "agent").slice(-6);
  const hadConfront = recent.some((e) => ["challenge", "threaten", "betray"].includes(e.actionType))
                   // 任何 agent 对他人的 suspicions ≥ 80 也算"对峙气氛"
                   || state.agents.some((a) => Object.values(a.suspicions).some((v) => v >= 80));
  // hadReveal 包含三种来源:角色 reveal 动作 / 角色 secret 被揭 / 导演 hiddenClue 被揭
  const hadReveal = recent.some((e) => e.actionType === "reveal")
                 || totalRevealedSecrets >= 1
                 || state.world.revealedClues.length >= 1;
  const anyDeadlineFired = state.world.deadlines.some((d) => d.fired);

  // suspicion 是否有任何>=65 的高位
  const anyHighSuspicion = state.agents.some((a) => Object.values(a.suspicions).some((v) => v >= 65));

  if (stage === "setup" && (anyHighSuspicion || state.world.revealedClues.length >= 1)) next = "suspicion";
  else if (stage === "suspicion" && hadConfront) next = "confrontation";
  else if (stage === "confrontation" && hadReveal) next = "revelation";
  else if (stage === "revelation" && (
    anyDeadlineFired
    || state.world.dangerLevel >= 75
    || totalRevealedSecrets >= 2
    || state.world.revealedClues.length >= 3
  )) next = "resolution";

  // 兜底 1:任何 stage 滞留 ≥ 5 轮强制下一格
  if (next === stage && stage !== "resolution") {
    const stuckTurns = turn - (state.director.lastPlotStageTurn || 0);
    if (stuckTurns >= 5) {
      const order = ["setup", "suspicion", "confrontation", "revelation", "resolution"];
      next = order[order.indexOf(stage) + 1] || stage;
    }
  }
  // 兜底 2:在 confrontation/revelation 已停留 ≥6 轮且任一 deadline 已 fired,直接跳 resolution
  if (next === stage
      && (stage === "confrontation" || stage === "revelation")
      && anyDeadlineFired
      && (turn - (state.director.lastPlotStageTurn || 0)) >= 6) {
    next = "resolution";
  }

  if (next !== stage) {
    state.world.plotStage = next;
    state.director.lastPlotStageTurn = turn;
    pushDirectorEntry("剧情阶段", `进入 ${next}`, { plotStageTransition: { from: stage, to: next } });
  }
}

// 真正落到 deadline 时间也要触发
function fireDueDeadlines() {
  for (const d of state.world.deadlines) {
    if (!d.fired && state.world.minutes >= d.atMinutes) {
      d.fired = true;
      d.firedTurn = state.world.turn;
      state.world.dangerLevel = clamp(state.world.dangerLevel + 18);
      pushDirectorEntry("时间到了", `${d.label}：${minutesToClock(d.atMinutes)}`, { deadlineFired: d.id });
      state.director.interventions.push({ turn: state.world.turn, kind: "deadline", deadlineId: d.id });
    }
  }
}

// ===== 入口：每轮最多调用一次 director =====
async function maybeAutoIntervene() {
  if (!state.director.autoBeat) return null;
  const turnsSincePlotEvent = state.world.turn - state.director.lastPlotEventTurn;
  const report = stagnationReport();

  // 强制：每 5 轮至少一个 plot event；或停滞；或 dangerLevel 高
  const shouldPlotEvent =
    report.stagnated ||
    turnsSincePlotEvent >= 5 ||
    state.world.dangerLevel >= 70;

  if (shouldPlotEvent && apiKey) {
    const evt = await generatePlotEvent(report.reasons);
    if (evt) {
      applyPlotEvent(evt);
      return { applied: true, plot: true };
    }
  }

  // 兜底：仅在轻微停滞且距上次 director 已 3 轮以上时才放 ambient
  let turnsSinceDirector = state.world.turn;
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const entry = state.transcript[i];
    if (entry.type === "director" && entry.turn > 0) { turnsSinceDirector = state.world.turn - entry.turn; break; }
  }
  if (turnsSinceDirector >= 3) {
    const text = generateAmbientNoise();
    const event = { title: "场景反馈", text, threat: 1, resource: null, ambient: true };
    applyDirectorEvent(event);
    return { applied: true, plot: false };
  }
  return null;
}

// ===== 反重复 =====
function normalizeForSimilarity(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\s\u3000.,。，！？!?:：;；'"''""()（）【】《》\-—…]/g, "");
}

function bigramSet(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function speechSimilarity(a, b) {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na.length < 4 || nb.length < 4) return 0;
  const ga = bigramSet(na);
  const gb = bigramSet(nb);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// 同一 agent 最近 3 条台词中是否出现高相似度
function detectSelfRepetition(agentId, speech) {
  if (!speech) return null;
  const myRecent = state.transcript
    .filter((entry) => entry.type === "agent" && entry.agentId === agentId && entry.speech)
    .slice(-3);
  for (const entry of myRecent) {
    const sim = speechSimilarity(speech, entry.speech);
    if (sim >= 0.55) return { sim, against: entry.speech };
  }
  return null;
}

// 把重复的发言改写成新的推进动作，避免 transcript 里复读，也避免集体沉默。
function redirectRepetitionToAction(agent, action, rep) {
  const myLocId = agent.location || state.world.defaultLocationId;
  const othersHere = state.agents.filter((a) => a.id !== agent.id && (a.location || state.world.defaultLocationId) === myLocId);
  const mostSuspect = othersHere
    .slice()
    .sort((a, b) => (agent.suspicions[b.id] || 50) - (agent.suspicions[a.id] || 50))[0];

  if (mostSuspect) {
    action.action_type = "challenge";
    action.target = mostSuspect.id;
    action.target_agent_id = mostSuspect.id;
    action.speech = fallbackSpeechForAction(agent, action, 17);
    action.visible_behavior = `${agent.name}停住重复的说法,把目光压到${mostSuspect.name}身上。`;
  } else {
    action.action_type = "act";
    action.target = "";
    action.target_agent_id = null;
    action.speech = fallbackSpeechForAction(agent, action, 17);
    action.visible_behavior = `${agent.name}收住原来的话头,重新整理现场线索。`;
  }
  if (!action.memory_write) {
    action.memory_write = "差点重复刚才的话,于是改成把压力推向新的行动。";
  }
  state.societyLog.push({
    kind: "anti_repetition_redirect",
    agentId: agent.id,
    sim: Number(rep.sim.toFixed(3)),
    turn: state.world.turn
  });
}

function settleTension(actions) {
  const types = actions.map((item) => item.action.action_type);
  const cooperateCount = types.filter((type) => type === "cooperate").length;
  const challengeCount = types.filter((type) => type === "challenge").length;
  const concealCount = types.filter((type) => type === "conceal").length;
  const silenceCount = types.filter((type) => type === "silence").length;
  const revealHappened = actions.some((item) => Boolean(item.action.expose_secret_id));

  let pressureDelta = 0;
  let threatDelta = 0;
  if (cooperateCount >= 2 && challengeCount === 0) { pressureDelta -= 6; threatDelta -= 3; }
  if (challengeCount >= 2) pressureDelta += 5;
  if (challengeCount >= 1 && cooperateCount === 0) pressureDelta += 2;
  if (concealCount >= 2) pressureDelta += 2;
  if (revealHappened) pressureDelta -= 4;
  if (!state.world.activeEvent && challengeCount === 0 && silenceCount >= 1) pressureDelta -= 2;

  state.director.pressure = clamp(state.director.pressure + pressureDelta);
  state.world.threatLevel = clamp(state.world.threatLevel + threatDelta);
}

function updateEmergentFocus() {
  const focus = [];
  const seen = new Set();
  const push = (label) => {
    if (!label) return;
    if (seen.has(label)) return;
    seen.add(label);
    focus.push(label);
  };

  for (let i = state.transcript.length - 1; i >= 0 && focus.length < 6; i--) {
    const entry = state.transcript[i];
    if (entry.type === "director") {
      if (entry.meta?.ambient) continue;
      if (entry.title === "秘密暴露" || entry.title === "秘密浮现") push("刚被揭开的秘密");
      else if (entry.title === "开场") continue;
      else push(entry.title);
    } else if (entry.type === "agent" && entry.targetAgentId) {
      const speaker = state.agents.find((agent) => agent.id === entry.agentId);
      const target = state.agents.find((agent) => agent.id === entry.targetAgentId);
      if (!speaker || !target) continue;
      if (entry.actionType === "challenge") push(`${speaker.role} 对 ${target.role} 的质问`);
      else if (entry.actionType === "cooperate") push(`${speaker.role} 与 ${target.role} 的暂时同盟`);
      else if (entry.actionType === "reveal") push(`${speaker.role} 朝 ${target.role} 摊牌`);
    }
  }

  for (const agent of state.agents) {
    for (const secret of agent.secrets) {
      if (secret.revealed) continue;
      if (secret.exposure >= 60) push(`${agent.role} 的「${secret.label}」开始浮上来`);
    }
  }

  state.world.emergentFocus = focus.slice(0, 6);
}

async function runAgent(agent) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置：该版本不再提供本地模拟，请设置 API key 以启用真实 Agent。");
  }
  const action = await callJsonLLM(agentSystemPrompt(agent), societySnapshotFor(agent), { modelOverride: agentModel, retryModel: repairModel });
  return normalizeAction(action);
}

function batchAgentSystemPrompt() {
  const ids = state.agents.map((agent) => agent.id).join("|");
  return [
    "你是一个多角色现场模拟器。本次请求会给出多个 actors,每个 actor 都有独立 self/world/others/snapshot。",
    langDirective,
    escalationDirective(),
    "你必须为每个 actor 各输出一个动作,但不要把所有人写成同一种反应。每个动作只能代表该 actor 自己可见、可做、可说的一小步。",
    "若 actor.snapshot.qualityGuidance 非空,这是上一轮系统审计发现的问题。本轮必须修正这些问题,但不要在台词里提到系统审计。",
    "所有 actors 共享同一个 actor.snapshot.dramaBeat。每个动作都必须推动这个 beat:焦点角色承担主动作,其他角色阻止、协助、交换、威胁或利用同一物件。不要各自发散。",
    "如果 actor.id 等于 dramaBeat.focusAgentId,该 actor 必须优先使用 dramaBeat.focusObjectId,并从 dramaBeat.requiredActionTypes 里选 action_type。至少一个 actor 必须让 beat 产生可见状态变化。",
    "每个 actor 的 snapshot.goalFrame.primaryGoal 是最高约束。每个动作必须服务该目标:获取信息、保护秘密、取得物件、逼问阻碍者、争取同盟、转移风险、拖延/加速 deadline 之一。",
    "每个 action.private_intent 必须以'为了本场目标…'说明动作如何推进 primaryGoal; next_intended_action 必须是下一步目标推进动作。不能只因为现场有事件就随机反应。",
    "若 actor.snapshot.directorCue.thisTurn 非空,该 actor 的 speech 第一句必须直接咬住其中的具体词或事实;action_type 严禁 silence/observe/speak,优先 inspect/search/use/move/challenge/threaten/reveal/negotiate/lie/steal/hide/follow/ally/betray/escape。",
    "禁止对话绕圈:不能只反问、只质疑、只说'解释清楚'。每个 speech 必须回答/给出新事实/要求明确证据或代价/提出具体交换/落到物理动作之一。",
    "默认必须造成至少一项可观测状态变化:检查/移动/拿走/藏起物品,换位置,提高/降低怀疑,揭露事实,或推动危机。纯寒暄、同质化互相质问、旁白、替别人决定后果都失败。",
    "物理世界有真实 items/locations/actionSpace。每个 actor 必须从 actor.snapshot.world.actionSpace.availableObjects 中选一个具体对象,填 target_object_id,并从 possibleActions 里改造成 tactic。禁止 target='线索1/物品1/对方/现场/真相'。",
    "必须填写 tactic/concrete_action/risk/intended_state_change。concrete_action 必须是摄像机能拍到的动作,如删除日志、投屏视频、锁门、拨打记者电话、抢走录音笔、改写公告邮件。",
    "必须绑定证据原子:每个动作都要填写 target_evidence_id 和 evidence_action。优先使用 actor.snapshot.dramaBeat.evidenceAtom.id。不要只写'会议记录'这种物件名,要写清是哪一条具体事实。",
    "你不是最终编剧。speech 只是台词草稿,更重要的是输出 dialogue_intent/leverage/what_to_reveal/what_to_hide/subtext,供 Scene Writer 写成人类可读场景。",
    "除 action_type=silence 外,speech 不允许为空,但不要写长段剧本对白。物理动作也必须带一句角色台词草稿,不要只给 visible_behavior。",
    `严格 JSON,不要 Markdown。输出格式:{"actions":[{"agent_id":"${ids}","prethink":{"current_assessment":"","biggest_threat":"","most_suspect_id":"${ids}|null","what_to_hide":"","who_to_probe":"","must_act_not_chat":true},"action_type":"inspect|search|use|move|challenge|lie|conceal|reveal|negotiate|threaten|ally|betray|cooperate|steal|hide|lock|escape|follow|act|speak|observe|silence","target":"","tactic":"","concrete_action":"","target_object_id":"","target_evidence_id":"","evidence_action":"","risk":"","intended_state_change":"","dialogue_intent":"","leverage":"","what_to_reveal":"","what_to_hide":"","subtext":"","drama_beat_id":"","speech":"","visible_behavior":"","private_intent":"","target_agent_id":"${ids}|null","emotion_delta":{"fear":0,"suspicion":0,"guilt":0,"resolve":0,"fatigue":0},"relationship_delta":{},"suspicion_update":{},"known_facts_add":[],"next_intended_action":"","memory_write":"","expose_secret_id":null,"scene_effect":""}]}`
  ].join("\n");
}

function compactBatchSnapshotFor(agent) {
  const snapshot = societySnapshotFor(agent);
  return {
    scenario: {
      title: snapshot.scenario?.title,
      place: snapshot.scenario?.place,
      premise: snapshot.scenario?.premise,
      sceneGoal: snapshot.scenario?.sceneGoal,
      centralConflict: snapshot.scenario?.centralConflict
    },
    world: {
      turn: snapshot.world.turn,
      clock: snapshot.world.clock,
      weather: snapshot.world.weather,
      light: snapshot.world.light,
      threatLevel: snapshot.world.threatLevel,
      dangerLevel: snapshot.world.dangerLevel,
      plotStage: snapshot.world.plotStage,
      activeEvent: snapshot.world.activeEvent,
      myLocation: snapshot.world.myLocation,
      exitsHere: snapshot.world.exitsHere,
      coLocated: snapshot.world.coLocated,
      itemsHere: snapshot.world.itemsHere,
      itemsHeldByMe: snapshot.world.itemsHeldByMe,
      itemsKnownToMe: snapshot.world.itemsKnownToMe,
      evidenceAtoms: snapshot.world.evidenceAtoms,
      actionSpace: snapshot.world.actionSpace,
      patrol: snapshot.world.patrol,
      train: snapshot.world.train,
      unresolvedTensions: snapshot.world.unresolvedTensions,
      revealedClues: snapshot.world.revealedClues
    },
    goalFrame: snapshot.goalFrame,
    self: snapshot.self,
    others: snapshot.others,
    directorCue: snapshot.directorCue,
    dramaBeat: snapshot.dramaBeat,
    storyLedger: snapshot.storyLedger,
    qualityGuidance: snapshot.qualityGuidance,
    immediatePrevious: snapshot.immediatePrevious,
    lastTargetingMe: snapshot.lastTargetingMe,
    myLastSpeeches: snapshot.myLastSpeeches,
    recentTranscript: snapshot.recentTranscript?.slice(-5),
    emergentFocus: snapshot.emergentFocus
  };
}

async function runAgentsBatch(actors) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置：该版本不再提供本地模拟，请设置 API key 以启用真实 Agent。");
  }
  if (!batchAgentCalls || actors.length < 2) return null;
  const payload = {
    mode: "batch_agent_actions",
    instruction: "为 actors 中每个 actor 生成且只生成一个动作。保持角色动机差异,不要模板化。",
    actors: actors.map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      archetype: agent.archetype,
      hiddenIdentity: agent.hiddenIdentity,
      publicIdentity: agent.publicIdentity,
      goals: {
        shortTermGoal: agent.shortTermGoal,
        longTermGoal: agent.longTermGoal,
        nextIntendedAction: agent.nextIntendedAction
      },
      fears: agent.fears,
      speechStyle: agent.speechStyle,
      behaviorStyle: agent.behaviorStyle,
      snapshot: compactBatchSnapshotFor(agent)
    }))
  };
  const response = await callJsonLLM(batchAgentSystemPrompt(), payload, {
    temperature: 0.85,
    maxTokens: Math.min(1800, Math.max(700, actors.length * 520)),
    modelOverride: batchAgentModel,
    retryModel: repairModel
  });
  const rawActions = Array.isArray(response?.actions) ? response.actions : [];
  if (!rawActions.length) throw new Error("batch agent response missing actions[]");
  const actorIds = new Set(actors.map((agent) => agent.id));
  const byAgentId = new Map();
  for (const raw of rawActions) {
    const id = typeof raw?.agent_id === "string" ? raw.agent_id : typeof raw?.agentId === "string" ? raw.agentId : null;
    if (!id || !actorIds.has(id) || byAgentId.has(id)) continue;
    const action = normalizeAction(raw);
    delete action.agent_id;
    delete action.agentId;
    byAgentId.set(id, action);
  }
  if (byAgentId.size === 0) throw new Error("batch agent response had no usable actor actions");
  return byAgentId;
}

async function repairCueAction(agent, rejectedAction, userCue, reason) {
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const system = [
    agentSystemPrompt(agent),
    "【二次修复·不要套模板】上一版动作被服务器拒绝,原因是它没有真正回应 directorCue.thisTurn,或仍然像沉默/空话。",
    "现在重新输出一个全新的动作:必须从角色自己的目标、恐惧、持有物、位置、同场人物和当前事件出发。不要照抄任何固定句式;不要为了检查而检查;不要三个人同质化互相质问。",
    "只修正你自己这个角色的一个小动作。仍然严格 JSON,字段格式不变。"
  ].join("\n");
  const payload = {
    ...societySnapshotFor(agent),
    rejectedAction,
    repairReason: reason,
    instruction: `导演干预是: ${userCue}。请给出符合角色动机和现场因果的非沉默动作。`
  };
  return normalizeAction(await callJsonLLM(system, payload, { modelOverride: repairModel, retryModel: repairModel }));
}

function normalizeAction(action) {
  const allowed = new Set([
    "speak", "observe", "act",
    "challenge", "lie", "conceal", "reveal",
    "negotiate", "threaten", "ally", "betray",
    "cooperate", "move", "silence",
    // V2: 物理动作
    "inspect", "search", "steal", "hide", "lock", "escape", "follow", "use"
  ]);
  const normalized = action && typeof action === "object" ? action : {};
  normalized.action_type = allowed.has(normalized.action_type) ? normalized.action_type : "speak";
  normalized.speech = typeof normalized.speech === "string" ? normalized.speech.slice(0, 420) : "";
  normalized.visible_behavior = typeof normalized.visible_behavior === "string" ? normalized.visible_behavior.slice(0, 360) : "";
  normalized.private_intent = typeof normalized.private_intent === "string" ? normalized.private_intent.slice(0, 360) : "";
  normalized.target_agent_id = typeof normalized.target_agent_id === "string" ? normalized.target_agent_id : null;
  // V2: target 字段 (物件 / 地点 / 出口的描述,由 simulator 解析)
  normalized.target = typeof normalized.target === "string" ? normalized.target.slice(0, 80) : "";
  normalized.tactic = typeof normalized.tactic === "string" ? normalized.tactic.slice(0, 80) : "";
  normalized.concrete_action = typeof normalized.concrete_action === "string" ? normalized.concrete_action.slice(0, 260) : "";
  normalized.target_object_id = typeof normalized.target_object_id === "string" ? normalized.target_object_id.slice(0, 80) : "";
  normalized.target_evidence_id = typeof normalized.target_evidence_id === "string" ? normalized.target_evidence_id.slice(0, 100) : "";
  normalized.evidence_action = typeof normalized.evidence_action === "string" ? normalized.evidence_action.slice(0, 40) : "";
  normalized.risk = typeof normalized.risk === "string" ? normalized.risk.slice(0, 180) : "";
  normalized.intended_state_change = typeof normalized.intended_state_change === "string" ? normalized.intended_state_change.slice(0, 180) : "";
  normalized.dialogue_intent = typeof normalized.dialogue_intent === "string" ? normalized.dialogue_intent.slice(0, 180) : "";
  normalized.leverage = typeof normalized.leverage === "string" ? normalized.leverage.slice(0, 180) : "";
  normalized.what_to_reveal = typeof normalized.what_to_reveal === "string" ? normalized.what_to_reveal.slice(0, 180) : "";
  normalized.what_to_hide = typeof normalized.what_to_hide === "string" ? normalized.what_to_hide.slice(0, 180) : "";
  normalized.subtext = typeof normalized.subtext === "string" ? normalized.subtext.slice(0, 220) : "";
  normalized.drama_beat_id = typeof normalized.drama_beat_id === "string" ? normalized.drama_beat_id.slice(0, 80) : "";
  normalized.emotion_delta = normalized.emotion_delta && typeof normalized.emotion_delta === "object" ? normalized.emotion_delta : {};
  normalized.relationship_delta = normalized.relationship_delta && typeof normalized.relationship_delta === "object" ? normalized.relationship_delta : {};
  normalized.suspicion_update = normalized.suspicion_update && typeof normalized.suspicion_update === "object" ? normalized.suspicion_update : {};
  normalized.known_facts_add = Array.isArray(normalized.known_facts_add)
    ? normalized.known_facts_add.filter((s) => typeof s === "string" && s.trim()).slice(0, 3)
    : [];
  normalized.next_intended_action = typeof normalized.next_intended_action === "string" ? normalized.next_intended_action.slice(0, 200) : "";
  normalized.memory_write = typeof normalized.memory_write === "string" ? normalized.memory_write.slice(0, 280) : "";
  normalized.expose_secret_id = typeof normalized.expose_secret_id === "string" ? normalized.expose_secret_id : "";
  normalized.scene_effect = typeof normalized.scene_effect === "string" ? normalized.scene_effect.slice(0, 220) : "";
  // prethink
  const pt = normalized.prethink && typeof normalized.prethink === "object" ? normalized.prethink : {};
  normalized.prethink = {
    current_assessment: typeof pt.current_assessment === "string" ? pt.current_assessment.slice(0, 200) : "",
    biggest_threat:     typeof pt.biggest_threat === "string"     ? pt.biggest_threat.slice(0, 120)     : "",
    most_suspect_id:    typeof pt.most_suspect_id === "string"    ? pt.most_suspect_id                  : "",
    what_to_hide:       typeof pt.what_to_hide === "string"       ? pt.what_to_hide.slice(0, 120)       : "",
    who_to_probe:       typeof pt.who_to_probe === "string"       ? pt.who_to_probe.slice(0, 60)        : "",
    must_act_not_chat:  Boolean(pt.must_act_not_chat)
  };
  return normalized;
}

function hashText(value) {
  let h = 0;
  const s = String(value || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// LLM 偶尔给 world.light/weather 返回英文(如 "dim"),会漏进中文舞台说明。
// 没有中文字符就退回中文兜底值。
function cjkOrFallback(value, fallback) {
  const s = String(value ?? "").trim();
  return /[一-龥]/.test(s) ? s : fallback;
}

function pickVariant(seed, items) {
  return items[hashText(seed) % items.length];
}

// 兜底台词去模板化:同一条证据在不同回合/角色下用不同措辞,避免每场复读同三句。
function evidenceStatementLine(atom, seed) {
  const label = atom?.label || "这条记录";
  const content = atom?.content || "";
  const variants = [
    `「${label}」不是立场,是记录:${content}`,
    `我不是在指控谁。「${label}」写得很清楚:${content}`,
    `先看这一条——${content} 这就是「${label}」。`,
    `${content} 这是「${label}」里白纸黑字的东西。`,
    `别把它当成我的猜测。${content}`,
    `把「${label}」摊开:${content}`
  ];
  return pickVariant(`${seed}|st|${atom?.id || label}`, variants);
}

function evidencePushbackLine(atom, seed) {
  const variants = [
    `如果这句话进了纪要,后果就不是今晚这张桌子能盖住的。`,
    `你清楚这条一旦坐实,屋里没人能全身而退。`,
    `先想清楚再说——这条说出口,就没有回头路了。`,
    `这不是现在该摊开的东西,至少不是当着所有人。`,
    `我不否认它,但今晚把它端出来,对谁都不是好事。`,
    `你到底想用它换什么?别拿它逼我。`
  ];
  return pickVariant(`${seed}|pb|${atom?.id || atom?.label}`, variants);
}

function evidenceConfrontSpeech(atom, who, seed) {
  const label = atom?.label || "这条记录";
  const content = atom?.content || "";
  const target = who || "你";
  const variants = [
    `${content} 这不是态度问题——${target},谁点的头?`,
    `先别急着表态。${content} 这条摆在这里,${target}怎么解释?`,
    `${content} 我只想知道一件事:这一步是谁签的?`,
    `${target}可以否认我,否认不了「${label}」。${content}`,
    `把话说清楚:${content} 这条到底算谁的责任?`,
    `${content} ${target},轮到你回应这条具体的事了。`
  ];
  return pickVariant(`${seed}|cf|${atom?.id || label}`, variants).slice(0, 96);
}

function briefGoal(agent) {
  const goal = String(agent.shortTermGoal || "保住核心利益").replace(/\s+/g, "");
  return goal.length > 28 ? `${goal.slice(0, 28)}...` : goal;
}

function lastTargetSpeech(targetAgentId) {
  if (!targetAgentId) return "";
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const entry = state.transcript[i];
    if (entry.type === "agent" && entry.agentId === targetAgentId && entry.speech) {
      return entry.speech.slice(0, 24);
    }
  }
  return "";
}

function fallbackSpeechForAction(agent, action, variantOffset = 0) {
  const target = String(action.target || "").trim();
  const targetAgent = action.target_agent_id ? state.agents.find((a) => a.id === action.target_agent_id) : null;
  const namedTarget = targetAgent?.name || target;
  const actionType = action.action_type;
  const goal = briefGoal(agent);
  const hook = lastTargetSpeech(action.target_agent_id);
  const seed = `${agent.id}|${actionType}|${target}|${state.world.turn}|${variantOffset}`;
  const who = namedTarget || "你";
  const thing = target || "这个东西";
  const style = `${agent.speechStyle || ""} ${agent.personality || ""}`;
  const terse = /短句|精确|工程|条款|职业|术语|克制/.test(style);
  const figurative = /隐喻|文学|诗|锋利/.test(style);

  const table = {
    inspect: [
      `我先看清「${thing}」。它若和我的目标无关,我会放下。`,
      `别急着解释,让我确认「${thing}」到底留下了什么。`,
      `空话不可靠。我先检查「${thing}」。`
    ],
    search: [
      `我翻一下${thing}。找不到东西,再谈信任。`,
      `${thing}里若没有答案,至少能排除一个谎。`,
      `我不靠猜。先从${thing}找证据。`
    ],
    use: [
      `「${thing}」就在这儿。谁要阻止,先说清楚代价。`,
      `别再绕了,让「${thing}」自己说话。`,
      `我把「${thing}」亮出来,这事该往前走了。`,
      `现在,我们按「${thing}」说的来,而不是按谁的脸色。`,
      `「${thing}」已经在桌上了,接下来看你们怎么接。`,
      `我用「${thing}」把话钉死:这一步,绕不过去。`,
      `看「${thing}」,该说的它都说了。`,
      `我不想再重复了——「${thing}」摆在这里。`,
      `把「${thing}」记下来,谁也别想当没发生。`
    ],
    move: [
      `我去${thing}。站在这里,只是在等别人安排我。`,
      `${thing}那边可能更接近我要的答案,我过去看。`,
      `这个位置给不了我主动权,我换到${thing}。`,
      `我先到${thing},有些事不在这里说。`,
      `留在原地没意义,我往${thing}走一步。`
    ],
    hide: [
      `现在不能把${thing}摊开。我先收住它。`,
      `${thing}一旦被错的人看见,我的目标就完了。`,
      `这件东西先离开你们的视线。之后我会解释。`,
      `${thing}我先收着,时机不对,谁也别碰。`,
      `别问${thing}在哪,问了我也不会说。`
    ],
    steal: [
      `${thing}不能继续留在原处。我先拿过来。`,
      `谁握着${thing},谁就握着局面。先交给我。`,
      `我不等你们许可了,${thing}现在必须换手。`,
      `${thing}放你那儿我不放心,给我。`,
      `从这一刻起,${thing}由我保管,谁有意见现在提。`
    ],
    lock: [
      `先把${thing}关住。出口失控,人也会失控。`,
      `${thing}现在不能再开着,至少先争取几分钟。`,
      `我锁住${thing},不是为了困住谁,是为了不被外面牵着走。`
    ],
    escape: [
      `继续困在这里,我的目标只会越来越远。我得试着离开。`,
      `这里已经不是谈判桌了,我现在要找出口。`,
      `再等下去就是把选择权交出去。我走。`
    ],
    follow: [
      `${who}去哪儿,我就跟到哪儿。别想把关键动作藏到门后。`,
      `${who},你要离开我的视线,先给出理由。`,
      `我跟着${who}。这一步比继续争论更有用。`
    ],
    challenge: [
      `${who},先别换题。你刚才避开的那个点,关系到${goal}。`,
      `${who},我问的不是态度,是你那句话里哪一部分是真的。`,
      `${who},${hook ? `你刚才说「${hook}」` : "你的解释"}不够。把缺的那一段补上。`
    ],
    lie: [
      `你们想错了。我现在做这件事,只是为了把风险压下去。`,
      `别把我推到那个位置。我没有你们以为的那种筹码。`,
      `这件事和我无关。你们该看的是眼前的漏洞。`
    ],
    conceal: [
      `这件事现在说出来只会添乱。先处理能改变局面的部分。`,
      `我不是回避,我是暂时不把牌翻给错误的人看。`,
      `有些话晚一点说,比现在说更能保住所有人的路。`
    ],
    reveal: [
      `我只说一部分。再藏下去,它会先毁掉我的目标。`,
      `有件事必须摆出来,但你们别急着替它下结论。`,
      `我可以给出真相的一角,换你们停止乱猜。`
    ],
    negotiate: [
      `别空耗了。我拿出条件,你们拿出能交换的东西。`,
      `我需要的是能推进${goal}的答案,不是漂亮话。开条件吧。`,
      `我们可以合作,但每个人都要交出一点真实筹码。`
    ],
    threaten: [
      `${who},再绕下去,后果就不只是难堪。`,
      `我不想把事情做绝,但你们正在逼我选择更硬的办法。`,
      `继续挡我的路,我会把你最怕被看见的部分推到灯下。`
    ],
    ally: [
      `${who},先站到我这边。我们一起把最危险的那个人逼出来。`,
      `现在不是彼此消耗的时候。${who},和我合作。`,
      `${who},你要自保,我也要达成目标。我们可以暂时同路。`
    ],
    betray: [
      `刚才的默契到此为止。我现在按自己的判断走。`,
      `我给过机会,但这条路已经不再帮我接近目标。`,
      `别再把我算进你们的安排里。我的选择改了。`
    ],
    cooperate: [
      `先别互相拆台。眼下我们至少要把同一件事弄清楚。`,
      `合作可以,但每一步都要留下证据。`,
      `我愿意配合,前提是它真的能推进${goal}。`
    ],
    observe: [
      `我先看清每个人的反应。现在急着表态的人最可疑。`,
      `我不插话,但我会记住谁在这个点上移开眼睛。`,
      `先看一轮。破绽通常不在答案里,在停顿里。`
    ],
    act: [
      `我不能继续等下去。现在要做一件能改变局面的事。`,
      `话已经够多了。我先把主动权拉回手里。`,
      `再讨论只会变成拖延。我现在动手处理眼前的问题。`
    ]
  };
  const variants = table[actionType] || table.act;
  let speech = pickVariant(seed, variants);
  if (terse && speech.length > 44) speech = speech.replace(/。.*$/, "。");
  if (figurative && actionType === "challenge") {
    speech = pickVariant(seed, [
      `${who},别把影子说成天气。你刚才避开的地方,才是真话。`,
      `${who},你绕开的不是词,是门。把那扇门打开。`,
      `${who},这句话有缺口。我要听缺口后面的东西。`
    ]);
  }
  return speech.slice(0, 420);
}

function ensureAudibleAction(agent, action) {
  if (action.action_type === "silence") return action;
  if (String(action.speech || "").trim()) return action;
  action.speech = fallbackSpeechForAction(agent, action).slice(0, 420);
  if (!action.visible_behavior) {
    action.visible_behavior = `${agent.name}不再停在原地,把注意力压到当前动作上。`;
  }
  state.societyLog.push({
    kind: "speech_autofill",
    agentId: agent.id,
    actionType: action.action_type,
    turn: state.world.turn
  });
  return action;
}

function detectRecentSpeechEcho(speech) {
  if (!speech) return null;
  const normalized = normalizeForSimilarity(speech);
  const recent = state.transcript
    .filter((entry) => entry.type === "agent" && entry.speech)
    .slice(-8);
  for (const entry of recent) {
    const other = normalizeForSimilarity(entry.speech);
    const sim = speechSimilarity(speech, entry.speech);
    if ((normalized && normalized === other) || sim >= 0.72) {
      return { sim, against: entry.speech, agentId: entry.agentId };
    }
  }
  return null;
}

function avoidRecentSpeechEcho(agent, action) {
  if (action.action_type === "silence" || !action.speech) return action;
  const echo = detectRecentSpeechEcho(action.speech);
  if (!echo) return action;
  const original = action.speech;
  for (const offset of [41, 53, 67, 79, 97]) {
    const candidate = fallbackSpeechForAction(agent, action, offset);
    if (!detectRecentSpeechEcho(candidate)) {
      action.speech = candidate;
      break;
    }
  }
  if (action.speech === original) {
    action.speech = `${fallbackSpeechForAction(agent, action, 113)} 这次我换个切口说。`.slice(0, 420);
  }
  state.societyLog.push({
    kind: "speech_echo_rewrite",
    agentId: agent.id,
    sim: Number((echo.sim || 1).toFixed(3)),
    turn: state.world.turn
  });
  return action;
}

function goalIntentPrefix(agent) {
  return `为了本场目标「${agent.shortTermGoal || "保住核心利益"}」`;
}

function mostGoalUsefulTarget(agent) {
  const myLocId = agent.location || state.world.defaultLocationId;
  const coLocated = state.agents.filter((item) => item.id !== agent.id && (item.location || state.world.defaultLocationId) === myLocId);
  if (!coLocated.length) return null;
  return coLocated.slice().sort((a, b) => (agent.suspicions[b.id] || 50) - (agent.suspicions[a.id] || 50))[0];
}

function goalRelevantVisibleItem(agent) {
  const myLocId = agent.location || state.world.defaultLocationId;
  const items = state.world.items || [];
  const undiscovered = items.find((item) =>
    item.location === myLocId &&
    item.holder !== agent.id &&
    !(item.discoveredBy || []).includes(agent.id)
  );
  if (undiscovered) return undiscovered;
  return items.find((item) => item.location === myLocId && !item.hidden) || null;
}

function concreteGoalNextStep(agent, action) {
  const target = action.target_agent_id ? agentDisplayName(action.target_agent_id) : action.target || "";
  if (action.action_type === "use") return `继续利用${target || "关键物件"}制造不可逆状态变化,推进「${agent.shortTermGoal}」。`;
  if (["inspect", "search"].includes(action.action_type)) return `确认${target || "现场线索"}是否能推进「${agent.shortTermGoal}」。`;
  if (["challenge", "threaten"].includes(action.action_type)) return `继续逼问${target || "最可疑的人"},让对方暴露与我目标相关的破绽。`;
  if (["negotiate", "ally", "cooperate"].includes(action.action_type)) return `把${target || "对方"}变成临时筹码,换取对「${agent.shortTermGoal}」有用的信息或行动。`;
  if (["hide", "conceal", "lie"].includes(action.action_type)) return `先保护会妨碍「${agent.shortTermGoal}」的秘密,再寻找主动权。`;
  if (["move", "follow", "escape"].includes(action.action_type)) return `调整位置,寻找更接近「${agent.shortTermGoal}」的机会。`;
  if (action.action_type === "reveal") return `只揭开对「${agent.shortTermGoal}」有利的一部分信息,换取局面控制。`;
  return `下一步用具体质问或检查推进「${agent.shortTermGoal}」。`;
}

function isAbstractActionTarget(value) {
  const text = String(value || "").trim();
  return !text || /^(线索|物品|对象|证据|真相|现场|对方|某人|情况|问题)\s*[-_#]?\s*\d*$/i.test(text);
}

function itemMatchesActionTarget(item, action) {
  const text = `${action.target_object_id || ""} ${action.target || ""} ${action.concrete_action || ""} ${action.tactic || ""}`.toLowerCase();
  if (!text.trim()) return false;
  return text.includes(String(item.id || "").toLowerCase())
    || text.includes(String(item.label || "").toLowerCase())
    || String(item.label || "").includes(action.target || "")
    || (item.triggers || []).some((kw) => kw && text.includes(String(kw).toLowerCase()));
}

function chooseTacticalItem(agent, action) {
  const myLocId = agent.location || state.world.defaultLocationId;
  const coLocatedIds = new Set(state.agents
    .filter((a) => (a.location || state.world.defaultLocationId) === myLocId)
    .map((a) => a.id));
  const items = (state.world.items || []).filter((item) => {
    if (item.holder === agent.id) return true;
    if (item.location === myLocId) return true;
    if (item.holder && coLocatedIds.has(item.holder)) return true;
    return !item.hidden;
  });
  const exact = items.find((item) => itemMatchesActionTarget(item, action));
  if (exact) return exact;
  const goalText = `${agent.shortTermGoal || ""} ${agent.hiddenIdentity || ""} ${agent.resources?.join(" ") || ""}`;
  const goalHit = items.find((item) => {
    const joined = `${item.label} ${item.contents} ${item.stakes} ${(item.possibleActions || []).join(" ")}`;
    if (/公开|揭露|正义|记者|上报/.test(goalText) && /公开|发送|记者|投屏|播放|复制|证据|视频|日志|报告/.test(joined)) return true;
    if (/避免|掩盖|维护|责任|形象|保密|藏/.test(goalText) && /删除|藏|撤回|改写|锁|日志|公告|录音/.test(joined)) return true;
    if (/利润|股票|财务|钱|交换|筹码|控制/.test(goalText) && /合同|股票|交易|筹码|威胁|协议|金币/.test(joined)) return true;
    return false;
  });
  if (goalHit) return goalHit;
  const held = items.find((item) => item.holder === agent.id);
  if (held) return held;
  const visible = items.find((item) => item.location === myLocId && !item.hidden);
  return visible || items[0] || null;
}

function chooseTacticalVerb(agent, action, item) {
  const options = item?.possibleActions || [];
  const goalText = `${agent.shortTermGoal || ""} ${action.private_intent || ""} ${action.tactic || ""} ${action.concrete_action || ""}`;
  const find = (pattern) => options.find((option) => pattern.test(option));
  if (/公开|揭露|正义|记者|上报/.test(goalText)) return find(/公开|发送|记者|投屏|播放|复制|出示|拨打/) || options[0] || "公开";
  if (/避免|掩盖|维护|责任|形象|保密|藏|逃/.test(goalText)) return find(/删除|藏|撤回|改写|关|锁|剪|清除/) || options[0] || "藏起";
  if (/利润|股票|交换|筹码|威胁|控制|谈判/.test(goalText)) return find(/威胁|摊开|交换|作为筹码|延迟|改写/) || options[0] || "作为筹码";
  if (action.action_type === "steal") return find(/拿|抢|夺/) || "拿走";
  if (action.action_type === "hide" || action.action_type === "conceal") return find(/藏|关|删除|撤回/) || "藏起";
  if (action.action_type === "lock") return find(/锁|堵/) || "锁上";
  return options[hashText(`${agent.id}|${item?.id}|${state.world.turn}`) % Math.max(1, options.length)] || "检查";
}

function actionTypeFromTacticalVerb(verb, currentType) {
  const text = String(verb || "");
  if (/锁|堵/.test(text)) return "use";
  if (/拿|抢|夺/.test(text)) return "steal";
  if (/删除|撤回|关掉|销毁|清除/.test(text)) return "use";
  if (/藏/.test(text)) return "hide";
  if (/检查|翻看|调取|看/.test(text) && ["inspect", "search"].includes(currentType)) return currentType;
  if (/威胁|交换|作为筹码/.test(text)) return "use";
  if (/合作|条件/.test(text)) return "negotiate";
  if (/打开|复制|投屏|播放|发送|拨打|录音|改写|摊开|撕毁|出示|宣读|转发/.test(text)) return "use";
  return ["speak", "observe", "silence", "act", "challenge"].includes(currentType) ? "use" : currentType;
}

function concreteActionSentence(agent, item, verb) {
  if (!item) return `${agent.name}把注意力落到一个能改变局面的具体对象上。`;
  const label = item.label;
  const n = agent.name;
  const seed = `${agent.id}|${verb}|${label}|${state.world.turn}`;
  const pick = (arr) => pickVariant(seed, arr);
  if (/删除|清除/.test(verb)) return pick([
    `${n}伸手去抹掉「${label}」里的关键记录。`,
    `${n}的手指停在「${label}」上,像是想让它消失。`,
    `${n}试图悄悄删掉「${label}」,动作没瞒过所有人。`
  ]);
  if (/投屏|播放|出示|摊开/.test(verb)) return pick([
    `${n}把「${label}」推到桌子中央,让所有人都得看。`,
    `${n}把「${label}」摊开,屋里一下安静下来。`,
    `${n}举起「${label}」,不给任何人回避的余地。`,
    `${n}把「${label}」转向众人,等着看谁先开口。`
  ]);
  if (/发送|转发|拨打/.test(verb)) return pick([
    `${n}拿起「${label}」,把消息往外面递。`,
    `${n}的手指悬在「${label}」上,随时能把它送出这间屋子。`,
    `${n}低声拨弄「${label}」,要把秘密推向外部。`
  ]);
  if (/锁|堵/.test(verb)) return pick([
    `${n}走到「${label}」前,把这个出口攥在自己手里。`,
    `${n}按住「${label}」,先不让任何人离开或介入。`,
    `${n}卡住「${label}」,争取几分钟主动权。`
  ]);
  if (/抢|拿/.test(verb)) return pick([
    `${n}伸手去拿「${label}」,不再等谁点头。`,
    `${n}一把按住「${label}」,把它收进自己这边。`,
    `${n}抢先碰到「${label}」,动作比话快。`
  ]);
  if (/藏|关/.test(verb)) return pick([
    `${n}把「${label}」从众人视线里收走。`,
    `${n}悄悄把「${label}」压到身后,断了别人的念头。`,
    `${n}把「${label}」塞进看不见的地方,只留一句"以后再说"。`
  ]);
  if (/威胁|交换|筹码/.test(verb)) return pick([
    `${n}点住「${label}」,把它摆成一张谈判牌。`,
    `${n}用「${label}」轻轻敲了敲桌面,意思谁都懂。`,
    `${n}把「${label}」推近半寸,又收回,当成筹码晾着。`
  ]);
  return pick([
    `${n}围着「${label}」做文章,把争论引到这件具体东西上。`,
    `${n}抓住「${label}」,逼大家正视它。`
  ]);
}

function intendedStateSentence(agent, item, verb) {
  const label = item?.label || "关键物件";
  if (/删除|清除|销毁/.test(verb)) return `「${label}」被尝试抹除,但操作痕迹会成为新的风险。`;
  if (/撤回|延迟|改写/.test(verb)) return `「${label}」的版本或发送时机被改动,现场口径开始偏向${agent.name}。`;
  if (/投屏|播放|出示|摊开|宣读/.test(verb)) return `「${label}」进入公共视野,所有人的说法都必须围绕它重组。`;
  if (/发送|转发|拨打|呼叫/.test(verb)) return `「${label}」把秘密推向外部,局面出现不可逆扩散。`;
  if (/锁|堵/.test(verb)) return `「${label}」被用来控制出入口或权限,现场自由度下降。`;
  if (/抢|拿/.test(verb)) return `「${label}」改变控制者,其他人立刻获得新的怀疑对象。`;
  if (/藏|关机|关掉/.test(verb)) return `「${label}」暂时离开公共视线,信息流被${agent.name}截断。`;
  if (/威胁|交换|筹码/.test(verb)) return `「${label}」被摆成筹码,关系从争论转为交易。`;
  return `「${label}」不再只是线索,而成为${agent.name}推进目标的筹码。`;
}

function ensureConcreteTacticalAction(agent, action, userCue = "") {
  if (action.action_type === "silence") return action;
  const abstract = isAbstractActionTarget(action.target)
    || isGenericObjectLabel(action.target)
    || !action.concrete_action
    || !action.target_object_id
    || /线索\s*\d|物品\s*\d|解释清楚|真实理由|继续观察|等待|换个切口/.test(`${action.target || ""} ${action.speech || ""} ${action.visible_behavior || ""} ${action.concrete_action || ""}`);
  if (!abstract && action.risk && action.intended_state_change) return action;
  const item = chooseTacticalItem(agent, action);
  if (!item) return action;
  let verb = chooseTacticalVerb(agent, action, item);
  if (item.holder && item.holder !== agent.id && item.hidden && !["steal", "negotiate", "threaten"].includes(action.action_type)) {
    verb = "抢走";
  }
  const nextType = actionTypeFromTacticalVerb(verb, action.action_type);
  action.action_type = nextType;
  action.target_object_id = item.id;
  action.target = item.label;
  action.tactic = action.tactic || `${verb}${item.label}`.slice(0, 80);
  action.concrete_action = action.concrete_action && !/线索\s*\d|解释清楚|真实理由/.test(action.concrete_action)
    ? action.concrete_action
    : concreteActionSentence(agent, item, verb);
  action.visible_behavior = action.visible_behavior && !/等待里抬头|话题压到|中止来回质问|线索\s*\d|解释清楚|真实理由/.test(action.visible_behavior)
    ? action.visible_behavior
    : action.concrete_action;
  action.risk = action.risk || `如果${agent.name}动作失败或被看见,其他人会立刻获得反制${agent.name}的把柄。`;
  action.intended_state_change = action.intended_state_change || intendedStateSentence(agent, item, verb);
  if (!action.private_intent || !action.private_intent.includes("本场目标")) {
    action.private_intent = `${goalIntentPrefix(agent)},用「${item.label}」制造可见状态变化。`.slice(0, 360);
  }
  if (!action.speech || /解释清楚|真实理由|换个切口|空话不可靠|线索\s*\d/.test(action.speech)) {
    action.speech = fallbackSpeechForAction(agent, action, 151);
  }
  state.societyLog.push({
    kind: "concrete_tactic_force",
    agentId: agent.id,
    actionType: action.action_type,
    targetObjectId: item.id,
    tactic: action.tactic,
    turn: state.world.turn,
    reason: userCue ? "cue_or_abstract_action" : "abstract_action"
  });
  return action;
}

function actionSatisfiesDramaBeat(agent, action, beat) {
  if (!beat || !action) return true;
  const actionText = `${action.action_type || ""} ${action.target || ""} ${action.target_object_id || ""} ${action.target_evidence_id || ""} ${action.tactic || ""} ${action.concrete_action || ""} ${action.intended_state_change || ""}`;
  const typeHit = (beat.requiredActionTypes || []).includes(action.action_type);
  const objectHit = beat.focusObjectId && actionText.includes(beat.focusObjectId);
  const objectLabelHit = beat.focusObjectLabel && actionText.includes(beat.focusObjectLabel);
  const evidenceHit = beat.evidenceAtomId && actionText.includes(beat.evidenceAtomId);
  const concrete = Boolean(action.concrete_action || action.intended_state_change || action.target_object_id);
  if (agent.id === beat.focusAgentId) return concrete && (evidenceHit || typeHit || objectHit || objectLabelHit);
  return concrete && (evidenceHit || typeHit || objectHit || objectLabelHit || action.target_agent_id === beat.focusAgentId || action.target_agent_id === beat.targetAgentId);
}

function ensureDramaBeatAction(agent, action, userCue = "") {
  const beat = state.director.currentBeat;
  if (!beat || beat.turn !== state.world.turn || action.action_type === "silence") return action;
  action.drama_beat_id = beat.id;
  if (actionSatisfiesDramaBeat(agent, action, beat)) return action;

  const focusObject = beat.focusObjectId
    ? (state.world.items || []).find((item) => item.id === beat.focusObjectId)
    : chooseTacticalItem(agent, action);
  const isFocus = agent.id === beat.focusAgentId;
  if (focusObject) {
    let verb = (beat.suggestedTactics || [])[hashText(`${agent.id}|${beat.id}`) % Math.max(1, (beat.suggestedTactics || []).length)] || chooseTacticalVerb(agent, action, focusObject);
    if (focusObject.holder && focusObject.holder !== agent.id && focusObject.hidden && !isFocus) verb = "抢走";
    action.action_type = actionTypeFromTacticalVerb(verb, action.action_type);
    if (!(beat.requiredActionTypes || []).includes(action.action_type) && isFocus) {
      action.action_type = (beat.requiredActionTypes || []).includes("use") ? "use" : (beat.requiredActionTypes || [action.action_type])[0];
    }
    action.target = focusObject.label;
    action.target_object_id = focusObject.id;
    action.tactic = `${verb}${focusObject.label}`.slice(0, 80);
    action.concrete_action = concreteActionSentence(agent, focusObject, verb);
    action.visible_behavior = action.concrete_action;
    action.risk = action.risk || `如果这个 beat 失败,${agent.name}会失去围绕「${focusObject.label}」的主动权。`;
    action.intended_state_change = intendedStateSentence(agent, focusObject, verb);
    action.private_intent = `${goalIntentPrefix(agent)},同时完成本回合戏剧Beat「${beat.title}」。`.slice(0, 360);
    if (!action.speech || /解释清楚|真实理由|换个切口|线索\s*\d/.test(action.speech)) {
      action.speech = fallbackSpeechForAction(agent, action, 191);
    }
  } else if (beat.targetAgentId) {
    action.action_type = (beat.requiredActionTypes || []).includes("negotiate") ? "negotiate" : "threaten";
    action.target_agent_id = beat.targetAgentId;
    action.target = beat.targetAgentId;
    action.tactic = `${beat.title}:逼迫${beat.targetAgentName || agentDisplayName(beat.targetAgentId)}`;
    action.concrete_action = `${agent.name}把本轮压力转向${beat.targetAgentName || agentDisplayName(beat.targetAgentId)},要求对方用具体代价回应。`;
    action.visible_behavior = action.concrete_action;
    action.risk = action.risk || `如果${agent.name}压不住对方,这个 beat 会退回空谈。`;
    action.intended_state_change = action.intended_state_change || `关系压力转向${beat.targetAgentName || agentDisplayName(beat.targetAgentId)}。`;
    action.speech = action.speech || fallbackSpeechForAction(agent, action, 191);
  }
  state.societyLog.push({
    kind: "drama_beat_force",
    agentId: agent.id,
    beatId: beat.id,
    actionType: action.action_type,
    focusObjectId: beat.focusObjectId,
    turn: state.world.turn
  });
  return action;
}

function evidenceActionFor(actionType, action = {}) {
  const explicit = String(action.evidence_action || "").trim();
  if (/^(reveal|suppress|alter|trade|destroy|protect|use)$/.test(explicit)) return explicit;
  if (["reveal", "inspect", "search"].includes(actionType)) return "reveal";
  if (["hide", "conceal", "lock"].includes(actionType)) return "suppress";
  if (["lie"].includes(actionType)) return "alter";
  if (["negotiate", "ally", "threaten"].includes(actionType)) return "trade";
  if (["steal", "use", "act", "challenge"].includes(actionType)) return "use";
  return "use";
}

function ensureEvidenceBoundAction(agent, action, userCue = "") {
  if (action.action_type === "silence") return action;
  const beat = state.director.currentBeat;
  const previousEvidenceId = action.target_evidence_id || "";
  let atom = null;
  if (action.target_evidence_id) {
    atom = (state.world.evidenceAtoms || []).find((item) => item.id === action.target_evidence_id) || null;
  }
  if (!atom && beat?.evidenceAtomId) {
    atom = (state.world.evidenceAtoms || []).find((item) => item.id === beat.evidenceAtomId) || null;
  }
  if (!atom && action.target_object_id) {
    atom = (state.world.evidenceAtoms || []).find((item) => item.itemId === action.target_object_id && item.status !== "destroyed") || null;
  }
  if (!atom) {
    atom = (state.world.evidenceAtoms || []).find((item) => item.status !== "destroyed") || null;
  }
  if (!atom) return action;

  const item = atom.itemId ? (state.world.items || []).find((it) => it.id === atom.itemId) : null;
  action.target_evidence_id = atom.id;
  action.evidence_action = evidenceActionFor(action.action_type, action);
  if (item && !action.target_object_id) action.target_object_id = item.id;
  if (item && (!action.target || isAbstractActionTarget(action.target) || isGenericObjectLabel(action.target))) action.target = item.label;
  // hurtsAgentIds 为空时,退回到真实的对手角色名,而不是字面量「对方」(后者会直接漏进台词)。
  const otherAgentName = agentDisplayName(action.target_agent_id)
    || (state.agents || []).map((a) => a.name).find((name) => name && name !== agent.name)
    || "对方";
  const hurt = (atom.hurtsAgentIds || []).map(agentDisplayName).filter(Boolean).join("、") || otherAgentName;
  const help = (atom.helpsAgentIds || []).map(agentDisplayName).filter(Boolean).join("、") || agent.name;
  const factLine = `「${atom.label}」显示：${atom.content}`;
  if (!action.what_to_reveal || !action.what_to_reveal.includes(atom.content.slice(0, 8))) {
    action.what_to_reveal = factLine.slice(0, 180);
  }
  if (!action.leverage) {
    action.leverage = `${factLine}；它会伤害${hurt},帮助${help}。`.slice(0, 180);
  }
  if (!action.dialogue_intent || !action.dialogue_intent.includes(atom.label)) {
    action.dialogue_intent = `用「${atom.label}」逼${hurt}回应具体后果,不能再停留在立场。`.slice(0, 180);
  }
  if (!action.intended_state_change || !action.intended_state_change.includes(atom.ifRevealed.slice(0, 8))) {
    action.intended_state_change = (atom.ifRevealed || `这条事实会让${hurt}的选择空间变窄。`).slice(0, 180);
  }
  action.known_facts_add = [
    ...(action.known_facts_add || []),
    `${atom.label}: ${atom.content}`
  ].slice(0, 3);
  if (!action.concrete_action || /会议记录|日志|文件|证据/.test(action.concrete_action) && !action.concrete_action.includes(atom.label)) {
    const itemLabel = item?.label || "证据";
    action.concrete_action = `${agent.name}把「${itemLabel}」停在「${atom.label}」这一段,让${hurt}必须回应这条具体事实。`.slice(0, 260);
    action.visible_behavior = action.concrete_action;
  }
  if (!action.speech || /我现在就用|摆到台面|换个切口|会比我们任何人的解释都诚实|空话到此为止/.test(action.speech)) {
    action.speech = evidenceConfrontSpeech(atom, hurt, `${state.world.turn}-${agent.id}`);
  }
  state.societyLog.push({
    kind: "evidence_atom_bind",
    agentId: agent.id,
    evidenceAtomId: atom.id,
    evidenceAction: action.evidence_action,
    turn: state.world.turn,
    forced: !previousEvidenceId || previousEvidenceId !== atom.id || Boolean(userCue)
  });
  return action;
}

function resolveDramaBeat(beat, actions, changes) {
  if (!beat || beat.turn !== state.world.turn) return null;
  const fulfilledBy = [];
  for (const { agentId, action } of actions || []) {
    const agent = state.agents.find((item) => item.id === agentId);
    if (!agent || !action) continue;
    if (actionSatisfiesDramaBeat(agent, action, beat)) {
      fulfilledBy.push({
        agentId,
        agentName: agent.name,
        actionType: action.action_type,
        target: action.target || "",
        evidenceAtomId: action.target_evidence_id || "",
        evidenceAction: action.evidence_action || "",
        concreteAction: action.concrete_action || action.visible_behavior || action.speech || ""
      });
    }
  }
  const changed = (changes || []).length > 0;
  const objectTouched = beat.focusObjectId && (actions || []).some(({ action }) =>
    action?.target_object_id === beat.focusObjectId || action?.simulation?.itemId === beat.focusObjectId);
  const evidenceTouched = beat.evidenceAtomId && (actions || []).some(({ action }) => action?.target_evidence_id === beat.evidenceAtomId);
  const ok = fulfilledBy.length > 0 && (changed || objectTouched || evidenceTouched) && (!beat.evidenceAtomId || evidenceTouched);
  beat.status = ok ? "fulfilled" : "missed";
  beat.fulfilledBy = fulfilledBy.slice(0, 4);
  beat.missedReasons = ok ? [] : [
    fulfilledBy.length ? "" : "没有动作真正命中 beat 要求。",
    changed ? "" : "回合没有产生足够明确的状态变化。",
    beat.evidenceAtomId && !evidenceTouched ? `证据原子「${beat.evidenceAtom?.label || beat.evidenceAtomId}」没有被使用。` : "",
    beat.focusObjectId && !objectTouched ? `焦点物件「${beat.focusObjectLabel}」没有被触碰。` : ""
  ].filter(Boolean);
  beat.resolution = ok
    ? `完成：${fulfilledBy.map((item) => `${item.agentName}/${actionTypeLabel(item.actionType)}`).join("、")} 围绕「${beat.evidenceAtom?.label || beat.title}」推动了变化。`
    : `未充分完成：${beat.missedReasons.join(" ")}`;
  state.societyLog.push({
    kind: "drama_beat_resolved",
    turn: state.world.turn,
    beatId: beat.id,
    status: beat.status,
    message: beat.resolution,
    fulfilledBy
  });
  return beat;
}

function ensureGoalDrivenAction(agent, action, userCue = "") {
  const goal = agent.shortTermGoal || "";
  const prefix = goalIntentPrefix(agent);
  const combined = `${action.private_intent || ""} ${action.next_intended_action || ""} ${action.prethink?.current_assessment || ""}`;

  if (goal && !combined.includes(goal.slice(0, Math.min(goal.length, 12))) && !combined.includes("本场目标")) {
    action.private_intent = `${prefix},${action.private_intent || "先争取可用信息和主动权。"}`.slice(0, 360);
  } else if (!action.private_intent) {
    action.private_intent = `${prefix},执行当前最有利的一步。`.slice(0, 360);
  }

  if (!action.next_intended_action || /继续观察|看看|等待|随机|再说|不确定/.test(action.next_intended_action)) {
    action.next_intended_action = concreteGoalNextStep(agent, action).slice(0, 200);
  }

  if (action.prethink && !String(action.prethink.current_assessment || "").includes("目标")) {
    action.prethink.current_assessment = `我必须围绕目标「${goal || "保住核心利益"}」处理眼前局面。`.slice(0, 200);
  }

  const weakAction = ["speak", "observe", "silence", "act"].includes(action.action_type) && !action.target && !action.target_agent_id;
  if (!userCue && weakAction) {
    const target = mostGoalUsefulTarget(agent);
    const item = goalRelevantVisibleItem(agent);
    if (item) {
      action.action_type = "use";
      action.target = item.label || item.id;
      action.target_object_id = item.id;
      action.tactic = action.tactic || `${chooseTacticalVerb(agent, action, item)}${item.label || item.id}`;
      action.concrete_action = action.concrete_action || concreteActionSentence(agent, item, chooseTacticalVerb(agent, action, item));
      action.speech = fallbackSpeechForAction(agent, action, 23);
      action.visible_behavior = action.concrete_action;
      action.private_intent = `${prefix},先从现场物件里找可用筹码。`.slice(0, 360);
      action.next_intended_action = concreteGoalNextStep(agent, action);
    } else if (target) {
      action.action_type = "challenge";
      action.target = target.id;
      action.target_agent_id = target.id;
      action.speech = fallbackSpeechForAction(agent, action, 23);
      action.visible_behavior = `${agent.name}把原本松散的反应收住,转而逼问${target.name}。`;
      action.private_intent = `${prefix},先压迫最可疑的人给出有用信息。`.slice(0, 360);
      action.next_intended_action = `根据${target.name}的回答决定是继续逼问、交换,还是转去检查关键物件。`;
      action.suspicion_update = { ...(action.suspicion_update || {}), [target.id]: Math.max(6, Number(action.suspicion_update?.[target.id]) || 0) };
    }
    state.societyLog.push({
      kind: "goal_alignment_force",
      agentId: agent.id,
      actionType: action.action_type,
      turn: state.world.turn
    });
  }

  return action;
}

const DIALOGUE_LOOP_ACTIONS = new Set(["speak", "challenge", "lie", "conceal", "negotiate", "threaten", "cooperate", "ally"]);
const STATEFUL_BREAK_ACTIONS = new Set(["inspect", "search", "use", "steal", "hide", "move", "lock", "escape", "follow", "reveal", "betray"]);

function recentDialogueLoopReport() {
  const recent = state.transcript.filter((entry) => entry.type === "agent").slice(-6);
  if (recent.length < 4) return { looping: false, recent };
  const dialogueCount = recent.filter((entry) => DIALOGUE_LOOP_ACTIONS.has(entry.actionType)).length;
  const challengeCount = recent.filter((entry) => entry.actionType === "challenge").length;
  const statefulCount = recent.filter((entry) =>
    STATEFUL_BREAK_ACTIONS.has(entry.actionType) ||
    (entry.simulation && entry.simulation.kind && entry.simulation.kind !== "noop") ||
    (Array.isArray(entry.knownFactsAdd) && entry.knownFactsAdd.length)
  ).length;
  const questionCount = recent.filter((entry) => /[?？]$/.test(String(entry.speech || "").trim())).length;
  const previousTurnHadNoChange = Array.isArray(state.metrics?.lastTurnChanges) && state.metrics.lastTurnChanges.length === 0;
  return {
    looping: (dialogueCount >= 4 && statefulCount === 0) || challengeCount >= 3 || (previousTurnHadNoChange && dialogueCount >= 3 && questionCount >= 2),
    dialogueCount,
    challengeCount,
    statefulCount,
    questionCount,
    recent
  };
}

function exposeCandidateSecret(agent) {
  return (agent.secrets || [])
    .filter((secret) => !secret.revealed)
    .sort((a, b) => (b.exposure || 0) - (a.exposure || 0))[0] || null;
}

function ensureDialogueProgressAction(agent, action, userCue = "") {
  if (userCue) return action;
  const report = recentDialogueLoopReport();
  if (!report.looping) return action;
  if (!DIALOGUE_LOOP_ACTIONS.has(action.action_type || "speak")) return action;

  const item = goalRelevantVisibleItem(agent);
  const target = mostGoalUsefulTarget(agent);
  const secret = exposeCandidateSecret(agent);
  const prefix = goalIntentPrefix(agent);

  if (item) {
    action.action_type = "inspect";
    action.target = item.label || item.id;
    action.target_agent_id = item.holder && item.holder !== agent.id ? item.holder : null;
    action.speech = fallbackSpeechForAction(agent, action, 131);
    action.visible_behavior = `${agent.name}中止来回质问,转而检查「${item.label || item.id}」。`;
    action.private_intent = `${prefix},用可验证物件打断绕圈对话。`.slice(0, 360);
    action.next_intended_action = concreteGoalNextStep(agent, action);
    action.known_facts_add = action.known_facts_add || [];
  } else if (secret && ((secret.exposure || 0) >= 55 || state.director.pressure >= 68)) {
    action.action_type = "reveal";
    action.target = secret.label;
    action.target_agent_id = null;
    action.expose_secret_id = secret.id;
    action.speech = `别再绕了。我只说这一件事:「${secret.label}」确实和我有关。现在你们该重新判断。`;
    action.visible_behavior = `${agent.name}停下互相逼问,把一块原本藏住的信息推到桌面上。`;
    action.private_intent = `${prefix},用可控揭露换取局面主动权。`.slice(0, 360);
    action.next_intended_action = `观察众人如何利用「${secret.label}」,再决定继续交代还是转移风险。`;
    action.emotion_delta = { ...(action.emotion_delta || {}), fear: 4, resolve: 4 };
  } else if (target) {
    action.action_type = "negotiate";
    action.target = target.id;
    action.target_agent_id = target.id;
    action.speech = `${target.name},我们停止互问。你给出一个可验证细节,我就交出一个对我不致命的事实。`;
    action.visible_behavior = `${agent.name}把质问压成交换条件,不再允许话题原地转圈。`;
    action.private_intent = `${prefix},把空转质问改成有代价的交换。`.slice(0, 360);
    action.next_intended_action = `如果${target.name}拒绝交换,下一步改为检查现场物件或公开一小块事实。`;
    action.relationship_delta = {
      ...(action.relationship_delta || {}),
      [target.id]: { trust: 0, suspicion: 2, empathy: 0, leverage: 4 }
    };
    action.suspicion_update = { ...(action.suspicion_update || {}), [target.id]: Math.max(5, Number(action.suspicion_update?.[target.id]) || 0) };
    action.known_facts_add = [
      ...(action.known_facts_add || []),
      `我向${target.name}提出了具体交换,不再接受空泛反问。`
    ].slice(0, 3);
  } else {
    action.action_type = "act";
    action.target = "dialogue_loop";
    action.target_agent_id = null;
    action.speech = "这段话已经转回原点。我先把现场能验证的部分列出来。";
    action.visible_behavior = `${agent.name}打断绕圈对话,开始重新整理现场证据和各自的位置。`;
    action.private_intent = `${prefix},先把空转对话改成可核对的现场清单。`.slice(0, 360);
    action.next_intended_action = "下一步从现场清单里挑一个物件或人进行验证。";
    action.known_facts_add = [
      ...(action.known_facts_add || []),
      "当前对话已经绕圈,必须改用可验证事实推进。"
    ].slice(0, 3);
  }

  state.societyLog.push({
    kind: "dialogue_loop_break",
    agentId: agent.id,
    actionType: action.action_type,
    message: `检测到对话绕圈,强制转为 ${action.action_type}`,
    turn: state.world.turn
  });
  return action;
}

function lastLeadAgentId() {
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const entry = state.transcript[i];
    if (entry.type === "agent") return entry.agentId;
  }
  return null;
}

function lastTargetedAgentId() {
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const entry = state.transcript[i];
    if (entry.type === "agent" && entry.targetAgentId) return entry.targetAgentId;
  }
  return null;
}

function chooseActingAgents(forcedIds) {
  if (Array.isArray(forcedIds) && forcedIds.length > 0) {
    const order = [];
    for (const id of forcedIds) {
      const agent = state.agents.find((item) => item.id === id);
      if (agent && !order.includes(agent)) order.push(agent);
    }
    if (order.length > 0) return order;
  }

  const previousLead = lastLeadAgentId();
  const targetedId = lastTargetedAgentId();
  const lastEntry = state.transcript[state.transcript.length - 1];
  const lastWasIntense = Boolean(
    lastEntry &&
    lastEntry.type === "agent" &&
    ["challenge", "reveal"].includes(lastEntry.actionType)
  );
  const eventJustDropped = Boolean(
    lastEntry &&
    lastEntry.type === "director" &&
    !lastEntry.meta?.ambient
  );

  // 上一个说话的人这轮不主动开口（除非被点名质问）
  const ranked = state.agents
    .map((agent) => ({
      agent,
      urgency:
        agent.status.fear * 0.3 +
        agent.status.suspicion * 0.25 +
        agent.status.resolve * 0.15 +
        Math.random() * 8
    }))
    .filter((item) => item.agent.id !== previousLead)
    .sort((a, b) => b.urgency - a.urgency)
    .map((item) => item.agent);

  const order = [];

  // 1) 被点名的人优先回应
  const targeted = targetedId ? state.agents.find((a) => a.id === targetedId && a.id !== previousLead) : null;
  if (targeted) order.push(targeted);

  // 2) 补上一个最需要说话的人（默认只 1 人发言）
  if (order.length === 0) {
    for (const agent of ranked) {
      order.push(agent);
      break;
    }
  }

  // 3) 激烈瞬间（质问/揭秘/刚出事件/压力高）让另一个人插话
  const escalate =
    lastWasIntense ||
    eventJustDropped ||
    state.world.threatLevel > 65 ||
    state.director.pressure > 70;
  if (escalate && order.length < 2) {
    for (const agent of ranked) {
      if (!order.includes(agent)) {
        order.push(agent);
        break;
      }
    }
  }

  // 4) 极端危机：三人都接话
  if (state.world.threatLevel > 82 && order.length < 3) {
    for (const agent of state.agents) {
      if (!order.includes(agent)) order.push(agent);
    }
  }

  // fallback：实在没人选上（只有一人且是 previousLead）
  if (order.length === 0) {
    order.push(state.agents[Math.floor(Math.random() * state.agents.length)]);
  }

  return order;
}

// ============================================================
//   V2 World Simulator
//   核心思想:角色发起 inspect/search/observe/steal/move/hide/lock/escape 等
//   "物理动作"时,这里决定后果——而不是由 Director 直接送线索给角色。
//   这一层把"行为"翻译成"世界状态变化",让 Director 不再写小说。
// ============================================================

const PHYSICAL_ACTION_TYPES = new Set([
  "inspect", "search", "use", "steal", "hide", "move", "lock", "escape", "follow"
]);

// 给某 action 找到一个候选物件:同 location + (label 或 trigger 命中) 优先
function findCandidateItem(agent, target) {
  const t = String(target || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const loc = agent.location || state.world.defaultLocationId;
  const candidates = state.world.items.filter((it) => {
    // 不是这里的、也不在任何人手上的——跳过
    if (it.location && it.location !== loc) {
      // 例外:被另一个 agent 持有,且 holder 跟 actor 在同地点
      if (it.holder && it.holder !== agent.id) {
        const hAgent = state.agents.find((a) => a.id === it.holder);
        if (!hAgent || hAgent.location !== loc) return false;
      } else if (it.holder !== agent.id) {
        return false;
      }
    }
    return true;
  });
  // 1) label / id 直接命中
  const exact = candidates.find((it) =>
    it.id === lower || it.label === t || it.label.includes(t) || t.includes(it.label));
  if (exact) return exact;
  // 2) 触发词命中(任意一个 trigger 出现在 target 文本里)
  const triggered = candidates.find((it) =>
    (it.triggers || []).some((kw) => kw && (t.includes(kw) || lower.includes(String(kw).toLowerCase()))));
  if (triggered) return triggered;
  // 3) holder 名字命中(如 target="Karl 的口袋")
  const holderHit = candidates.find((it) => {
    if (!it.holder) return false;
    const hAgent = state.agents.find((a) => a.id === it.holder);
    return hAgent && (t.includes(hAgent.name) || t.includes(hAgent.id) || lower.includes(hAgent.id));
  });
  return holderHit || null;
}

// 谁在同一个地点——动作的目击者(用于旁观者怀疑+)
function witnessesOf(agent) {
  const loc = agent.location || state.world.defaultLocationId;
  return state.agents.filter((a) => a.id !== agent.id && (a.location || state.world.defaultLocationId) === loc);
}

function isItemHidden(item, agent) {
  // 没被 agent 自己发现过,且 item.hidden=true,且 holder 不是自己
  if (!item.hidden) return false;
  if (item.holder === agent.id) return false;
  if ((item.discoveredBy || []).includes(agent.id)) return false;
  return true;
}

// 把"agent 在自己的认知里发现了这件物件"落到状态里:
//   - 加 fact 到 agent.knownFacts
//   - 在 item.discoveredBy 里记一笔
//   - 公共的 revealedClues 也添加(标注 sourceAgentId,让 UI 知道这是角色自己发现的)
function recordDiscovery(agent, item, fact) {
  if (!item.discoveredBy) item.discoveredBy = [];
  if (!item.discoveredBy.includes(agent.id)) item.discoveredBy.push(agent.id);
  const f = String(fact || `${agent.name}发现了「${item.label}」:${item.contents}`).slice(0, 200);
  if (!agent.knownFacts.includes(f)) {
    agent.knownFacts.push(f);
    agent.knownFacts = agent.knownFacts.slice(-30);
  }
  addRevealedClue({
    id: `${item.id}_by_${agent.id}`,
    label: item.label,
    sourceAgentId: agent.id,
    detail: item.contents,
    turn: state.world.turn
  });
}

// 计算 inspect/search 成功概率: 0..1
function inspectSuccessProb(agent, item) {
  // 基础成功率
  let p = 0.55;
  // resolve 越高越有耐心
  p += (agent.status.resolve - 50) * 0.003;
  // 越疲劳越差
  p -= (agent.status.fatigue - 30) * 0.002;
  // 持有者就在身边搜更难一点
  if (item.holder && item.holder !== agent.id) p -= 0.15;
  // 危险高时手抖,失败概率上升
  p -= (state.world.dangerLevel - 50) * 0.001;
  return Math.max(0.15, Math.min(0.92, p));
}

function rollSuccess(prob) {
  return Math.random() < prob;
}

// =============== 主入口: simulateAction ===============
//   在 applyAction 之前调用。返回 { kind, ok, item?, fromLocation?, toLocation?, witnesses?, failureReason?, factForActor?, publicLine? }
function simulateAction(agent, action) {
  const t = action.action_type;
  const target = String(action.target || "").trim();

  // 默认:不属于物理动作类,跳过模拟
  if (!PHYSICAL_ACTION_TYPES.has(t) && !["observe"].includes(t)) {
    return { kind: "noop" };
  }

  // ---------- observe / inspect / search ----------
  if (t === "observe" || t === "inspect" || t === "search") {
    if (!target) {
      // V2: observe 不指定 target = 环顾四周,这是合法被动行为
      // inspect/search 不指定 target 仍判失败
      if (t === "observe") {
        // 给 actor 浅层环境感知,但不算"发现物品"——记录在 knownFacts 而不是 revealedClues
        const here = (state.world.items || []).filter((it) => it.location === (agent.location || state.world.defaultLocationId) && !it.hidden);
        const labels = here.slice(0, 3).map((it) => it.label).join("、") || "没什么特别的";
        return {
          kind: "observe", ok: true,
          publicLine: `${agent.name}环顾四周。`,
          factForActor: `当前位置看得见:${labels}`
        };
      }
      return { kind: t, ok: false, failureReason: `${agent.name}想${t === "search" ? "搜查" : "检视"}什么,却没瞄准具体对象。` };
    }
    // observe 偏被动,只揭露浅层信息(不命中 hidden item 也算成功)
    // inspect/search 才能真正探到 hidden item
    const item = findCandidateItem(agent, target);
    if (!item) {
      return { kind: t, ok: false, failureReason: `${agent.name}盯着「${target}」,但没看出什么端倪。` };
    }
    // 已经发现过——返回已知信息,不再扣概率
    if ((item.discoveredBy || []).includes(agent.id)) {
      return {
        kind: t, ok: true, item,
        publicLine: `${agent.name}再次确认了「${item.label}」上的细节。`,
        factForActor: `「${item.label}」:${item.contents}`,
        alreadyKnown: true
      };
    }
    // observe 对 hidden item 命中率减半(只有近距离 inspect 才算翻找)
    const baseProb = inspectSuccessProb(agent, item);
    const prob = (t === "observe" && item.hidden) ? baseProb * 0.5 : baseProb;
    if (!rollSuccess(prob)) {
      return {
        kind: t, ok: false, item,
        failureReason: `${agent.name}试图${t === "search" ? "搜查" : "检视"}「${target}」,但没找到值得记的东西。`
      };
    }
    return {
      kind: t, ok: true, item,
      witnesses: witnessesOf(agent),
      publicLine: `${agent.name}注意到「${item.label}」上有古怪。`,
      factForActor: `${item.contents}(在「${item.label}」上)`
    };
  }

  // ---------- steal ----------
  if (t === "use") {
    if (!target) return { kind: "use", ok: false, failureReason: "use 必须指定 target(要使用的具体物件)" };
    const item = findCandidateItem(agent, target);
    if (!item) return { kind: "use", ok: false, failureReason: `${agent.name}没能真正用上「${target}」。` };
    if (item.holder && item.holder !== agent.id && item.hidden && !(item.discoveredBy || []).includes(agent.id)) {
      return { kind: "use", ok: false, item, witnesses: witnessesOf(agent), failureReason: `${agent.name}想动用「${item.label}」,但它还在别人控制下。` };
    }
    const actionLine = String(action.concrete_action || "").trim()
      || `${agent.name}把「${item.label}」拿出来,当成改变局面的筹码。`;
    const stateChange = String(action.intended_state_change || "").trim()
      || `「${item.label}」被${agent.name}用于推进局面。`;
    item.state = stateChange.slice(0, 140);
    item.lastAction = actionLine.slice(0, 220);
    item.lastUsedBy = agent.id;
    item.lastUsedTurn = state.world.turn;
    item.moved = true;
    if (!item.discoveredBy) item.discoveredBy = [];
    if (!item.discoveredBy.includes(agent.id)) item.discoveredBy.push(agent.id);
    return {
      kind: "use", ok: true, item, witnesses: witnessesOf(agent),
      publicLine: actionLine,
      factForActor: stateChange,
      escalateDanger: /公开|发送|拨打|投屏|播放|删除|销毁|锁/.test(`${actionLine} ${stateChange}`) ? 5 : 2
    };
  }

  // ---------- steal ----------
  if (t === "steal") {
    if (!target) return { kind: "steal", ok: false, failureReason: "steal 必须指定 target" };
    const item = findCandidateItem(agent, target);
    if (!item) return { kind: "steal", ok: false, failureReason: `${agent.name}没能摸到「${target}」。` };
    if (item.holder === agent.id) return { kind: "steal", ok: false, failureReason: `「${item.label}」已经在你手上。` };
    const prob = 0.55 - (state.world.dangerLevel - 50) * 0.002 + (agent.status.resolve - 50) * 0.003;
    if (!rollSuccess(Math.max(0.2, Math.min(0.85, prob)))) {
      return { kind: "steal", ok: false, item, witnesses: witnessesOf(agent), failureReason: `${agent.name}伸手去拿「${item.label}」,被人觉察了。` };
    }
    const prevHolderId = item.holder;
    item.holder = agent.id;
    item.location = null;
    item.moved = true;
    return {
      kind: "steal", ok: true, item, witnesses: witnessesOf(agent), prevHolderId,
      publicLine: `${agent.name}把「${item.label}」收进了自己手里。`,
      factForActor: `我现在拿着「${item.label}」(${item.contents})`
    };
  }

  // ---------- hide ----------
  if (t === "hide") {
    if (!target) return { kind: "hide", ok: false, failureReason: "hide 必须指定 target(要藏起来的物品)" };
    const item = findCandidateItem(agent, target);
    if (!item) return { kind: "hide", ok: false, failureReason: `${agent.name}找不到「${target}」可以藏。` };
    if (item.holder && item.holder !== agent.id) {
      return { kind: "hide", ok: false, failureReason: `「${item.label}」不在你手里。` };
    }
    item.holder = agent.id;
    item.location = null;
    item.hidden = true;
    item.moved = true;
    return {
      kind: "hide", ok: true, item, witnesses: witnessesOf(agent),
      publicLine: `${agent.name}悄悄把「${item.label}」收得更隐蔽了。`,
      factForActor: `我把「${item.label}」藏在身上了`
    };
  }

  // ---------- move ----------
  if (t === "move") {
    if (!target) return { kind: "move", ok: false, failureReason: "move 必须指定 target(要去的地点 id 或 label)" };
    const targetLow = target.toLowerCase();
    const loc = state.world.locations.find((l) => l.id === targetLow || l.label === target || l.label.includes(target) || target.includes(l.label));
    if (!loc) return { kind: "move", ok: false, failureReason: `没有「${target}」这个地方。` };
    if (agent.location === loc.id) return { kind: "move", ok: false, failureReason: `${agent.name}已经在「${loc.label}」。` };
    // 检查途中是否有锁住的 exit
    const blocked = state.world.exits.find((e) =>
      e.fromLocation === agent.location && e.toLocation === loc.id && e.locked);
    if (blocked) return { kind: "move", ok: false, failureReason: `通往「${loc.label}」的「${blocked.label}」是锁着的。` };
    const fromLoc = agent.location;
    agent.location = loc.id;
    return {
      kind: "move", ok: true, fromLocation: fromLoc, toLocation: loc.id,
      witnesses: state.agents.filter((a) => a.id !== agent.id && (a.location === fromLoc || a.location === loc.id)),
      publicLine: `${agent.name}从「${stateLocLabel(fromLoc)}」走到了「${loc.label}」。`
    };
  }

  // ---------- lock ----------
  if (t === "lock") {
    if (!target) return { kind: "lock", ok: false, failureReason: "lock 必须指定 target(出口 id 或 label)" };
    const exit = state.world.exits.find((e) => e.id === target.toLowerCase() || e.label === target || e.label.includes(target));
    if (!exit) return { kind: "lock", ok: false, failureReason: `没有「${target}」这个出口。` };
    if (exit.locked) return { kind: "lock", ok: false, failureReason: `「${exit.label}」已经是锁着的。` };
    exit.locked = true;
    return {
      kind: "lock", ok: true, witnesses: witnessesOf(agent),
      publicLine: `${agent.name}把「${exit.label}」锁上了。`
    };
  }

  // ---------- escape ----------
  if (t === "escape") {
    const exits = state.world.exits.filter((e) => e.fromLocation === agent.location && !e.locked);
    if (exits.length === 0) return { kind: "escape", ok: false, failureReason: `${agent.name}找不到可以出去的门。` };
    const exit = exits[0];
    return {
      kind: "escape", ok: true, witnesses: witnessesOf(agent),
      publicLine: `${agent.name}冲向「${exit.label}」想离开!`,
      escalateDanger: 8
    };
  }

  // ---------- follow ----------
  if (t === "follow") {
    if (!target) return { kind: "follow", ok: false, failureReason: "follow 必须指定 target_agent_id" };
    const other = state.agents.find((a) => a.id === target || a.name === target);
    if (!other || other.id === agent.id) return { kind: "follow", ok: false, failureReason: `跟踪对象不存在。` };
    if (other.location === agent.location) return { kind: "follow", ok: false, failureReason: `${other.name}已经在你身边。` };
    const fromLoc = agent.location;
    agent.location = other.location;
    return {
      kind: "follow", ok: true, fromLocation: fromLoc, toLocation: other.location,
      witnesses: [other],
      publicLine: `${agent.name}尾随${other.name}进了「${stateLocLabel(other.location)}」。`
    };
  }

  return { kind: "noop" };
}

function stateLocLabel(locId) {
  const l = state.world.locations.find((x) => x.id === locId);
  return l ? l.label : locId;
}

// ============================================================
//   V2: 旁观者怀疑(witnesses → suspicion update)
//   不依赖角色自己 prompt 更新——而是机械规则:看到了某种动作就+怀疑
// ============================================================
function applyWitnessReactions(agent, action, sim) {
  if (!sim || !sim.ok) return;
  const witnesses = sim.witnesses || [];
  const tbl = {
    inspect:  +6,
    search:   +8,
    use:      +10,
    steal:    +25,
    hide:     +12,
    lock:     +15,
    escape:   +18,
    follow:   +5
  };
  const delta = tbl[sim.kind] || 0;
  if (!delta) return;
  for (const w of witnesses) {
    if (typeof w.suspicions[agent.id] === "number") {
      w.suspicions[agent.id] = clamp(w.suspicions[agent.id] + delta);
    } else {
      w.suspicions[agent.id] = clamp(50 + delta);
    }
    state.director.lastSuspicionDeltaTurn = state.world.turn;
    // 公共记忆:旁观者也把这件事记下来
    w.publicMemories.push(`(${state.world.turn})${agent.name}的${sim.kind}让我警觉了。`);
    w.publicMemories = w.publicMemories.slice(-12);
  }
}

// ============================================================
//   applyAction:把 LLM 输出的 action 落到 state 里
//   V2 改造:先跑物理模拟(simulateAction),再跑情绪/关系/秘密
// ============================================================
function applyAction(agent, action) {
  // ---- V2 物理模拟:决定动作是否真的成功、是否触发发现、谁看到了 ----
  const sim = simulateAction(agent, action);
  if (sim && sim.kind && sim.kind !== "noop") {
    // 把模拟结果挂在 action 上,方便前端 transcript 显示
    action.simulation = {
      kind: sim.kind,
      ok: !!sim.ok,
      itemId: sim.item ? sim.item.id : null,
      itemLabel: sim.item ? sim.item.label : null,
      fromLocation: sim.fromLocation || null,
      toLocation: sim.toLocation || null,
      failureReason: sim.failureReason || null,
      witnessIds: (sim.witnesses || []).map((w) => w.id),
      alreadyKnown: !!sim.alreadyKnown
    };

    // 成功的 inspect/search/observe → 录入 actor.knownFacts + state.world.revealedClues
    if (sim.ok && sim.factForActor && (sim.kind === "observe" || sim.kind === "inspect" || sim.kind === "search")) {
      if (sim.item) {
        recordDiscovery(agent, sim.item, sim.factForActor);
      } else {
        if (!agent.knownFacts.includes(sim.factForActor)) {
          agent.knownFacts.push(sim.factForActor);
          agent.knownFacts = agent.knownFacts.slice(-30);
        }
      }
    }

    // 成功的 steal/hide/move/lock/escape/follow → 只记 actor 私人事实,不公开 reveal
    if (sim.ok && sim.factForActor && ["use", "steal", "hide", "move", "lock", "escape", "follow"].includes(sim.kind)) {
      if (!agent.knownFacts.includes(sim.factForActor)) {
        agent.knownFacts.push(sim.factForActor);
        agent.knownFacts = agent.knownFacts.slice(-30);
      }
    }

    // 让 visible_behavior 反映物理后果(如果 LLM 没自己写)
    if (sim.ok && sim.publicLine && !action.visible_behavior) {
      action.visible_behavior = sim.publicLine;
    } else if (!sim.ok && sim.failureReason && !action.visible_behavior) {
      action.visible_behavior = sim.failureReason;
    }

    // 自动给旁观者加怀疑
    applyWitnessReactions(agent, action, sim);

    // 危险升级
    if (sim.ok && sim.escalateDanger) {
      state.world.dangerLevel = clamp(state.world.dangerLevel + sim.escalateDanger);
    }
  }

  if (action.target_object_id && action.intended_state_change) {
    const item = (state.world.items || []).find((it) => it.id === action.target_object_id);
    if (item && (!action.simulation || !action.simulation.itemId)) {
      item.state = String(action.intended_state_change).slice(0, 140);
      item.lastAction = String(action.concrete_action || action.visible_behavior || action.speech || "").slice(0, 220);
      item.lastUsedBy = agent.id;
      item.lastUsedTurn = state.world.turn;
      item.moved = true;
    }
  }

  // ---- 情绪状态变化 ----
  const statusKeys = ["fear", "suspicion", "guilt", "resolve", "fatigue"];
  for (const key of statusKeys) {
    if (typeof action.emotion_delta?.[key] === "number") {
      agent.status[key] = clamp(agent.status[key] + action.emotion_delta[key]);
    }
  }

  for (const [targetId, delta] of Object.entries(action.relationship_delta || {})) {
    if (!agent.relationships[targetId]) continue;
    for (const key of ["trust", "suspicion", "empathy", "leverage"]) {
      if (typeof delta?.[key] === "number") {
        agent.relationships[targetId][key] = clamp(agent.relationships[targetId][key] + delta[key]);
      }
    }
  }

  // suspicion_update: 独立于情绪 suspicion 的"对某人是危险/可疑的"独立分数
  let suspicionShifted = false;
  for (const [targetId, deltaRaw] of Object.entries(action.suspicion_update || {})) {
    if (targetId === agent.id) continue;
    if (!state.agents.some((a) => a.id === targetId)) continue;
    const delta = Number(deltaRaw);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const prev = typeof agent.suspicions[targetId] === "number" ? agent.suspicions[targetId] : 50;
    const next = clamp(prev + Math.max(-30, Math.min(30, delta)));
    agent.suspicions[targetId] = next;
    if (Math.abs(next - prev) >= 5) suspicionShifted = true;
  }
  if (suspicionShifted) state.director.lastSuspicionDeltaTurn = state.world.turn;

  // known_facts_add: agent 这一轮"判断"获得的私人事实
  if (Array.isArray(action.known_facts_add)) {
    for (const fact of action.known_facts_add) {
      const trimmed = String(fact).trim().slice(0, 160);
      if (trimmed && !agent.knownFacts.includes(trimmed)) {
        agent.knownFacts.push(trimmed);
      }
    }
    agent.knownFacts = agent.knownFacts.slice(-30);
  }

  if (action.next_intended_action) {
    agent.nextIntendedAction = action.next_intended_action;
  }

  // act 类动作 → 也作为一条 currentAction 更新
  if (["act", "use", "move", "negotiate", "threaten", "ally", "betray"].includes(action.action_type)) {
    if (action.visible_behavior) agent.currentAction = action.visible_behavior.slice(0, 140);
    else if (action.speech) agent.currentAction = action.speech.slice(0, 140);
  }

  if (action.memory_write) {
    agent.privateMemories.push(action.memory_write);
    agent.privateMemories = agent.privateMemories.slice(-16);
  }

  if (action.speech || action.visible_behavior) {
    agent.lastActions.push({ actionType: action.action_type, speech: action.speech, turn: state.world.turn });
    agent.lastActions = agent.lastActions.slice(-8);
  }

  const explicitlyExposedSecret = agent.secrets.find((item) => item.id === action.expose_secret_id);
  if (explicitlyExposedSecret && !explicitlyExposedSecret.revealed) {
    explicitlyExposedSecret.exposure = 100;
    explicitlyExposedSecret.revealed = true;
    pushDirectorEntry("秘密暴露", `${agent.name} 的秘密浮出水面：${explicitlyExposedSecret.content}`, { agentId: agent.id, secretId: explicitlyExposedSecret.id });
    addRevealedClue({
      id: `secret_${agent.id}_${explicitlyExposedSecret.id}`,
      label: explicitlyExposedSecret.label,
      sourceAgentId: agent.id,
      detail: explicitlyExposedSecret.content,
      turn: state.world.turn
    });
    for (const other of state.agents) {
      if (other.id === agent.id) continue;
      if (other.relationships[agent.id]) {
        other.relationships[agent.id].suspicion = clamp(other.relationships[agent.id].suspicion + 12);
        other.relationships[agent.id].leverage = clamp(other.relationships[agent.id].leverage + 9);
      }
      if (typeof other.suspicions[agent.id] === "number") {
        other.suspicions[agent.id] = clamp(other.suspicions[agent.id] + 15);
      }
    }
  }

  // V2: 沉默封顶——根据这一轮 action_type 与 speech 状态更新 streak
  const isPassive = (action.action_type === "silence" || action.action_type === "observe") && !action.speech;
  if (isPassive) {
    agent.consecutiveSilenceTurns = (agent.consecutiveSilenceTurns || 0) + 1;
  } else {
    agent.consecutiveSilenceTurns = 0;
  }

  applyTriggerExposure(agent, action);
}

function addRevealedClue(clue) {
  if (!clue || !clue.id) return;
  if (state.world.revealedClues.some((c) => c.id === clue.id)) return;
  state.world.revealedClues.push({
    id: clue.id,
    label: clue.label || clue.id,
    sourceAgentId: clue.sourceAgentId || null,
    detail: clue.detail || "",
    turn: typeof clue.turn === "number" ? clue.turn : state.world.turn
  });
  state.world.revealedClues = state.world.revealedClues.slice(-20);
  state.director.lastClueRevealTurn = state.world.turn;
}

function matchTriggers(text, triggers) {
  if (!text || !Array.isArray(triggers) || triggers.length === 0) return 0;
  let hits = 0;
  for (const word of triggers) {
    if (typeof word === "string" && word.length > 0 && text.includes(word)) hits += 1;
  }
  return hits;
}

function applyTriggerExposure(speaker, action) {
  const speech = String(action.speech || "");
  const behavior = String(action.visible_behavior || "");
  const intent = String(action.private_intent || "");
  const targetId = action.target_agent_id || null;

  for (const subject of state.agents) {
    for (const secret of subject.secrets) {
      if (secret.revealed) continue;
      const isOwner = subject.id === speaker.id;
      const speechHits = matchTriggers(speech, secret.triggers);
      const behaviorHits = matchTriggers(behavior, secret.triggers);
      const intentHits = matchTriggers(intent, secret.triggers);
      let delta = 0;
      if (isOwner) {
        delta += speechHits * 8;
        delta += behaviorHits * 4;
        delta += intentHits * 5;
        if (action.action_type === "conceal" && (speechHits + behaviorHits + intentHits) > 0) delta += 4;
      } else {
        if (targetId === subject.id) {
          delta += speechHits * 6;
          delta += behaviorHits * 3;
        } else {
          delta += speechHits * 3;
          delta += behaviorHits * 1;
        }
      }
      if (delta > 0) {
        secret.exposure = clamp(secret.exposure + delta);
        if (secret.exposure >= 80) {
          secret.revealed = true;
          pushDirectorEntry("秘密浮现", `${subject.name} 的「${secret.label}」被环境和话语推到台面：${secret.content}`, { agentId: subject.id, secretId: secret.id });
          for (const other of state.agents) {
            if (other.id === subject.id) continue;
            if (other.relationships[subject.id]) {
              other.relationships[subject.id].suspicion = clamp(other.relationships[subject.id].suspicion + 10);
              other.relationships[subject.id].leverage = clamp(other.relationships[subject.id].leverage + 8);
            }
          }
        }
      }
    }
  }

  if (action.scene_effect) {
    state.world.facts.push(action.scene_effect);
    state.world.facts = state.world.facts.slice(-10);
  }
}

function decayWorld() {
  state.world.minutes += 4 + Math.floor(Math.random() * 5);
  state.world.resources.lampOil = clamp(state.world.resources.lampOil - 2);
  state.world.resources.fire = clamp(state.world.resources.fire - 3);
  if (state.world.resources.fire < 18) state.world.temperature = "刺骨";
  else if (state.world.resources.fire < 40) state.world.temperature = "寒冷";
  if (state.world.resources.lampOil < 18) state.world.light = "灯光将灭";
  else if (state.world.resources.lampOil < 30) state.world.light = "灯光昏黄";
  if (state.world.turn > 4) state.world.weather = "雨势忽强忽弱";
  if (state.world.turn > 8) state.world.weather = "暴雨夹着风声";
  // 随时间推进，所有人都会更累
  for (const agent of state.agents) {
    agent.status.fatigue = clamp(agent.status.fatigue + 1);
  }
}

function buildFallbackRecoveryAction(agent, reason) {
  const myLocId = agent.location || state.world.defaultLocationId;
  const othersHere = state.agents.filter((a) => a.id !== agent.id && (a.location || state.world.defaultLocationId) === myLocId);
  const mostSuspect = othersHere
    .slice()
    .sort((a, b) => (agent.suspicions[b.id] || 50) - (agent.suspicions[a.id] || 50))[0];

  if (mostSuspect) {
    return normalizeAction({
      action_type: "challenge",
      target: mostSuspect.id,
      speech: `${mostSuspect.name},先别绕开。把你今晚来这里的真实理由说清楚。`,
      visible_behavior: `${agent.name}从等待里抬头,把话题压到${mostSuspect.name}身上。`,
      private_intent: reason ? `（系统：${reason}，用低成本质问维持推进）` : "",
      target_agent_id: mostSuspect.id,
      emotion_delta: { suspicion: 2, resolve: 1 },
      relationship_delta: { [mostSuspect.id]: { trust: -2, suspicion: 3, empathy: 0, leverage: 1 } },
      suspicion_update: { [mostSuspect.id]: 4 },
      known_facts_add: [],
      next_intended_action: "继续逼问最可疑的人,避免场面停住。",
      memory_write: "模型调用失败时,用质问维持现场推进。",
      expose_secret_id: "",
      scene_effect: ""
    });
  }

  return normalizeAction({
    action_type: "act",
    target: "",
    speech: "不能再等了。先把现场里最不合理的地方重新摆出来。",
    visible_behavior: `${agent.name}收住等待,开始重新梳理现场。`,
    private_intent: reason ? `（系统：${reason}，用低成本行动维持推进）` : "",
    target_agent_id: null,
    emotion_delta: { resolve: 1, fatigue: 1 },
    relationship_delta: {},
    suspicion_update: {},
    known_facts_add: [],
    next_intended_action: "用一个具体问题重新打开局面。",
    memory_write: "模型调用失败时,用行动维持现场推进。",
    expose_secret_id: "",
    scene_effect: ""
  });
}

function findCueNamedAgentIds(userCue) {
  if (!userCue) return [];
  const cueLower = String(userCue).toLowerCase();
  return state.agents.filter((agent) => {
    if (cueLower.includes(agent.id.toLowerCase())) return true;
    if (agent.name && userCue.includes(agent.name)) return true;
    const firstToken = String(agent.name || "").split(/[\s·]/)[0];
    if (firstToken && firstToken.length >= 2 && userCue.includes(firstToken)) return true;
    return false;
  }).map((agent) => agent.id);
}

function cueSnippet(userCue) {
  const text = String(userCue || "").replace(/\s+/g, " ").trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function isPassiveCueAction(action) {
  const text = `${action.speech || ""} ${action.visible_behavior || ""}`;
  return (
    action.action_type === "silence" ||
    action.action_type === "observe" ||
    action.action_type === "speak" ||
    !String(action.speech || "").trim() ||
    /沉默|没有再开口|没有说话|没有反应|观望|听着|盯着.*没有/.test(text)
  );
}

function minimalCueFallbackAction(agent, userCue, reason) {
  const cue = cueSnippet(userCue);
  return normalizeAction({
    action_type: "act",
    target: "active_event",
    speech: `${cue} 我不能再装作没听见。`,
    visible_behavior: `${agent.name}立刻停下原来的动作,转向事件传来的方向。`,
    private_intent: reason ? `服务器最小兜底:${reason}` : "服务器最小兜底:避免沉默",
    target_agent_id: null,
    emotion_delta: { fear: 3, suspicion: 2, resolve: 2 },
    relationship_delta: {},
    suspicion_update: {},
    memory_write: "导演干预后,我主动响应了现场变化。"
  });
}

function fallbackCueAction(agent, userCue) {
  const cue = cueSnippet(userCue);
  const myLocId = agent.location || state.world.defaultLocationId;
  const itemsAll = state.world.items || [];
  const heldByMe = itemsAll.find((item) => item.holder === agent.id && item.hidden) || itemsAll.find((item) => item.holder === agent.id);
  const coLocated = state.agents.filter((other) => other.id !== agent.id && (other.location || state.world.defaultLocationId) === myLocId);
  const mostSuspect = coLocated.slice().sort((a, b) => (agent.suspicions[b.id] || 50) - (agent.suspicions[a.id] || 50))[0];
  const lockableDoor = (state.world.exits || []).find((exit) =>
    exit.fromLocation === myLocId && !exit.locked && /门|door|exit|月台|正门/.test(`${exit.id} ${exit.label}`)
  );
  const stove = itemsAll.find((item) => item.id === "stove" || item.label.includes("火炉"));
  const isHideInstruction = /藏|藏好|掩盖|收起|口袋|包/.test(userCue);
  const isFootsteps = /脚步|门外|敲门|巡逻|搜查|门口|开门/.test(userCue);
  const isPatrolApproach = isFootsteps || /车灯|窗玻璃|窗户|手电|狗叫|越来越近|逼近|靠近|扫过/.test(userCue);
  const isGunshot = /枪|枪响|枪声|爆炸|炮|闷响|响声/.test(userCue);
  const isFire = /火炉|炉|炭|煤|火|熄|冷|寒/.test(userCue);
  const approachReason = /车灯|窗玻璃|窗户|手电|扫过/.test(userCue)
    ? "这束光已经扫到窗上了"
    : "这声音太近了";

  if ((isHideInstruction || (isPatrolApproach && ["karl", "anna"].includes(agent.id))) && heldByMe) {
    return normalizeAction({
      action_type: "hide",
      target: heldByMe.label,
      speech: `${cue} ${approachReason},我先把${heldByMe.label}收好。`,
      visible_behavior: `${agent.name}立刻把${heldByMe.label}贴身收起,避开其他人的视线。`,
      private_intent: `导演干预触发:先处理${heldByMe.label}`,
      target_agent_id: null,
      emotion_delta: { fear: 4, suspicion: 3, resolve: 2 },
      relationship_delta: {},
      suspicion_update: {},
      memory_write: `导演干预后,我把${heldByMe.label}收好。`
    });
  }

  if (isPatrolApproach && agent.id === "richard" && lockableDoor) {
    return normalizeAction({
      action_type: "lock",
      target: lockableDoor.label,
      speech: `${cue} 都离窗远一点,我先把${lockableDoor.label}扣上。`,
      visible_behavior: `${agent.name}压低身体走到${lockableDoor.label}边,把门闩压下后回头示意两人别出声。`,
      private_intent: "导演干预触发:先控制入口",
      target_agent_id: null,
      emotion_delta: { fear: 3, suspicion: 3, resolve: 4 },
      relationship_delta: {},
      suspicion_update: {},
      memory_write: `导演干预后,我锁上了${lockableDoor.label}。`
    });
  }

  if (isFire && stove && agent.id === "karl") {
    return normalizeAction({
      action_type: "inspect",
      target: stove.label,
      speech: `${cue} 火灭得太快了,我先看炉膛里还剩什么。`,
      visible_behavior: `${agent.name}蹲到火炉前,用火钳拨开塌下去的炭灰。`,
      private_intent: "导演干预触发:用理性检查环境变量",
      target_agent_id: null,
      emotion_delta: { fear: 3, suspicion: 2, resolve: 4 },
      relationship_delta: {},
      suspicion_update: {},
      memory_write: "导演干预后,我检查了火炉。"
    });
  }

  if (isFire && agent.id === "anna" && heldByMe) {
    return normalizeAction({
      action_type: "hide",
      target: heldByMe.label,
      speech: `${cue} 灯一暗就会有人乱翻东西,我的${heldByMe.label}不能离手。`,
      visible_behavior: `${agent.name}把${heldByMe.label}压到膝下,身体侧过去挡住它。`,
      private_intent: "导演干预触发:火光变弱时先护住密码本",
      target_agent_id: null,
      emotion_delta: { fear: 4, suspicion: 3, resolve: 3 },
      relationship_delta: {},
      suspicion_update: {},
      memory_write: `导演干预后,我护住了${heldByMe.label}。`
    });
  }

  if (isFire && agent.id === "richard") {
    return normalizeAction({
      action_type: "negotiate",
      target: mostSuspect ? mostSuspect.id : null,
      target_agent_id: mostSuspect ? mostSuspect.id : null,
      speech: `${cue} 我们需要光和热。谁还有能烧的东西,现在摆到桌上。`,
      visible_behavior: `${agent.name}把椅子挪到火炉旁,用命令式的目光扫过两人。`,
      private_intent: "导演干预触发:用秩序控制恐慌",
      emotion_delta: { fear: 3, suspicion: 3, resolve: 4 },
      relationship_delta: mostSuspect ? { [mostSuspect.id]: { trust: -1, suspicion: 4, empathy: 0, leverage: 2 } } : {},
      suspicion_update: mostSuspect ? { [mostSuspect.id]: 5 } : {},
      memory_write: "导演干预后,我要求所有人交出可用资源。",
      scene_effect: "火炉将灭,房间里的光和热变成新的争夺点。"
    });
  }

  if (isGunshot && agent.id === "anna" && heldByMe) {
    return normalizeAction({
      action_type: "hide",
      target: heldByMe.label,
      speech: `${cue} 如果外面开始搜捕,我的${heldByMe.label}绝不能被看见。`,
      visible_behavior: `${agent.name}猛地把${heldByMe.label}抱紧,退到椅背阴影里。`,
      private_intent: "导演干预触发:枪声意味着搜捕可能逼近",
      target_agent_id: null,
      emotion_delta: { fear: 5, suspicion: 3, resolve: 3 },
      relationship_delta: {},
      suspicion_update: {},
      memory_write: `导演干预后,我把${heldByMe.label}藏得更紧。`
    });
  }

  if (isGunshot && agent.id === "richard" && lockableDoor) {
    return normalizeAction({
      action_type: "lock",
      target: lockableDoor.label,
      speech: `${cue} 所有人离窗远一点,我先封住${lockableDoor.label}。`,
      visible_behavior: `${agent.name}压低身体冲到${lockableDoor.label},试图先控制出口。`,
      private_intent: "导演干预触发:枪响后先控制出入口",
      target_agent_id: null,
      emotion_delta: { fear: 4, suspicion: 3, resolve: 4 },
      relationship_delta: {},
      suspicion_update: {},
      memory_write: `导演干预后,我试图锁住${lockableDoor.label}。`
    });
  }

  if (isGunshot && mostSuspect) {
    return normalizeAction({
      action_type: "challenge",
      target: mostSuspect.id,
      target_agent_id: mostSuspect.id,
      speech: `${cue} ${mostSuspect.name},你是不是早知道外面会出事?`,
      visible_behavior: `${agent.name}猛地转向${mostSuspect.name},手停在外套口袋边。`,
      private_intent: "导演干预触发:枪响后先逼问最可疑的人",
      emotion_delta: { fear: 4, suspicion: 5, resolve: 2 },
      relationship_delta: { [mostSuspect.id]: { trust: -3, suspicion: 8, empathy: 0, leverage: 2 } },
      suspicion_update: { [mostSuspect.id]: 10 },
      memory_write: `导演干预后,我质问了${mostSuspect.name}。`
    });
  }

  if (mostSuspect) {
    const challengeLineByAgent = {
      karl: `${cue} 这个时间点太精确了。${mostSuspect.name},你刚才是否听见过同样的车声?`,
      anna: `${cue} ${mostSuspect.name},别用礼貌遮过去——你在怕外面的人,还是在等他们?`,
      richard: `${cue} ${mostSuspect.name},现在按我的问题回答:你身上有没有会让巡逻队停下来的东西?`
    };
    const behaviorByAgent = {
      karl: `${agent.name}把报纸边缘压平,目光没有离开${mostSuspect.name}的手。`,
      anna: `${agent.name}侧身护住手提包,用很低的声音逼问${mostSuspect.name}。`,
      richard: `${agent.name}站到门与众人之间,用审讯般的语气压住${mostSuspect.name}。`
    };
    return normalizeAction({
      action_type: "challenge",
      target: mostSuspect.id,
      target_agent_id: mostSuspect.id,
      speech: challengeLineByAgent[agent.id] || `${cue} ${mostSuspect.name},这件事和你有没有关系?`,
      visible_behavior: behaviorByAgent[agent.id] || `${agent.name}转向${mostSuspect.name},把问题直接压过去。`,
      private_intent: "导演干预触发:用质问打破沉默",
      emotion_delta: { fear: 3, suspicion: 5, resolve: 2 },
      relationship_delta: { [mostSuspect.id]: { trust: -2, suspicion: 7, empathy: 0, leverage: 2 } },
      suspicion_update: { [mostSuspect.id]: 10 },
      memory_write: `导演干预后,我质问了${mostSuspect.name}。`
    });
  }

  return normalizeAction({
    action_type: "act",
    target: "active_event",
    speech: `${cue} 我不能再等了,现在必须做点什么。`,
    visible_behavior: `${agent.name}猛地起身,扫视门口和屋内每个人的位置。`,
    private_intent: "导演干预触发:兜底行动",
    emotion_delta: { fear: 3, suspicion: 3, resolve: 3 },
    relationship_delta: {},
    suspicion_update: {},
    memory_write: "导演干预后,我主动打破沉默。"
  });
}

function enforceCueAction(agent, action, userCue) {
  if (!userCue) return action;
  if (isPassiveCueAction(action)) {
    state.societyLog.push({
      kind: "cue_minimal_fallback",
      agentId: agent.id,
      message: `userCue 二次修复后仍被动,使用最小非剧情兜底 ${action.action_type}`,
      turn: state.world.turn
    });
    return minimalCueFallbackAction(agent, userCue, action.action_type);
  }
  const cue = cueSnippet(userCue);
  if (!String(action.speech || "").includes(cue.slice(0, Math.min(8, cue.length)))) {
    action.speech = `${cue} ${action.speech || "我必须立刻回应这个变化。"}`.slice(0, 420);
  }
  if (!action.visible_behavior || /沉默|没有再开口|没有说话|没有反应|观望|听着/.test(action.visible_behavior)) {
    action.visible_behavior = `${agent.name}立刻响应导演干预,把注意力转向当前危机。`;
  }
  action.emotion_delta = action.emotion_delta && typeof action.emotion_delta === "object" ? action.emotion_delta : {};
  const strongest = Math.max(0, ...Object.values(action.emotion_delta).map((value) => Math.abs(Number(value) || 0)));
  if (strongest < 3) action.emotion_delta.fear = 3;
  return action;
}

function agentDisplayName(id) {
  return state.agents.find((agent) => agent.id === id)?.name || id;
}

function captureNarrativeState() {
  return {
    dangerLevel: state.world.dangerLevel,
    threatLevel: state.world.threatLevel,
    plotStage: state.world.plotStage,
    revealedClueIds: new Set((state.world.revealedClues || []).map((clue) => clue.id)),
    firedDeadlineIds: new Set((state.world.deadlines || []).filter((d) => d.fired).map((d) => d.id)),
    locations: Object.fromEntries(state.agents.map((agent) => [agent.id, agent.location || state.world.defaultLocationId])),
    status: Object.fromEntries(state.agents.map((agent) => [agent.id, { ...(agent.status || {}) }])),
    suspicions: Object.fromEntries(state.agents.map((agent) => [agent.id, { ...(agent.suspicions || {}) }])),
    nextActions: Object.fromEntries(state.agents.map((agent) => [agent.id, agent.nextIntendedAction || ""])),
    itemStates: Object.fromEntries((state.world.items || []).map((item) => [
      item.id,
      {
        label: item.label || item.id,
        holder: item.holder || "",
        location: item.location || "",
        state: item.state || "",
        lastAction: item.lastAction || "",
        discoveredBy: Array.isArray(item.discoveredBy) ? [...item.discoveredBy] : []
      }
    ]))
  };
}

function buildTurnOutcomeLines(before, changes) {
  const lines = [];
  const maxLines = 6;
  const add = (line) => {
    const text = String(line || "").trim();
    if (!text || lines.includes(text) || lines.length >= maxLines) return;
    lines.push(text);
  };
  const stageLabel = { setup: "布局", suspicion: "猜忌", confrontation: "正面冲突", revelation: "揭露", resolution: "收场" };
  const statusLabel = { fear: "恐惧", suspicion: "戒备", guilt: "愧疚", resolve: "决心", fatigue: "疲惫" };

  if (state.world.plotStage !== before.plotStage) {
    add(`剧情阶段进入「${stageLabel[state.world.plotStage] || state.world.plotStage}」。`);
  }

  for (const deadline of state.world.deadlines || []) {
    if (deadline.fired && !before.firedDeadlineIds.has(deadline.id)) {
      add(`截止点触发：「${deadline.label}」。`);
    }
  }

  const newClues = (state.world.revealedClues || []).filter((clue) => !before.revealedClueIds.has(clue.id));
  const newClueLabels = new Set(newClues.map((clue) => clue.label));
  for (const clue of newClues.slice(0, 2)) {
    const who = clue.sourceAgentId ? agentDisplayName(clue.sourceAgentId) : "现场";
    add(`${who} 发现了「${clue.label}」，这条线索进入剧情台面。`);
  }

  for (const agent of state.agents) {
    const prevLoc = before.locations[agent.id];
    const nextLoc = agent.location || state.world.defaultLocationId;
    if (prevLoc && nextLoc && prevLoc !== nextLoc) {
      add(`${agent.name} 从「${stateLocLabel(prevLoc)}」移动到「${stateLocLabel(nextLoc)}」。`);
    }
  }

  for (const item of state.world.items || []) {
    const prev = before.itemStates[item.id];
    if (!prev) continue;
    const holder = item.holder || "";
    const location = item.location || "";
    if (holder !== prev.holder) {
      const from = prev.holder ? agentDisplayName(prev.holder) : (prev.location ? stateLocLabel(prev.location) : "原处");
      const to = holder ? agentDisplayName(holder) : (location ? stateLocLabel(location) : "未知位置");
      add(`「${item.label}」从${from}转到${to}手里。`);
    } else if (location !== prev.location && !holder) {
      add(`「${item.label}」的位置变为「${stateLocLabel(location)}」。`);
    }
    if ((item.state || "") !== (prev.state || "") && item.state) {
      add(`「${item.label}」状态变为：${item.state}`);
    }
    const prevDiscovered = new Set(prev.discoveredBy || []);
    const newlyDiscovered = (item.discoveredBy || []).filter((id) => !prevDiscovered.has(id));
    if (newlyDiscovered.length && !newClueLabels.has(item.label)) {
      add(`${newlyDiscovered.map(agentDisplayName).join("、")} 注意到「${item.label}」的新细节。`);
    }
  }

  for (const agent of state.agents) {
    const prev = before.nextActions[agent.id] || "";
    const next = agent.nextIntendedAction || "";
    if (next && next !== prev) {
      add(`任务状态：${agent.name} 下一步改为「${next}」。`);
    }
  }

  const suspicionDeltas = [];
  for (const agent of state.agents) {
    const prevMap = before.suspicions[agent.id] || {};
    for (const [targetId, value] of Object.entries(agent.suspicions || {})) {
      const prev = typeof prevMap[targetId] === "number" ? prevMap[targetId] : 50;
      const delta = Number(value) - prev;
      if (Math.abs(delta) >= 5) {
        suspicionDeltas.push({ agent, targetId, prev, value: Number(value), delta });
      }
    }
  }
  suspicionDeltas
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2)
    .forEach((item) => add(`${item.agent.name} 对 ${agentDisplayName(item.targetId)} 的怀疑 ${item.prev} → ${item.value}。`));

  const statusDeltas = [];
  for (const agent of state.agents) {
    const prevStatus = before.status[agent.id] || {};
    for (const key of ["fear", "suspicion", "guilt", "resolve", "fatigue"]) {
      const prev = Number(prevStatus[key]);
      const next = Number(agent.status?.[key]);
      if (Number.isFinite(prev) && Number.isFinite(next) && Math.abs(next - prev) >= 8) {
        statusDeltas.push({ agent, key, prev, next, delta: next - prev });
      }
    }
  }
  statusDeltas
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2)
    .forEach((item) => add(`${item.agent.name} 的${statusLabel[item.key] || item.key} ${item.prev} → ${item.next}。`));

  if (Math.abs(state.world.dangerLevel - before.dangerLevel) >= 5) {
    add(`危险等级 ${before.dangerLevel} → ${state.world.dangerLevel}。`);
  }
  if (Math.abs(state.world.threatLevel - before.threatLevel) >= 5) {
    add(`威胁等级 ${before.threatLevel} → ${state.world.threatLevel}。`);
  }

  return lines.filter(Boolean);
}

function actionTypeLabel(type) {
  return {
    speak: "发言", observe: "观察", act: "行动", challenge: "质问", lie: "撒谎", conceal: "掩盖",
    reveal: "揭露", negotiate: "谈判", threaten: "威胁", ally: "结盟", betray: "背叛",
    cooperate: "合作", move: "移动", silence: "沉默", inspect: "检视", search: "搜查",
    use: "使用", steal: "夺取", hide: "藏匿", lock: "上锁", escape: "逃离", follow: "跟随"
  }[type] || type;
}

function buildActionOutcomeLines(actions) {
  const lines = [];
  for (const { agentId, action } of actions.slice(0, 4)) {
    const agent = state.agents.find((item) => item.id === agentId);
    if (!agent || !action) continue;
    const label = actionTypeLabel(action.action_type);
    const target = action.target ? `「${action.target}」` : "";
    const sim = action.simulation;
    let result = "";
    if (sim && sim.kind && sim.kind !== "noop") {
      if (sim.ok) {
        if (sim.itemLabel) result = `动作成功,「${sim.itemLabel}」成为新的注意焦点。`;
        else if (sim.fromLocation && sim.toLocation) result = `位置从「${stateLocLabel(sim.fromLocation)}」变到「${stateLocLabel(sim.toLocation)}」。`;
        else result = "动作成功,现场状态被改写。";
      } else {
        result = sim.failureReason || "动作没有成功落地。";
      }
    } else if (action.speech) {
      result = `这句话把压力推向了${action.target_agent_id ? agentDisplayName(action.target_agent_id) : "现场其他人"}。`;
    }
    lines.push(`${agent.name} 选择${label}${target ? ` ${target}` : ""}。${result}`);
  }
  return lines.filter(Boolean);
}

function buildMeaningLines(changes, before) {
  const lines = [];
  const add = (line) => {
    if (line && !lines.includes(line) && lines.length < 4) lines.push(line);
  };
  if (changes.includes("clue_revealed")) add("新线索不只是信息增加,它会改变角色可用的交换、威胁和试探筹码。");
  if (changes.includes("item_state")) add("物件控制权变化意味着某些角色能推进自己的任务,另一些角色会失去遮掩空间。");
  if (changes.includes("location")) add("位置变化会改变谁能看见谁、谁能接触物件,也会改变下一轮可行动作。");
  if (changes.includes("suspicion")) add("怀疑上升会让下一轮更容易出现质问、搜查、结盟或背叛。");
  if (changes.includes("known_facts")) add("私人事实进入角色记忆后,会影响他们之后的判断,即使他们还没有公开说出来。");
  if (changes.includes("deadline_fired")) add("截止点触发后,角色不再只是试探,必须在有限时间内做选择。");
  if (changes.includes("danger_shift")) add(`危险等级从 ${before.dangerLevel} 变到 ${state.world.dangerLevel},外部压力开始逼迫角色少说多做。`);
  if (changes.includes("plot_stage_advanced")) add("剧情阶段推进后,导演会更倾向制造摊牌、揭露或不可逆选择。");
  if (!lines.length) add("本轮主要积累了态度和位置上的微妙压力,还没有形成明显的外部转折。");
  return lines;
}

function buildNextPressureLines() {
  const lines = [];
  const upcoming = (state.world.deadlines || []).filter((d) => !d.fired)[0];
  if (upcoming) {
    lines.push(`最近的时间压力是「${upcoming.label}」(${minutesToClock(upcoming.atMinutes)}),角色会围绕它压缩选择。`);
  }
  const suspicionPairs = [];
  for (const agent of state.agents) {
    for (const [targetId, value] of Object.entries(agent.suspicions || {})) {
      if (value >= 65) suspicionPairs.push({ from: agent.name, to: agentDisplayName(targetId), value });
    }
  }
  suspicionPairs.sort((a, b) => b.value - a.value);
  if (suspicionPairs[0]) {
    lines.push(`最紧张的关系是 ${suspicionPairs[0].from} → ${suspicionPairs[0].to} 的怀疑 ${suspicionPairs[0].value},下一轮很可能被它带偏。`);
  }
  const focus = (state.world.emergentFocus || [])[0];
  if (focus) lines.push(`当前剧情焦点落在「${focus}」。`);
  if (!lines.length) lines.push("下一轮的主要压力仍来自角色目标之间的冲突。");
  return lines.slice(0, 3);
}

function flattenSummaryGroups(groups) {
  return groups.flatMap((group) => (group.lines || []).map((line) => `${group.title}: ${line}`));
}

function buildTurnOutcomeSummary(before, changes, actions, beatResult = null) {
  const groups = [];
  if (beatResult) {
    groups.push({
      title: "戏剧Beat",
      lines: [
        `${beatResult.actLabel} / ${beatResult.title}：${beatResult.status === "fulfilled" ? "完成" : "未充分完成"}`,
        beatResult.resolution || beatResult.requiredChange
      ].filter(Boolean)
    });
  }
  const actionLines = buildActionOutcomeLines(actions);
  if (actionLines.length) groups.push({ title: "本轮发生", lines: actionLines });
  const changeLines = buildTurnOutcomeLines(before, changes);
  if (changeLines.length) groups.push({ title: "状态改变", lines: changeLines });
  groups.push({ title: "局势含义", lines: buildMeaningLines(changes, before) });
  groups.push({ title: "下一轮压力", lines: buildNextPressureLines() });
  return { groups, lines: flattenSummaryGroups(groups) };
}

function actionExplainsGoal(agent, action) {
  const goal = String(agent.shortTermGoal || "").trim();
  const hay = `${action.private_intent || ""} ${action.next_intended_action || ""} ${action.prethink?.current_assessment || ""}`;
  if (!goal) return true;
  return hay.includes("本场目标") || hay.includes(goal.slice(0, Math.min(goal.length, 12)));
}

function turnSystemForces() {
  const forceKinds = new Set([
    "goal_alignment_force",
    "silence_cap_force",
    "speech_echo_rewrite",
    "anti_repetition_redirect",
    "speech_autofill",
    "cue_minimal_fallback",
    "dialogue_loop_break",
    "concrete_tactic_force",
    "drama_beat_force"
  ]);
  return (state.societyLog || []).filter((item) => item.turn === state.world.turn && forceKinds.has(item.kind));
}

function auditTurnQuality(before, changes, actions) {
  const issues = [];
  const suggestions = [];
  const add = (id, severity, text, suggestion) => {
    if (issues.some((item) => item.id === id)) return;
    issues.push({ id, severity, text });
    if (suggestion && !suggestions.includes(suggestion)) suggestions.push(suggestion);
  };

  if (!changes.length) {
    add(
      "no_state_change",
      20,
      "本轮没有产生可观测状态变化。",
      "下一轮必须让至少一个角色执行 inspect/search/use/challenge/negotiate/reveal/move 等会改变状态的动作。"
    );
  }
  const beat = state.director.currentBeat;
  if (beat && beat.turn === state.world.turn && beat.status === "missed") {
    add(
      "drama_beat_missed",
      16,
      `本轮戏剧Beat未充分完成：${beat.title}`,
      "下一轮必须优先完成 Beat Director 的 requiredChange,让至少一个动作围绕焦点物件或关系产生不可逆变化。"
    );
  }

  const actorActions = actions.map(({ agentId, action }) => ({
    agent: state.agents.find((item) => item.id === agentId),
    action
  })).filter((item) => item.agent);

  const loopReport = recentDialogueLoopReport();
  if (loopReport.looping) {
    add(
      "dialogue_loop",
      18,
      "最近对话出现质问/回避循环,缺少可验证推进。",
      "下一轮必须用 inspect/search/use/move/reveal 或带明确代价的 negotiate 打断循环,不能继续互相反问。"
    );
  }

  if (actorActions.length > 1) {
    const types = actorActions.map((item) => item.action.action_type || "speak");
    const sameType = types.every((type) => type === types[0]);
    if (sameType) {
      add(
        "same_action_type",
        10,
        `多个角色都选择了 ${types[0]}，行动差异不足。`,
        "下一轮不同角色必须用不同策略：一人质问、一人检查/移动、一人谈判或掩盖。"
      );
    }

    for (let i = 0; i < actorActions.length; i++) {
      for (let j = i + 1; j < actorActions.length; j++) {
        const a = actorActions[i].action.speech || "";
        const b = actorActions[j].action.speech || "";
        if (a && b && speechSimilarity(a, b) >= 0.62) {
          add(
            "cross_actor_repetition",
            18,
            "不同角色之间出现相似台词。",
            "下一轮 speech 首句必须引用不同对象、物件或上一句具体词,禁止共用抽象模板句。"
          );
          break;
        }
      }
    }
  }

  for (const { agent, action } of actorActions) {
    const type = action.action_type || "speak";
    if (!action.target_evidence_id && state.world.evidenceAtoms?.length) {
      add(
        `evidence_unbound_${agent.id}`,
        12,
        `${agent.name} 的动作没有绑定具体证据原子。`,
        "下一轮必须填写 target_evidence_id,并让动作/台词围绕某条具体事实,不能只围绕物件名。"
      );
    }
    if (["speak", "observe", "silence"].includes(type) && !action.target && !action.target_agent_id) {
      add(
        `passive_${agent.id}`,
        8,
        `${agent.name} 行动偏被动。`,
        "被动角色下一轮必须点名一个对象或物件,把话落成具体动作。"
      );
    }
    if (!actionExplainsGoal(agent, action)) {
      add(
        `goal_miss_${agent.id}`,
        12,
        `${agent.name} 的动作没有解释如何推进本场目标。`,
        "每个角色的 private_intent 和 next_intended_action 必须直接说明如何推进自己的本场目标。"
      );
    }
    if (type === "challenge" && !action.target_agent_id) {
      add(
        `untargeted_challenge_${agent.id}`,
        7,
        `${agent.name} 发起质问但没有明确对象。`,
        "challenge/threaten/negotiate 必须明确 target_agent_id。"
      );
    }
  }

  const forces = turnSystemForces();
  if (forces.length > Math.max(1, actorActions.length)) {
    add(
      "too_many_server_forces",
      14,
      `本轮触发 ${forces.length} 次系统兜底,说明模型输出仍偏弱。`,
      "下一轮 prompt 要求角色自己先给出具体目标动作,减少服务器后处理接管。"
    );
  }

  const recentDirector = [...state.transcript].reverse().find((entry) => entry.type === "director" && entry.meta?.plot);
  if (recentDirector && recentDirector.turn === state.world.turn) {
    const dialogueLines = recentDirector.meta?.dialogueLines || [];
    if (claimsUnshownDialogue(`${recentDirector.title || ""} ${recentDirector.text || ""}`) && dialogueLines.length < 4) {
      add(
        "thin_dialogue_event",
        12,
        "剧情事件提到对话/矛盾,但没有足够原话支撑。",
        "涉及对话矛盾的剧情事件必须保存 4 句以上现场原话。"
      );
    }
  }

  const rate = state.metrics?.stateChangeRate || 0;
  if ((state.metrics?.totalTurns || 0) >= 3 && rate < 55) {
    add(
      "low_state_change_rate",
      10,
      `整体产出率偏低: ${rate}%。`,
      "提高物理动作和关系动作比例,少用纯 speak/observe。"
    );
  }

  const score = clamp(100 - issues.reduce((sum, item) => sum + item.severity, 0), 0, 100);
  return {
    turn: state.world.turn,
    score,
    issues,
    suggestions: suggestions.slice(0, 5),
    systemForces: forces.map((item) => item.kind),
    // 诊断:本轮成片场景实际用的模型(local 表示 scene-writer 回退了),以及限速命中/跳过次数。
    sceneModel: (state.scriptScenes || []).slice(-1)[0]?.model || null,
    sceneWriterError: state.lastSceneWriterError || null,
    rateLimitHits: state.rateLimitHits || 0,
    rateLimitSkips: state.rateLimitSkips || 0,
    createdAt: nowIso()
  };
}

function applyQualityAudit(audit) {
  // 审计已快照本轮的限速计数/失败原因,这里清零,让每条审计记录反映「本回合」而非累计值。
  state.rateLimitHits = 0;
  state.rateLimitSkips = 0;
  state.lastSceneWriterError = null;
  if (!state.metrics) state.metrics = { totalTurns: 0, productiveTurns: 0, lastTurnChanges: [] };
  state.metrics.lastQualityAudit = audit;
  state.metrics.qualityAudits = [...(state.metrics.qualityAudits || []), audit].slice(-20);
  state.director.qualityGuidance = audit.suggestions.slice(0, 5);
  if (audit.score < 70) state.director.pressure = clamp((state.director.pressure || 0) + 2);
  state.societyLog.push({
    kind: "quality_audit",
    score: audit.score,
    message: audit.issues.length
      ? audit.issues.map((item) => item.text).join(" / ")
      : "质量稳定: 未发现明显复读、空转或目标偏离。",
    suggestions: audit.suggestions,
    turn: state.world.turn
  });
  mkdir(scenarioLogDir, { recursive: true })
    .then(() => appendFile(join(scenarioLogDir, "quality-audits.jsonl"), `${JSON.stringify({
      scenarioLogId: state.scenarioLog?.id || null,
      scenarioTitle: state.scenario?.title || "",
      ...audit
    })}\n`, "utf8"))
    .catch((error) => {
      state.societyLog.push({
        kind: "quality_audit_log_error",
        message: `质量审计日志保存失败: ${error.message || String(error)}`,
        turn: state.world.turn
      });
    });
}

function buildOpeningBriefGroups() {
  const deadlineLines = (state.world.deadlines || []).slice(0, 4).map((d) => `${d.label}: ${minutesToClock(d.atMinutes)}`);
  const visibleItems = (state.world.items || [])
    .filter((item) => !item.hidden)
    .slice(0, 5)
    .map((item) => `${item.label}${item.possibleActions?.length ? `(${item.possibleActions.slice(0, 3).join("/")})` : ""}`);
  const publicRoles = state.agents.map((agent) => {
    const posture = agent.currentAction ? `当前姿态: ${agent.currentAction}` : `公开身份: ${agent.publicIdentity || agent.role}`;
    return `${agent.name}(${agent.role}) - ${posture}`;
  });
  const privateRoles = state.agents.map((agent) => {
    const secrets = (agent.secrets || []).slice(0, 2).map((secret) => secret.label).join(" / ") || "无显性秘密";
    return `${agent.name}: 真实身份/暗线是「${agent.hiddenIdentity || "未设定"}」; 本场目标是「${agent.shortTermGoal || "未设定"}」; 秘密: ${secrets}`;
  });
  const publicLines = [
    `场景目标: ${state.scenario.sceneGoal || "让角色在冲突中自行演化。"}`,
    `核心冲突: ${state.scenario.centralConflict || state.scenario.premise || "角色目标互相牵制。"}`,
    `现场条件: ${minutesToClock(state.world.minutes)}; ${state.world.weather || "天气未知"}; ${state.world.light || "光照未知"}; 危险 ${state.world.dangerLevel}, 威胁 ${state.world.threatLevel}。`
  ];
  if (deadlineLines.length) publicLines.push(`截止时间: ${deadlineLines.join(" / ")}`);
  if (visibleItems.length) publicLines.push(`可见物件: ${visibleItems.join("、")}`);
  return [
    { title: "任务与约束", lines: publicLines },
    { title: "公开角色", lines: publicRoles },
    { title: "导演暗线", lines: privateRoles, private: true }
  ];
}

function pushOpeningEntries() {
  pushDirectorEntry("开场", `${state.scenario.place}。${state.scenario.premise}`);
  const groups = buildOpeningBriefGroups();
  pushDirectorEntry("任务介绍", flattenSummaryGroups(groups).join("\n"), {
    openingBrief: true,
    summaryGroups: groups,
    summaryLines: flattenSummaryGroups(groups)
  });
}

async function advanceSociety({ userCue = "", actorIds = null, onActionEntry = null, onDirectorEntry = null } = {}) {
  state.world.turn += 1;
  state.world.activeEvent = null;
  decayWorld();
  fireDueDeadlines();

  // 1) Director 阶段：先看有没有用户 cue；否则跑 plot-event/ambient
  const directorEntriesBefore = state.transcript.length;
  if (userCue) {
    const event = buildUserCueEvent(userCue);
    applyDirectorEvent(event);
  } else {
    await maybeAutoIntervene(); // 内部已 push director entry
  }
  if (onDirectorEntry) {
    for (let i = directorEntriesBefore; i < state.transcript.length; i++) {
      const e = state.transcript[i];
      if (e.type === "director") { try { await onDirectorEntry(e); } catch {} }
    }
  }

  // 2) Plot event 可以指定 forced_to_act_agent_id：让该 agent 优先行动
  let forcedActorIds = actorIds;
  const ae = state.world.activeEvent;
  if (!forcedActorIds && ae) {
    const eventForced = Array.isArray(ae.forcedToActAgentIds)
      ? ae.forcedToActAgentIds
      : (ae.forcedToActAgentId ? [ae.forcedToActAgentId] : []);
    const involved = Array.isArray(ae.involvedAgentIds) ? ae.involvedAgentIds : [];
    const ids = Array.from(new Set([...eventForced, ...involved].filter(Boolean)));
    if (ids.length) forcedActorIds = ids;
  }
  // 2.1) V2.2: user cue 里点名的角色,强制纳入本轮 actors
  //      —— 否则会出现"导演说 Karl 必须藏东西,Karl 这轮却没行动"的脱节
  if (userCue) {
    const named = findCueNamedAgentIds(userCue);
    if (named.length > 0) {
      forcedActorIds = Array.from(new Set([...(forcedActorIds || []), ...named]));
    }
  }

  // 3) Agents 阶段
  const actors = chooseActingAgents(forcedActorIds);
  const beatInstall = installDramaBeat(actors, userCue);
  if (onDirectorEntry && beatInstall?.entry) {
    try { await onDirectorEntry(beatInstall.entry); } catch {}
  }

  // V2: State Change Rate metric — 在 agents 行动前快照,行动后比对
  if (!state.metrics) state.metrics = { totalTurns: 0, productiveTurns: 0, lastTurnChanges: [] };
  const preNarrativeState = captureNarrativeState();
  const preSnapshot = {
    revealedClueCount: state.world.revealedClues.length,
    dangerLevel: state.world.dangerLevel,
    plotStage: state.world.plotStage,
    firedDeadlineCount: state.world.deadlines.filter((d) => d.fired).length,
    itemSig: (state.world.items || []).map((it) => `${it.id}@${it.location || "_"}|h=${it.holder || "_"}|s=${it.state || "_"}|a=${it.lastAction || "_"}|d=${(it.discoveredBy || []).length}`).join(";"),
    locSig: state.agents.map((a) => `${a.id}@${a.location || "_"}`).join(";"),
    suspicionSig: state.agents.map((a) => `${a.id}:${Object.entries(a.suspicions || {}).map(([k, v]) => `${k}=${v}`).join(",")}`).join("|"),
    knownFactSig: state.agents.map((a) => `${a.id}:${(a.knownFacts || []).length}`).join("|")
  };

  const actions = [];
  let batchActions = null;
  if (batchAgentCalls && actors.length > 1) {
    try {
      batchActions = await runAgentsBatch(actors);
      state.societyLog.push({
        kind: "agent_batch_call",
        message: `批量生成 ${batchActions.size}/${actors.length} 个角色动作`,
        turn: state.world.turn,
        actorIds: actors.map((agent) => agent.id)
      });
    } catch (error) {
      state.societyLog.push({
        kind: "agent_batch_error",
        message: ((error && error.message) || String(error)).slice(0, 240),
        turn: state.world.turn,
        actorIds: actors.map((agent) => agent.id)
      });
      batchActions = null;
    }
  }
  for (let i = 0; i < actors.length; i++) {
    const agent = actors[i];
    let action;
    try {
      if (batchActions?.has(agent.id)) {
        action = normalizeAction(batchActions.get(agent.id));
      } else {
        if (i > 0) await sleep(600);
        action = normalizeAction(await runAgent(agent));
      }
      if (userCue && isPassiveCueAction(action)) {
        state.societyLog.push({
          kind: "cue_repair_retry",
          agentId: agent.id,
          message: `首次输出被动(${action.action_type}),要求模型重写`,
          turn: state.world.turn
        });
        action = await repairCueAction(agent, action, userCue, "首次输出像沉默/空话或没有真正回应导演干预");
      }
    } catch (error) {
      const message = (error && error.message) || String(error);
      state.societyLog.push({
        kind: "agent_error",
        agentId: agent.id,
        message: message.slice(0, 240),
        turn: state.world.turn
      });
      action = userCue
        ? minimalCueFallbackAction(agent, userCue, message.includes("rate") ? "速率受限" : "调用失败")
        : buildFallbackRecoveryAction(agent, message.includes("rate") ? "速率受限" : "调用失败");
    }
    // V2: 服务器侧硬封顶——双闸门
    //   闸门 A: streak >= 1 (即上一轮已经 silence/observe) 再次输出被动 → 强制行动
    //   闸门 B: 即便 streak=0,只要当前位置还有 hidden 未发现物 / 持有者同房,silence/observe 也劫持成 inspect
    // 目的:把 silence 从"默认"压成"战术",让 stateChangeRate 不被被动行为稀释
    const isPassiveType = (action.action_type === "silence" || action.action_type === "observe");
    const isPassiveOut = isPassiveType && !action.speech;
    const myLocId = agent.location || state.world.defaultLocationId;
    // 候选优先级:
    //  1) 别人持有的 hidden item (同位置) —— 最有戏剧意义
    //  2) 位置现场的 hidden item (无持有者)
    //  3) 位置现场任何未被本人发现的物品
    // 全部要求 !discoveredBy.includes(agent.id) 且 holder !== agent.id (别检查自己口袋)
    const itemsAll = state.world.items || [];
    const myUndiscovered = (it) => !(it.discoveredBy || []).includes(agent.id);
    const heldByCoLocated = itemsAll.find((it) =>
      it.hidden && it.holder && it.holder !== agent.id &&
      myUndiscovered(it) &&
      state.agents.find((a) => a.id === it.holder)?.location === myLocId
    );
    const stagedHere = itemsAll.find((it) =>
      it.hidden && !it.holder && it.location === myLocId && myUndiscovered(it)
    );
    const anyHere = itemsAll.find((it) =>
      it.location === myLocId && it.holder !== agent.id && myUndiscovered(it)
    );
    const undiscovered = heldByCoLocated || stagedHere || anyHere;
    // 候选附近房间: 从 exitsHere 的另一端找 hidden 未发现物,供 move 备选
    const myLoc = (state.world.locations || []).find((l) => l.id === myLocId);
    const neighborRoomWithItems = (myLoc?.exits || []).map((ex) => ex.toLocationId).find((rid) =>
      itemsAll.some((it) => it.location === rid && it.hidden && myUndiscovered(it))
    );
    const streak = agent.consecutiveSilenceTurns || 0;
    const shouldForce = !userCue && (
      // A: 连续被动 ≥ 1 且这轮还想被动
      (isPassiveType && streak >= 1) ||
      // B: 这轮被动且现场还有未挖掘的 hidden 物
      (isPassiveOut && undiscovered) ||
      // C: 纯 silence (无 speech) — 永远不允许做"零内容沉默",哪怕 streak=0
      (action.action_type === "silence" && !action.speech && undiscovered)
    );
    if (shouldForce && undiscovered) {
      state.societyLog.push({
        kind: "silence_cap_force",
        agentId: agent.id,
        message: `沉默封顶触发(streak=${streak}),强制 inspect ${undiscovered.label}`,
        turn: state.world.turn
      });
      action.action_type = "inspect";
      action.target = undiscovered.label;
      action.target_agent_id = undiscovered.holder && undiscovered.holder !== agent.id ? undiscovered.holder : null;
      action.speech = action.speech || fallbackSpeechForAction(agent, action, 31);
      action.visible_behavior = action.visible_behavior || `${agent.name}凑近${undiscovered.label},仔细看。`;
      action.private_intent = action.private_intent || "(系统封顶:不能再被动)";
    } else if (shouldForce && !undiscovered && neighborRoomWithItems) {
      // 没物品可挖,但隔壁房间有 → move 过去
      const targetLoc = (state.world.locations || []).find((l) => l.id === neighborRoomWithItems);
      state.societyLog.push({
        kind: "silence_cap_force",
        agentId: agent.id,
        message: `沉默封顶触发(streak=${streak}),本场无可挖物 → move 到 ${targetLoc?.label || neighborRoomWithItems}`,
        turn: state.world.turn
      });
      action.action_type = "move";
      action.target = targetLoc?.label || neighborRoomWithItems;
      action.target_agent_id = null;
      action.speech = action.speech || fallbackSpeechForAction(agent, action, 31);
      action.visible_behavior = action.visible_behavior || `${agent.name}起身往${targetLoc?.label || neighborRoomWithItems}走。`;
      action.private_intent = action.private_intent || "(系统封顶:去别的场景找线索)";
    } else if (shouldForce && !undiscovered) {
      // 没物品可挖,转 challenge 同房间最可疑的人
      const others = state.agents.filter((a) => a.id !== agent.id && (a.location || state.world.defaultLocationId) === myLocId);
      if (others.length) {
        const mostSus = others.slice().sort((a, b) => (agent.suspicions[b.id] || 50) - (agent.suspicions[a.id] || 50))[0];
        state.societyLog.push({
          kind: "silence_cap_force",
          agentId: agent.id,
          message: `沉默封顶触发(streak=${streak}),无可挖物 → 转 challenge ${mostSus.name}`,
          turn: state.world.turn
        });
        action.action_type = "challenge";
        action.target = mostSus.id;
        action.target_agent_id = mostSus.id;
        action.speech = action.speech || fallbackSpeechForAction(agent, action, 31);
        action.visible_behavior = action.visible_behavior || `${agent.name}盯住${mostSus.name},语气收紧。`;
        action.private_intent = action.private_intent || "(系统封顶:必须开口逼问)";
      }
    }
    const repetition = detectSelfRepetition(agent.id, action.speech);
    if (repetition) redirectRepetitionToAction(agent, action, repetition);
    if (userCue && isPassiveCueAction(action)) {
      try {
        state.societyLog.push({
          kind: "cue_repair_retry",
          agentId: agent.id,
          message: `后处理后仍被动(${action.action_type}),要求模型重写`,
          turn: state.world.turn
        });
        action = await repairCueAction(agent, action, userCue, "后处理后仍然像沉默/重复/空话");
      } catch (error) {
        action = minimalCueFallbackAction(agent, userCue, (error && error.message) || "二次修复失败");
      }
    }
    action = enforceCueAction(agent, action, userCue);
    action = ensureGoalDrivenAction(agent, action, userCue);
    action = ensureDialogueProgressAction(agent, action, userCue);
    action = ensureConcreteTacticalAction(agent, action, userCue);
    action = ensureDramaBeatAction(agent, action, userCue);
    action = ensureEvidenceBoundAction(agent, action, userCue);
    action = ensureAudibleAction(agent, action);
    // V2: applyAction 必须先跑(它会通过 simulator 写入 action.simulation 并改写 visible_behavior),再 push entry
    applyAction(agent, action);
    action = ensureAudibleAction(agent, action);
    action = avoidRecentSpeechEcho(agent, action);
    const entry = pushAgentEntry(agent, action);
    actions.push({ agentId: agent.id, action });
    if (onActionEntry) {
      try { await onActionEntry(entry); } catch {}
    }
  }

  // 4) 收尾:更新公共记忆、张力、剧情阶段
  const closingDirectorStart = state.transcript.length;
  updatePublicMemory(actions);
  settleTension(actions);
  maybeAdvancePlotStage();
  updateEmergentFocus();
  if (onDirectorEntry) {
    for (let i = closingDirectorStart; i < state.transcript.length; i++) {
      const e = state.transcript[i];
      if (e.type === "director") { try { await onDirectorEntry(e); } catch {} }
    }
  }

  // V2: State Change Rate metric — 比对前后差异
  const postSnapshot = {
    revealedClueCount: state.world.revealedClues.length,
    dangerLevel: state.world.dangerLevel,
    plotStage: state.world.plotStage,
    firedDeadlineCount: state.world.deadlines.filter((d) => d.fired).length,
    itemSig: (state.world.items || []).map((it) => `${it.id}@${it.location || "_"}|h=${it.holder || "_"}|s=${it.state || "_"}|a=${it.lastAction || "_"}|d=${(it.discoveredBy || []).length}`).join(";"),
    locSig: state.agents.map((a) => `${a.id}@${a.location || "_"}`).join(";"),
    suspicionSig: state.agents.map((a) => `${a.id}:${Object.entries(a.suspicions || {}).map(([k, v]) => `${k}=${v}`).join(",")}`).join("|"),
    knownFactSig: state.agents.map((a) => `${a.id}:${(a.knownFacts || []).length}`).join("|")
  };
  const changes = [];
  if (postSnapshot.revealedClueCount > preSnapshot.revealedClueCount) changes.push("clue_revealed");
  if (postSnapshot.itemSig !== preSnapshot.itemSig) changes.push("item_state");
  if (postSnapshot.locSig !== preSnapshot.locSig) changes.push("location");
  if (postSnapshot.suspicionSig !== preSnapshot.suspicionSig) changes.push("suspicion");
  if (postSnapshot.knownFactSig !== preSnapshot.knownFactSig) changes.push("known_facts");
  if (postSnapshot.firedDeadlineCount > preSnapshot.firedDeadlineCount) changes.push("deadline_fired");
  if (Math.abs(postSnapshot.dangerLevel - preSnapshot.dangerLevel) >= 5) changes.push("danger_shift");
  if (postSnapshot.plotStage !== preSnapshot.plotStage) changes.push("plot_stage_advanced");
  const beatResult = resolveDramaBeat(state.director.currentBeat, actions, changes);

  state.metrics.totalTurns += 1;
  if (changes.length > 0) state.metrics.productiveTurns += 1;
  state.metrics.lastTurnChanges = changes;
  state.metrics.stateChangeRate = state.metrics.totalTurns > 0
    ? Math.round((state.metrics.productiveTurns / state.metrics.totalTurns) * 100)
    : 0;

  const outcome = buildTurnOutcomeSummary(preNarrativeState, changes, actions, beatResult);
  state.metrics.lastTurnOutcome = outcome.lines;
  if (outcome.lines.length > 0) {
    const summaryEntry = pushDirectorEntry("回合结算", outcome.lines.join("\n"), {
      stateSummary: true,
      summaryLines: outcome.lines,
      summaryGroups: outcome.groups,
      changes,
      dramaBeat: beatResult || state.director.currentBeat || null
    });
    if (onDirectorEntry) {
      try { await onDirectorEntry(summaryEntry); } catch {}
    }
  }

  const ledgerUpdate = updateStoryLedger({ actions, changes, beatResult, outcome });
  try {
    const sceneEntry = await generateTurnScene({ actions, changes, beatResult, outcome, ledgerUpdate });
    if (onDirectorEntry && sceneEntry) {
      try { await onDirectorEntry(sceneEntry); } catch {}
    }
  } catch (error) {
    state.societyLog.push({
      kind: "scene_writer_unhandled_error",
      message: (error.message || String(error)).slice(0, 240),
      turn: state.world.turn
    });
  }

  const qualityAudit = auditTurnQuality(preNarrativeState, changes, actions);
  applyQualityAudit(qualityAudit);

  state.updatedAt = nowIso();
  return publicState();
}

function updatePublicMemory(actions) {
  for (const { agentId, action } of actions) {
    const speaker = state.agents.find((agent) => agent.id === agentId);
    if (!speaker) continue;
    const publicFact = action.speech
      ? `${speaker.role}说过：${action.speech.slice(0, 90)}`
      : `${speaker.role}选择了${action.action_type}。`;
    for (const agent of state.agents) {
      if (agent.id === agentId) continue;
      agent.publicMemories.push(publicFact);
      agent.publicMemories = agent.publicMemories.slice(-12);
    }
  }
}

function canonicalStateSpeaker(value) {
  const raw = String(value || "").trim().replace(/[:：]$/, "");
  if (!raw) return "";
  const exact = state.agents.find((agent) => agent.name === raw || agent.id === raw || agent.role === raw);
  if (exact) return exact.name;
  const compact = normalizeForSimilarity(raw);
  const fuzzy = state.agents.find((agent) => {
    const name = normalizeForSimilarity(agent.name);
    const role = normalizeForSimilarity(agent.role);
    return compact && (name.includes(compact) || compact.includes(name) || role.includes(compact) || compact.includes(role));
  });
  return fuzzy ? fuzzy.name : "";
}

function cleanSceneLine(value, { max = 360, dropTemplate = true } = {}) {
  let text = compactLine(value, max);
  if (!text) return "";
  if (dropTemplate && (scriptForbiddenHits(text).length || isTemplateResidue(text))) return "";
  text = text
    .replace(/\baction_type\b/gi, "")
    .replace(/\btarget_object_id\b/gi, "")
    .replace(/戏剧问题[:：]?/g, "")
    .replace(/焦点物件[:：]?/g, "")
    .replace(/建议动作[:：]?/g, "")
    .trim();
  return text.slice(0, max);
}

function actorPlanForScene(item) {
  const agent = state.agents.find((a) => a.id === item.agentId);
  const action = item.action || {};
  const targetObject = action.target_object_id
    ? (state.world.items || []).find((obj) => obj.id === action.target_object_id)
    : null;
  const targetEvidence = action.target_evidence_id
    ? (state.world.evidenceAtoms || []).find((atom) => atom.id === action.target_evidence_id)
    : null;
  return {
    agentId: agent?.id || item.agentId,
    name: agent?.name || item.agentId,
    role: agent?.role || "",
    publicGoal: agent?.shortTermGoal || "",
    speechStyle: agent?.speechStyle || "",
    actionType: action.action_type || "",
    target: action.target || "",
    targetAgent: action.target_agent_id ? agentDisplayName(action.target_agent_id) : "",
    targetObject: targetObject ? {
      id: targetObject.id,
      label: targetObject.label,
      contents: targetObject.contents,
      state: targetObject.state,
      stakes: targetObject.stakes,
      holder: targetObject.holder ? agentDisplayName(targetObject.holder) : "",
      lastAction: targetObject.lastAction || ""
    } : null,
    targetEvidence: targetEvidence ? evidenceLedgerView(targetEvidence) : null,
    targetEvidenceId: action.target_evidence_id || "",
    evidenceAction: action.evidence_action || "",
    tactic: action.tactic || "",
    concreteAction: action.concrete_action || "",
    risk: action.risk || "",
    intendedStateChange: action.intended_state_change || "",
    dialogueIntent: action.dialogue_intent || "",
    leverage: action.leverage || "",
    whatToReveal: action.what_to_reveal || "",
    whatToHide: action.what_to_hide || "",
    subtext: action.subtext || "",
    speechDraft: action.speech || "",
    visibleBehavior: action.visible_behavior || "",
    privateIntent: action.private_intent || "",
    simulation: action.simulation || null
  };
}

// 给 LLM scene-writer 的 actorPlan 去掉机械模板字段(speechDraft/leverage),
// 否则 70B 会照抄「它会伤害X帮助Y」「让X自己说话」进成片。本地兜底仍用完整字段。
function actorPlanForLLM(plan) {
  const { speechDraft, leverage, ...rest } = plan;
  return rest;
}

function sceneWriterPayload({ actions, changes, beatResult, outcome, ledgerUpdate }) {
  return {
    turn: state.world.turn,
    clock: minutesToClock(state.world.minutes),
    scenario: state.scenario,
    world: {
      plotStage: state.world.plotStage,
      weather: state.world.weather,
      light: state.world.light,
      threatLevel: state.world.threatLevel,
      dangerLevel: state.world.dangerLevel,
      deadlines: (state.world.deadlines || []).map((item) => ({
        label: item.label,
        clock: minutesToClock(item.atMinutes),
        fired: !!item.fired
      }))
    },
    cast: state.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      publicIdentity: agent.publicIdentity,
      shortTermGoal: agent.shortTermGoal,
      speechStyle: agent.speechStyle,
      currentAction: agent.currentAction
    })),
    beatContract: beatResult || state.director.currentBeat || null,
    selectedEvidenceAtom: (beatResult || state.director.currentBeat)?.evidenceAtom || null,
    actorPlans: (actions || []).map(actorPlanForScene),
    // 只送压缩后的 ledger 摘要:完整 storyLedger 约 12KB(~7k tokens),会单条请求就撑爆 Groq 12k TPM。
    ledger: compactLedgerForScene(state.storyLedger || ensureStoryLedger()),
    ledgerUpdate,
    outcome: outcome?.lines || [],
    stateChanges: changes || [],
    previousSceneTail: (state.scriptScenes || []).slice(-1).map((scene) => ({
      title: scene.title,
      turningPoint: scene.turningPoint,
      markdown: String(scene.markdown || "").slice(-360)
    })),
    scriptRules: {
      allowedCharacterNames: state.agents.map((agent) => agent.name),
      outputPrinciple: "只写观众可读的短剧片段。不要写系统词、字段名、beat说明或质量审计。"
    }
  };
}

// 给 scene-writer / 剧本总编用的精简 ledger:只保留最近、最相关的几条,控制 token 体积。
function compactLedgerForScene(ledger) {
  if (!ledger || typeof ledger !== "object") return null;
  return {
    publicFacts: (ledger.publicFacts || []).slice(-6),
    lastTurnSummary: (ledger.lastTurnSummary || []).slice(-6),
    openQuestions: (ledger.openQuestions || []).slice(-3),
    evidenceLedger: (ledger.evidenceLedger || []).slice(-6),
    powerShifts: (ledger.powerShifts || []).slice(-3)
  };
}

function normalizeSceneFragmentResult(result, payload, modelName) {
  const title = cleanSceneLine(result?.title || payload.beatContract?.title || `第 ${payload.turn} 回合`, { max: 80, dropTemplate: false }) || `第 ${payload.turn} 回合`;
  const stage = cleanSceneLine(result?.stage || result?.setting || "", { max: 420 }) ||
    `${payload.scenario.place || "现场"}。${payload.clock},${payload.world.weather || "外部压力"}压在门外。`;
  const rawBeats = Array.isArray(result?.beats) ? result.beats : [];
  const beats = rawBeats.slice(0, 16).map((beat) => {
    const speaker = canonicalStateSpeaker(beat.speaker || beat.character || "");
    const type = String(beat.type || beat.kind || (speaker ? "dialogue" : "action")).toLowerCase().includes("dialogue") || speaker
      ? "dialogue"
      : "action";
    const text = cleanSceneLine(beat.text || beat.line || beat.action || "", { max: 420 });
    if (!text) return null;
    return type === "dialogue" ? { type, speaker, text } : { type, text };
  }).filter((beat) => beat && (beat.type !== "dialogue" || beat.speaker));
  const turningPoint = cleanSceneLine(result?.turning_point || result?.turningPoint || result?.consequence || "", { max: 260 });
  const ledgerChanges = Array.isArray(result?.ledger_changes || result?.ledgerChanges)
    ? (result.ledger_changes || result.ledgerChanges).map((line) => cleanSceneLine(line, { max: 180 })).filter(Boolean).slice(0, 6)
    : [];
  const scene = {
    id: `scene-${payload.turn}-${Math.random().toString(16).slice(2, 8)}`,
    turn: payload.turn,
    clock: payload.clock,
    title,
    stage,
    beats,
    turningPoint,
    ledgerChanges,
    model: modelName,
    createdAt: nowIso()
  };
  scene.markdown = renderSceneFragmentMarkdown(scene);
  scene.validation = validateSceneFragment(scene, payload);
  return scene;
}

function renderSceneFragmentMarkdown(scene, { includeHeading = true } = {}) {
  const lines = [];
  if (includeHeading) lines.push(`### ${scene.clock || ""} · ${scene.title || "成片场景"}`.trim(), "");
  const stage = cleanSceneLine(scene.stage, { max: 700, dropTemplate: true });
  if (stage) lines.push(`*${stage}*`, "");
  for (const beat of scene.beats || []) {
    const text = cleanSceneLine(beat.text, { max: 700, dropTemplate: true });
    if (!text) continue;
    if (beat.type === "dialogue") {
      const speaker = canonicalStateSpeaker(beat.speaker);
      if (speaker) lines.push(`**${speaker}**${dlgColon}${text}`, "");
    } else {
      lines.push(`*${text}*`, "");
    }
  }
  // 同上:不再渲染逐场 turningPoint 总结句(分析腔/AI 味);戏收在最后一个动作或对白上。
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function evidenceAtomReferenced(text, atom) {
  if (!atom) return true;
  const source = normalizeForSimilarity(text);
  const content = String(atom.content || "");
  if (!content) return false;
  const chunks = (content.match(/[\u4e00-\u9fa5A-Za-z0-9]{3,10}/g) || [])
    .filter((part) => !/事故|记录|详细|信息|公司|现场|问题|事实|内容/.test(part))
    .slice(0, 12);
  if (chunks.some((part) => source.includes(normalizeForSimilarity(part)))) return true;
  const label = normalizeForSimilarity(atom.label || "");
  return label.length >= 4 && source.includes(label);
}

function validateSceneFragment(scene, payload) {
  const text = renderSceneFragmentMarkdown(scene);
  const issues = [];
  const forbidden = scriptForbiddenHits(text);
  if (forbidden.length) issues.push({ type: "system_residue", message: `成片场景仍有系统词: ${[...new Set(forbidden)].slice(0, 5).join("、")}` });
  if (/对「?[^」\n]{1,30}」?执行|伸手操作|让争论落到|摆到台面|换个切口|会比我们任何人的解释都诚实|空话到此为止/.test(text)) {
    issues.push({ type: "log_style_residue", message: "仍有日志腔或模板台词。" });
  }
  const selectedEvidence = payload.selectedEvidenceAtom || payload.beatContract?.evidenceAtom || null;
  if (selectedEvidence && !evidenceAtomReferenced(text, selectedEvidence)) {
    issues.push({ type: "missing_evidence_atom", message: `没有写出本轮证据原子「${selectedEvidence.label}」的具体事实。` });
  }
  const anyPlanEvidence = (payload.actorPlans || []).some((plan) => plan.targetEvidenceId || plan.targetEvidence);
  if ((payload.actorPlans || []).length && !anyPlanEvidence) {
    issues.push({ type: "unbound_evidence", message: "角色动作没有绑定证据原子。" });
  }
  const dialogue = (scene.beats || []).filter((beat) => beat.type === "dialogue" && beat.text);
  if ((payload.actorPlans || []).length >= 2 && dialogue.length < 2) {
    issues.push({ type: "thin_dialogue", message: "本场对白不足,读起来仍像动作摘要。" });
  }
  const actionLines = (scene.beats || []).filter((beat) => beat.type === "action" && beat.text);
  if (!actionLines.length) issues.push({ type: "no_action", message: "缺少可见舞台动作。" });
  const consequenceText = `${scene.turningPoint || ""} ${(payload.ledgerUpdate?.evidenceChanged || []).map((item) => item.consequence || item.ifRevealed || "").join(" ")}`;
  if (!scene.turningPoint && !(payload.ledgerUpdate?.summaryLines || []).length) {
    issues.push({ type: "no_consequence", message: "缺少本轮局面变化或转折句。" });
  }
  if (selectedEvidence && !evidenceAtomReferenced(consequenceText || text, selectedEvidence) && !(payload.ledgerUpdate?.evidenceChanged || []).length) {
    issues.push({ type: "no_evidence_consequence", message: "证据没有产生可见后果。" });
  }
  for (let i = 1; i < dialogue.length; i++) {
    if (speechSimilarity(dialogue[i - 1].text, dialogue[i].text) >= 0.58) {
      issues.push({ type: "repetitive_dialogue", message: "相邻对白相似。" });
      break;
    }
  }
  return { ok: issues.length === 0, issues };
}

function localSceneFragment(payload, reason = "") {
  const beats = [];
  const evidence = payload.selectedEvidenceAtom || payload.beatContract?.evidenceAtom || null;
  const driver = payload.actorPlans?.[0]?.name || payload.beatContract?.driverAgentName || "有人";
  // resistor 退回到真实的另一名角色,而不是字面量「对方」(那会被当成角色名漏进对白)。
  const resistor = payload.beatContract?.resistorAgentName
    || payload.actorPlans?.[1]?.name
    || (payload.cast || []).map((member) => member.name).find((name) => name && name !== driver)
    || "";
  if (evidence) {
    beats.push({
      type: "action",
      text: `${driver}把注意力压到「${evidence.label}」上: ${evidence.content}`
    });
    beats.push({
      type: "dialogue",
      speaker: canonicalStateSpeaker(driver),
      text: evidenceStatementLine(evidence, `${payload.turn}-${driver}`)
    });
    if (canonicalStateSpeaker(resistor)) {
      beats.push({
        type: "dialogue",
        speaker: canonicalStateSpeaker(resistor),
        text: evidencePushbackLine(evidence, `${payload.turn}-${resistor}`)
      });
    }
  }
  for (const plan of payload.actorPlans || []) {
    const actionText = cleanSceneLine(plan.concreteAction || plan.visibleBehavior || `${plan.name}${actionTypeLabel(plan.actionType)}`, { max: 260 });
    if (actionText) beats.push({ type: "action", text: actionText });
    const speech = cleanSceneLine(plan.speechDraft, { max: 180 });
    if (speech) beats.push({ type: "dialogue", speaker: plan.name, text: speech });
  }
  if (!beats.length) {
    beats.push({ type: "action", text: `${payload.scenario.place || "现场"}里短暂安静下来,每个人都意识到局面没有回到原点。` });
  }
  const result = {
    title: payload.beatContract?.title || `第 ${payload.turn} 回合`,
    stage: `${payload.scenario.place || "现场"}。${payload.clock},${payload.world.light || "光线"}下,上一轮行动留下的压力还在。`,
    beats,
    turning_point: evidence
      ? (evidence.ifRevealed || payload.beatContract?.evidenceIfRevealed || payload.beatContract?.irreversibleChange || "这条事实让至少一个人的选择空间变窄。")
      : ((payload.outcome || [])[0] || payload.beatContract?.irreversibleChange || reason || "局面留下新的压力,下一轮必须继续处理。"),
    ledger_changes: payload.ledgerUpdate?.summaryLines || []
  };
  return normalizeSceneFragmentResult(result, payload, "local-scene-fallback");
}

async function repairSceneFragment(scene, payload) {
  const result = await callJsonLLM([
    "你是 Scene Writer 修稿人。下面的场景片段没有通过质量门,请重写为观众可读、有动作和潜台词的短剧片段。",
    "必须保留 actorPlans 的核心行动、beatContract 的信息变化、ledgerUpdate 的后果,但不能照抄 agent 的机械台词。",
    "必须围绕 selectedEvidenceAtom 或 actorPlans.targetEvidence 写戏:写出证据的具体 content,说明伤害谁/帮助谁,并让一个角色的选择空间变窄。",
    "严禁出现系统词、字段名、戏剧Beat、焦点物件、建议动作、质量审计、我现在就用等短语。",
    "严禁写'对某物执行某动作'、'伸手操作某物'、'摆到台面上'、'这次我换个切口说'。",
    "严格输出 JSON:{title,stage,beats,turning_point,ledger_changes}。beats 每项为 {type:'action'|'dialogue',speaker?,text}。"
  ].join("\n"), {
    ...payload,
    rejectedScene: scene,
    issues: scene.validation?.issues || []
  }, {
    temperature: 0.58,
    maxTokens: 2200,
    modelOverride: scriptModel,
    retryModel: repairModel
  });
  return normalizeSceneFragmentResult(result, payload, `${scriptModel}+scene-repair`);
}

async function generateTurnScene({ actions, changes, beatResult, outcome, ledgerUpdate } = {}) {
  const payload = sceneWriterPayload({ actions, changes, beatResult, outcome, ledgerUpdate });
  // 给 LLM 的版本去掉机械模板字段;本地兜底/修稿仍用完整 payload。
  const llmPayload = { ...payload, actorPlans: (payload.actorPlans || []).map(actorPlanForLLM) };
  let scene = null;
  if (apiKey && (payload.actorPlans || []).length) {
    try {
      const result = await callJsonLLM([
        `你是 Agent Society 的 Scene Writer。你不负责决定角色行动,只负责把本轮 agent plans 写成观众可读的${sceneLangWord}短剧片段。`,
        langDirective,
        "输入里的 actorPlans 是角色的意图、战术、筹码和台词草稿; beatContract 是本轮戏剧合约; story ledger 是已经发生过的事实。",
        "本轮核心是 selectedEvidenceAtom。要让这条证据通过具体的动作、反应和台词的言外之意自然显露——观众能感到它伤害谁、帮助谁、改变什么,但【角色绝不能逐字背出证据的描述文字,也不要直白报出它的'作用'】。证据是被使用、被回避、被争夺的东西,不是被朗读的说明书。",
        "你要把 dialogueIntent、whatToReveal、whatToHide、subtext 写成自然对白,不能照抄任何字段原文。【潜台词必须藏在话里】——用暗示、回避、反话来表达,绝不能让角色自我点破(像'这羞耻已经摊开了''我其实在隐瞒X''我要夺回尊严'这种直说,要改成具体的言行去暗示)。",
        "严禁把系统总结句写进台词或舞台说明,例如:'它会伤害X,帮助Y'、'让X的选择空间变窄'、'改变了角色之间的关系和权力平衡'、'让X自己说话'。这些必须改写成具体的人话和动作。",
        "角色之间必须用真实姓名互相称呼(cast.name)。绝不能把'政治家''数学家''文学家'这类身份词当成人名写进台词或动作(例如不要写'政治家的公文包',要写'Richard 的公文包')。",
        "每个片段必须有:1 个可见动作、至少 2 句角色对白、1 个新事实/权力/关系变化。台词要具体到证据内容、代价或交换条件。",
        "若本轮张力已到临界,鼓励让角色完成一个不可逆的行动(动手、自戕、逃走、彻底决裂),而不是无限对峙、反复亮刀却谁也不动。戏要往前走,不要原地僵持。",
        "禁止输出系统工作台文字:戏剧Beat、戏剧问题、焦点物件、建议动作、本回合变化、quality、action_type、target_object_id、target_evidence_id、我现在就用。",
        "禁止日志腔:不要写'对某物执行某动作'、'伸手操作某物'、'让争论落到对象上'、'摆到台面上'、'这次我换个切口说'。",
        "只允许 cast 中的角色说话,不要新增人物对白。可以写环境动作,但不要发明会改变核心事实的新角色。",
        "严格输出 JSON:{title,stage,beats,turning_point,ledger_changes}。beats 每项为 {type:'action'|'dialogue',speaker?,text}。不要 Markdown。"
      ].join("\n"), llmPayload, {
        temperature: 0.72,
        maxTokens: 1400,
        modelOverride: scriptModel,
        retryModel: repairModel
      });
      scene = normalizeSceneFragmentResult(result, payload, scriptModel);
      if (!scene.validation.ok) {
        try {
          const repaired = await repairSceneFragment(scene, payload);
          if (repaired.validation.ok || repaired.validation.issues.length < scene.validation.issues.length) scene = repaired;
        } catch (error) {
          state.societyLog.push({
            kind: "scene_writer_repair_failed",
            message: (error.message || String(error)).slice(0, 240),
            turn: state.world.turn
          });
        }
      }
      // 只在 LLM 场景"证据缺失"这类硬伤时才回退本地;log_style_residue 这种小瑕疵
      // 交给最终 sanitizeFinalScriptMarkdown 逐行剔除即可,不值得丢掉整段 70B 散文。
      if (!scene.validation.ok && scene.validation.issues.some((issue) => ["missing_evidence_atom", "unbound_evidence"].includes(issue.type))) {
        const local = localSceneFragment(payload, "Scene Writer 未通过证据质量门,改用证据原子兜底场景。");
        if (local.validation.ok || local.validation.issues.length <= scene.validation.issues.length) {
          state.lastSceneWriterError = `validation_gate: ${scene.validation.issues.map((i) => i.type).join(",")}`;
          scene = local;
        }
      }
    } catch (error) {
      state.lastSceneWriterError = (error.message || String(error)).slice(0, 240);
      state.societyLog.push({
        kind: "scene_writer_failed",
        message: state.lastSceneWriterError,
        turn: state.world.turn
      });
    }
  }
  if (!scene) {
    scene = localSceneFragment(payload, apiKey ? "Scene Writer 调用失败,使用本地草稿。" : "剧本层未连接 API key。");
  }
  scene.markdown = renderSceneFragmentMarkdown(scene);
  scene.validation = validateSceneFragment(scene, payload);
  state.scriptScenes = [...(state.scriptScenes || []), scene].slice(-40);
  state.societyLog.push({
    kind: "scene_writer",
    model: scene.model,
    message: scene.validation.ok
      ? `成片场景已写入: ${scene.title}`
      : `成片场景写入,但仍有 ${scene.validation.issues.length} 个问题。`,
    validation: scene.validation,
    turn: state.world.turn
  });
  return pushDirectorEntry("成片场景", scene.markdown, {
    sceneWriter: true,
    sceneId: scene.id,
    model: scene.model,
    validation: scene.validation,
    ledgerUpdate
  });
}

const SCRIPT_FORBIDDEN_PHRASES = [
  "你刚才说",
  "把缺的那一段补上",
  "你刚才避开的那个点",
  "我问的不是态度",
  "先别绕开",
  "先别换题",
  "质量审计",
  "回合结算",
  "本场目标",
  "Beat Director",
  "戏剧Beat",
  "戏剧问题",
  "焦点物件",
  "建议动作",
  "本回合变化",
  "Agent Society",
  "action_type",
  "target_object_id",
  "target_evidence_id",
  "visible_behavior",
  "private_intent",
  "prompt",
  "我现在就用",
  "摆到台面",
  "换个切口",
  "伸手操作",
  "让争论落到"
];

const SCRIPT_TEMPLATE_PATTERNS = [
  /你刚才说[「『][^」』]{0,220}[」』]不够/,
  /把缺的那一段补上/,
  /你刚才避开的那个点/,
  /我问的不是态度/,
  /先别绕开/,
  /先别换题/,
  /质量审计|回合结算|本场目标|Beat Director|戏剧Beat|戏剧问题|焦点物件|建议动作|本回合变化|action_type|target_object_id|target_evidence_id|visible_behavior|private_intent|Agent Society|伸手操作|摆到台面|换个切口|让争论落到/i
];

function scriptForbiddenHits(text) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  return SCRIPT_FORBIDDEN_PHRASES.filter((phrase) => {
    const value = String(phrase);
    return /[a-z_ ]/i.test(value) ? lower.includes(value.toLowerCase()) : source.includes(value);
  });
}

function isTemplateResidue(text) {
  const source = String(text || "");
  return SCRIPT_TEMPLATE_PATTERNS.some((pattern) => pattern.test(source));
}

function cleanScriptSourceText(value, { dropTemplate = false, max = 520 } = {}) {
  let text = String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";
  const templateLike = isTemplateResidue(text);
  text = text
    .replace(/[^。！？\n]{0,90}你刚才说[「『][^」』]{0,220}[」』]不够。?把缺的那一段补上。?/g, "")
    .replace(/[^。！？\n]{0,90}你刚才避开的那个点[^。！？\n]{0,160}[。！？]?/g, "")
    .replace(/[^。！？\n]{0,90}我问的不是态度[^。！？\n]{0,160}[。！？]?/g, "")
    .replace(/[^。！？\n]{0,80}先别绕开[^。！？\n]{0,160}[。！？]?/g, "")
    .replace(/[^。！？\n]{0,80}先别换题[^。！？\n]{0,160}[。！？]?/g, "")
    .replace(/质量审计\s*\d*\/?\d*[:：]?/g, "")
    .replace(/\b(action_type|visible_behavior|private_intent|Agent Society)\b/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (dropTemplate && (templateLike || scriptForbiddenHits(text).length > 0) && text.length < 16) return "";
  if (dropTemplate && templateLike && !text) return "";
  return text.slice(0, max);
}

function scriptActionVerb(actionType) {
  const verbs = {
    speak: "开口试探",
    observe: "观察现场",
    inspect: "检查线索",
    search: "搜寻物件",
    challenge: "逼问对方",
    reveal_secret: "揭开秘密",
    negotiate: "提出交换",
    move: "移动位置",
    follow: "跟随对方",
    take_item: "拿起关键物件",
    use_item: "使用关键物件",
    use: "使用关键物件",
    protect: "保护自己在意的东西",
    sabotage: "暗中破坏",
    confess: "承认隐情"
  };
  return verbs[actionType] || "采取行动";
}

function scriptSignalForAgentEntry(entry, cleanedSpeech) {
  const agent = state.agents.find((item) => item.id === entry.agentId);
  if (entry.concreteAction) return entry.concreteAction;
  const parts = [`${entry.agentName || agent?.name || "角色"}${scriptActionVerb(entry.actionType)}`];
  const targetName = entry.targetAgentId ? agentDisplayName(entry.targetAgentId) : (entry.target || "");
  if (targetName) parts.push(`对象: ${targetName}`);
  if (agent?.shortTermGoal) parts.push(`欲望: ${agent.shortTermGoal}`);
  if (entry.sceneEffect) {
    const effect = cleanScriptSourceText(entry.sceneEffect, { max: 160 });
    if (effect) parts.push(`结果: ${effect}`);
  }
  return parts.join("; ");
}

function shouldSkipScriptDirectorEntry(entry) {
  if (entry.meta?.stateSummary || entry.meta?.openingBrief || entry.meta?.finalScript) return true;
  if (entry.type !== "director") return false;
  if (entry.meta?.ambient && !entry.text) return true;
  const title = String(entry.title || "");
  if (/质量审计|回合结算|最终剧本/.test(title)) return true;
  return false;
}

function transcriptForScriptSource(limit = 110) {
  const source = [];
  for (const entry of (state.transcript || []).slice(-limit * 2)) {
    if (shouldSkipScriptDirectorEntry(entry)) continue;
    if (entry.type === "director") {
      const text = cleanScriptSourceText(entry.text, { dropTemplate: true, max: 700 });
      const dialogueLines = (entry.meta?.dialogueLines || [])
        .map((line) => ({
          speaker: line.speaker_agent_id ? agentDisplayName(line.speaker_agent_id) : cleanScriptSourceText(line.speaker || "", { max: 40 }),
          line: cleanScriptSourceText(line.line || "", { dropTemplate: true, max: 220 })
        }))
        .filter((line) => line.line);
      if (!text && dialogueLines.length === 0) continue;
      source.push({
        type: "stage_event",
        title: cleanScriptSourceText(entry.title, { max: 80 }),
        text,
        clock: entry.clock,
        eventType: entry.meta?.eventType || null,
        dramaBeat: entry.meta?.beat || null,
        dialogueLines
      });
      continue;
    }
    const speech = cleanScriptSourceText(entry.speech, { dropTemplate: true, max: 360 });
    const visibleBehavior = cleanScriptSourceText(entry.visibleBehavior, { dropTemplate: true, max: 260 });
    const sceneEffect = cleanScriptSourceText(entry.sceneEffect, { dropTemplate: true, max: 260 });
    const scriptSignal = scriptSignalForAgentEntry(entry, speech);
    if (!speech && !visibleBehavior && !sceneEffect && !scriptSignal) continue;
    source.push({
      type: "character_action",
      character: entry.agentName,
      role: entry.role,
      actionType: entry.actionType,
      target: entry.targetAgentId ? agentDisplayName(entry.targetAgentId) : (entry.target || null),
      tactic: entry.tactic || "",
      concreteAction: entry.concreteAction || "",
      targetObjectId: entry.targetObjectId || "",
      targetEvidenceId: entry.targetEvidenceId || "",
      evidenceAction: entry.evidenceAction || "",
      risk: entry.risk || "",
      intendedStateChange: entry.intendedStateChange || "",
      dialogueIntent: entry.dialogueIntent || "",
      leverage: entry.leverage || "",
      whatToReveal: entry.whatToReveal || "",
      whatToHide: entry.whatToHide || "",
      subtext: entry.subtext || "",
      dramaBeatId: entry.dramaBeatId || "",
      speech,
      visibleBehavior,
      sceneEffect,
      clock: entry.clock,
      simulation: entry.simulation || null,
      scriptSignal,
      sourceQuality: entry.speech && !speech ? "template_dialogue_removed" : "usable"
    });
  }
  return source.slice(-limit);
}

function scriptDramaticSignals() {
  const suspicionPairs = [];
  for (const agent of state.agents || []) {
    for (const [targetId, value] of Object.entries(agent.suspicions || {})) {
      if (Number(value) >= 60) suspicionPairs.push(`${agent.name} 怀疑 ${agentDisplayName(targetId)}(${value})`);
    }
  }
  const recentIssues = (state.metrics?.qualityAudits || [])
    .slice(-4)
    .flatMap((audit) => (audit.issues || []).map((issue) => issue.type))
    .filter(Boolean);
  return {
    activeEvent: state.world.activeEvent || null,
    emergentFocus: (state.world.emergentFocus || []).slice(-8),
    highSuspicion: suspicionPairs.slice(0, 8),
    beatHistory: (state.director?.beatHistory || []).slice(-8).map((beat) => ({
      actLabel: beat.actLabel,
      title: beat.title,
      status: beat.status,
      requiredChange: beat.requiredChange,
      resolution: beat.resolution,
      focusObjectLabel: beat.focusObjectLabel,
      focusAgentName: beat.focusAgentName
    })),
    qualityProblemsToRewriteAway: [...new Set(recentIssues)].slice(0, 8)
  };
}

function finalScriptPayload() {
  const allowedCharacterNames = state.agents.map((agent) => agent.name);
  return {
    scenario: state.scenario,
    world: {
      clock: minutesToClock(state.world.minutes),
      plotStage: state.world.plotStage,
      weather: state.world.weather,
      temperature: state.world.temperature,
      light: state.world.light,
      dangerLevel: state.world.dangerLevel,
      threatLevel: state.world.threatLevel,
      facts: state.world.facts.slice(-10),
      revealedClues: state.world.revealedClues.slice(-12),
      evidenceAtoms: (state.world.evidenceAtoms || []).map(evidenceLedgerView).slice(0, 30),
      deadlines: (state.world.deadlines || []).map((d) => ({ label: d.label, clock: minutesToClock(d.atMinutes), fired: !!d.fired }))
    },
    cast: state.agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      publicIdentity: agent.publicIdentity,
      hiddenIdentity: agent.hiddenIdentity,
      shortTermGoal: agent.shortTermGoal,
      longTermGoal: agent.longTermGoal,
      currentAction: agent.currentAction,
      nextIntendedAction: agent.nextIntendedAction,
      revealedSecrets: (agent.secrets || []).filter((secret) => secret.revealed).map((secret) => ({ label: secret.label, content: secret.content }))
    })),
    keyItems: (state.world.items || []).slice(0, 14).map((item) => ({
      label: item.label,
      holder: item.holder ? agentDisplayName(item.holder) : null,
      location: item.location ? stateLocLabel(item.location) : null,
      discoveredBy: (item.discoveredBy || []).map(agentDisplayName),
      hidden: !!item.hidden,
      possibleActions: (item.possibleActions || []).slice(0, 6),
      state: item.state || "",
      lastAction: item.lastAction || "",
      stakes: item.stakes || ""
    })),
    transcript: transcriptForScriptSource(),
    scriptScenes: (state.scriptScenes || []).map((scene) => ({
      title: scene.title,
      turn: scene.turn,
      clock: scene.clock,
      markdown: scene.markdown,
      turningPoint: scene.turningPoint,
      validation: scene.validation || null
    })).slice(-20),
    storyLedger: state.storyLedger || null,
    dramaticSignals: scriptDramaticSignals(),
    scriptRules: {
      allowedCharacterNames,
      forbiddenPhrases: SCRIPT_FORBIDDEN_PHRASES,
      targetShape: "3-5 个连续场景;每场要有进入状态、冲突升级、信息变化或选择后果;台词必须服务角色目标。",
      rewritePrinciple: "把推演日志当素材,不要照抄机械台词;未知人物不得进入对白。"
    }
  };
}

function canonicalScriptSpeaker(value, payload) {
  const raw = String(value || "").trim().replace(/[:：]$/, "");
  if (!raw) return "";
  const exact = payload.cast.find((agent) => agent.name === raw);
  if (exact) return exact.name;
  const compact = normalizeForSimilarity(raw);
  const byAlias = payload.cast.find((agent) => {
    const name = normalizeForSimilarity(agent.name);
    const role = normalizeForSimilarity(agent.role);
    return (compact.length >= 2 && (name.includes(compact) || compact.includes(name))) || compact === role;
  });
  return byAlias ? byAlias.name : "";
}

function scriptSceneHeading(value, index) {
  const raw = cleanScriptSourceText(value, { max: 70 });
  if (raw) return raw.replace(/^#+\s*/, "");
  if (outputLang === "en") return `Scene ${index + 1}`;
  const names = ["场景一", "场景二", "场景三", "场景四", "场景五"];
  return names[index] || `场景${index + 1}`;
}

// 建立「身份词 → 角色名」映射:仅当某身份词唯一对应一名角色时才纳入,
// 用于把成片里漏出来的「数学家破解了密码」改回「Karl Weiss 破解了密码」。
function buildRoleNameMap(cast) {
  const roleWord = /数学家|文学家|政治家|科学家|工程主管|工程师|医生|律师|记者|警官|法医|指挥官|队长|船长|教授|侦探|护士|司机|老板|秘书|董事长|总裁|法务/g;
  const tally = new Map(); // word -> Set(name)
  for (const agent of cast || []) {
    const text = `${agent.role || ""} ${agent.archetype || ""} ${agent.publicIdentity || ""}`;
    for (const word of new Set(text.match(roleWord) || [])) {
      if (!tally.has(word)) tally.set(word, new Set());
      tally.get(word).add(agent.name);
    }
  }
  const map = [];
  for (const [word, names] of tally) {
    if (names.size === 1) map.push({ word, name: [...names][0] });
  }
  // 长词优先替换,避免「工程师」先被「工程」类短词截断
  return map.sort((a, b) => b.word.length - a.word.length);
}

function replaceRoleWordsWithNames(line, roleMap) {
  let out = line;
  for (const { word, name } of roleMap) {
    // name 本身含该身份词时绝不替换,否则会把"王法医"里的"法医"换成"王法医"→"王王法医"递归翻倍。
    if (word === name || name.includes(word) || !out.includes(word)) continue;
    // 跳过「是/做/当/作为/一名/这位…+身份词」这类泛指用法,只改把身份词当人名主语/所属的情形
    out = out.replace(new RegExp(`(?<![是做当名位的一这那个]|作为)${word}`, "g"), name);
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 角色说自己的台词时,把对自己的全名引用改成「我/我的」(避免"事故前 Karl 曾尝试…"这种第三人称自指)。
function fixSelfReferenceInDialogue(text, speakerName) {
  if (outputLang === "en") return text; // 英文模式不注入中文「我/我的」
  if (!speakerName || !text.includes(speakerName)) return text;
  const n = escapeRegExp(speakerName);
  return text
    .replace(new RegExp(`${n}\\s*的`, "g"), "我的")
    .replace(new RegExp(n, "g"), "我");
}

// 舞台说明里「Karl 拿出 Karl 的日记」式重复自指 → 「Karl 拿出 自己的 日记」。
function fixSelfReferenceInStage(text, names) {
  if (outputLang === "en") return text; // 英文模式不注入中文「自己的」
  let out = text;
  for (const name of names) {
    if (!name) continue;
    const n = escapeRegExp(name);
    // 同一行内该名字出现两次以上时,把第二次起的「名字的」压成「自己的」(容忍名字与"的"间的空格)
    out = out.replace(new RegExp(`(${n}[^。\\n]*?)${n}\\s*的`, "g"), "$1自己的");
  }
  return out;
}

function sanitizeFinalScriptMarkdown(markdown, payload) {
  const allowed = new Set(payload.cast.map((agent) => agent.name));
  const castNames = payload.cast.map((agent) => agent.name).filter(Boolean);
  const roleMap = buildRoleNameMap(payload.cast);
  const output = [];
  for (const rawLine of String(markdown || "").split(/\n/)) {
    let line = rawLine.trimEnd();
    if (!line.trim()) {
      if (output[output.length - 1] !== "") output.push("");
      continue;
    }
    if (scriptForbiddenHits(line).length > 0 || isTemplateResidue(line)) continue;
    const speaker = /^\*\*([^*\n]{1,48})\*\*[:：]/.exec(line);
    let speakerName = speaker ? speaker[1].trim() : "";
    if (speaker && !allowed.has(speakerName)) {
      const canonical = canonicalScriptSpeaker(speaker[1], payload);
      if (!canonical) continue;
      line = line.replace(speaker[1], canonical);
      speakerName = canonical;
    }
    // 人物表(- **名**（角色）)和标题行保留身份词;其余正文把漏出的身份词改回人名。
    if (!/^#/.test(line) && !/^- \*\*/.test(line)) {
      line = replaceRoleWordsWithNames(line, roleMap);
    }
    // 对白:把说话人对自己的全名引用改成「我/我的」(只改台词正文,不动 **说话人** 标签)。
    if (speakerName && allowed.has(speakerName)) {
      const m = /^(\*\*[^*\n]{1,48}\*\*[:：]\s*)([\s\S]*)$/.exec(line);
      if (m) line = m[1] + fixSelfReferenceInDialogue(m[2], speakerName);
    } else if (/^[*_]/.test(line) || !speaker) {
      // 舞台说明行:压掉重复自指
      line = fixSelfReferenceInStage(line, castNames);
    }
    line = cleanScriptSourceText(line, { max: 900 });
    if (line) output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderStructuredFinalScript(result, payload) {
  const en = outputLang === "en";
  const L = en
    ? { logline: "**Logline**: ", background: "## Background", characters: "## Characters", wants: " — wants: ", open: " (", close: ")", colon: ": ", epilogue: "## Epilogue" }
    : { logline: "**一句话梗概**：", background: "## 故事背景", characters: "## 人物", wants: " 眼下想要：", open: "（", close: "）", colon: "：", epilogue: "## 尾声" };
  const title = cleanScriptSourceText(result.title || payload.scenario.title || "最终剧本", { max: 80 }) || "最终剧本";
  const logline = cleanScriptSourceText(result.logline || payload.scenario.premise || payload.scenario.centralConflict || "", { max: 220 });
  const background = cleanScriptSourceText(result.background || payload.scenario.premise || "", { max: 600 });
  const lines = [
    `# ${title}`,
    ""
  ];
  if (logline) lines.push(`${L.logline}${logline}`, "");
  if (background) lines.push(L.background, "", background, "");
  lines.push(L.characters);
  for (const agent of payload.cast) {
    const identity = cleanScriptSourceText(agent.publicIdentity || agent.role || "", { max: 120 });
    const goal = cleanScriptSourceText(agent.shortTermGoal || "", { max: 120 });
    lines.push(`- **${agent.name}**${L.open}${agent.role}${L.close}${L.colon}${identity}${goal ? `${L.wants}${goal}` : ""}`);
  }
  lines.push("");

  const scenes = Array.isArray(result.scenes) ? result.scenes.slice(0, 5) : [];
  if (!scenes.length && result.script_markdown) {
    return sanitizeFinalScriptMarkdown(result.script_markdown, payload);
  }
  if (!scenes.length) return "";
  for (const [index, scene] of scenes.entries()) {
    lines.push(`## ${scriptSceneHeading(scene.heading || scene.title, index)}`);
    const stage = cleanScriptSourceText(scene.stage || scene.entry_state || scene.setting || "", { dropTemplate: true, max: 420 });
    if (stage) lines.push(`*${stage}*`, "");
    const beats = Array.isArray(scene.beats) ? scene.beats : [];
    for (const beat of beats.slice(0, 18)) {
      const type = String(beat.type || beat.kind || "").toLowerCase();
      const text = cleanScriptSourceText(beat.text || beat.line || beat.action || beat.stage || "", { dropTemplate: true, max: 420 });
      if (!text) continue;
      if (type.includes("dialogue") || beat.speaker) {
        const speaker = canonicalScriptSpeaker(beat.speaker, payload);
        if (!speaker) continue;
        lines.push(`**${speaker}**${dlgColon}${text}`, "");
      } else {
        lines.push(`*${text}*`, "");
      }
    }
    // 不再渲染每场末尾的 turning_point——它常被模型写成"逼迫X必须…/改变了权力平衡"这类分析腔总结句,
    // 读起来像导演解说、AI 味重。让每场收在最后一个动作/对白上,更像真正的剧本。终局留给 ## 尾声。
  }
  const ending = cleanScriptSourceText(result.ending || result.aftertaste || "", { dropTemplate: true, max: 420 });
  if (ending) lines.push(L.epilogue, "", `*${ending}*`, "");
  return sanitizeFinalScriptMarkdown(lines.join("\n"), payload);
}

function localTranscriptChunks(payload) {
  const usable = payload.transcript.filter((entry) => {
    if (entry.type === "stage_event") return entry.text || entry.dialogueLines?.length;
    return entry.speech || entry.visibleBehavior || entry.sceneEffect || entry.scriptSignal;
  });
  const sceneCount = Math.max(1, Math.min(4, Math.ceil(usable.length / 8)));
  const chunkSize = Math.max(1, Math.ceil(usable.length / sceneCount));
  const chunks = [];
  for (let i = 0; i < usable.length; i += chunkSize) chunks.push(usable.slice(i, i + chunkSize));
  return chunks.length ? chunks : [[]];
}

function localScriptActionLine(entry) {
  if (entry.concreteAction) return entry.concreteAction;
  if (entry.visibleBehavior) return entry.visibleBehavior;
  const target = entry.target ? `，目光落在${entry.target}身上` : "";
  const effect = entry.sceneEffect ? ` ${entry.sceneEffect}` : "";
  return `${entry.character}${target}${scriptActionVerb(entry.actionType)}。${effect}`.replace(/\s+/g, " ").trim();
}

function renderLocalFinalScript() {
  const payload = finalScriptPayload();
  const title = payload.scenario.title || "未命名剧本";
  const lines = [
    `# ${title}`,
    "",
    `**一句话梗概**：${payload.scenario.premise || payload.scenario.centralConflict || "几个角色在压力下互相试探,局面逐步失控。"}`,
    "",
    "## 人物",
    ...payload.cast.map((agent) => `- **${agent.name}**（${agent.role}）：${agent.publicIdentity || ""} 目标：${agent.shortTermGoal || "未说明"}`),
    "",
    "## 场景一",
    `*${payload.scenario.place || "现场"}。${payload.world.weather || ""}${payload.world.light ? `，${payload.world.light}` : ""}。*`,
    ""
  ];
  const chunks = localTranscriptChunks(payload);
  chunks.forEach((chunk, sceneIndex) => {
    if (sceneIndex > 0) lines.push(`## 场景${sceneIndex + 1}`, "");
    for (const entry of chunk) {
      if (entry.type === "stage_event") {
        if (entry.text) lines.push(`*${entry.text}*`, "");
        for (const line of entry.dialogueLines || []) {
          const speaker = canonicalScriptSpeaker(line.speaker, payload);
          if (speaker && line.line) lines.push(`**${speaker}**${dlgColon}${line.line}`, "");
        }
      } else {
        const actionLine = localScriptActionLine(entry);
        if (actionLine) lines.push(`*${actionLine}*`);
        if (entry.speech) lines.push(`**${entry.character}**：${entry.speech}`);
        if (entry.sceneEffect) lines.push(`*${entry.sceneEffect}*`);
        if (entry.speech || entry.visibleBehavior || entry.sceneEffect || entry.scriptSignal) lines.push("");
      }
    }
  });
  lines.push("## 余波", "");
  const finalFocus = (state.world.emergentFocus || []).slice(0, 4);
  if (finalFocus.length) lines.push(...finalFocus.map((item) => `- ${item}`));
  else lines.push("- 冲突还没有彻底解决,但每个人的目标已经开始互相咬合。");
  return sanitizeFinalScriptMarkdown(lines.join("\n").replace(/\n{3,}/g, "\n\n"), payload);
}

async function writeFinalScript(markdown, meta = {}) {
  await mkdir(finalScriptDir, { recursive: true });
  const title = slugifyId(state.scenario?.title, "script");
  const id = `${nowIso().replace(/[:.]/g, "-")}-${title}-${Math.random().toString(16).slice(2, 8)}`;
  const fileName = `${id}.md`;
  const file = `final-scripts/${fileName}`;
  const body = `${markdown.trim()}\n\n---\n生成时间: ${nowIso()}\n模型: ${meta.model || "local"}\n来源: 推演记录\n`;
  await writeFile(join(finalScriptDir, fileName), body, "utf8");
  return { id, file, createdAt: nowIso() };
}

function renderScriptScenesFinalMarkdown() {
  const scenes = (state.scriptScenes || []).filter((scene) => scene && scene.beats?.length);
  const lines = [
    `# ${state.scenario.title || "最终剧本"}`,
    ""
  ];
  const logline = state.scenario.premise || state.scenario.centralConflict || state.scenario.sceneGoal || "";
  if (logline) lines.push(`**一句话梗概**：${cleanScriptSourceText(logline, { max: 220 })}`, "");
  lines.push("## 人物");
  for (const agent of state.agents || []) {
    const identity = cleanScriptSourceText(agent.publicIdentity || agent.role || "", { max: 120 });
    const goal = cleanScriptSourceText(agent.shortTermGoal || "", { max: 120 });
    lines.push(`- **${agent.name}**（${agent.role}）：${identity}${goal ? ` 眼下想要：${goal}` : ""}`);
  }
  lines.push("");
  scenes.forEach((scene, index) => {
    lines.push(`## 场景${index + 1} · ${cleanScriptSourceText(scene.title || "", { max: 80 }) || `第 ${scene.turn} 回合`}`, "");
    const body = renderSceneFragmentMarkdown(scene, { includeHeading: false });
    if (body) lines.push(body, "");
  });
  const last = scenes[scenes.length - 1];
  const ending = last?.turningPoint || (state.storyLedger?.lastTurnSummary || [])[0] || "";
  if (ending) lines.push("## 尾声", "", `*${cleanScriptSourceText(ending, { max: 420 })}*`, "");
  return sanitizeFinalScriptMarkdown(lines.join("\n"), finalScriptPayload());
}

async function generateFinalScriptFromScriptScenes(payload) {
  const scriptScenes = (state.scriptScenes || []).filter((scene) => scene && scene.markdown);
  if (!scriptScenes.length) return null;
  let markdown = "";
  let logline = "";
  let notes = [];
  let usedModel = "script-scenes-local";

  if (apiKey) {
    try {
      const result = await callJsonLLM([
        `你是剧本总编。下面已经有每轮 Scene Writer 写出的成片场景,请把它们整理成一个连贯、好读的${sceneLangWord}短剧。`,
        langDirective,
        "只使用 scriptScenes、cast、storyLedger 和 scenario。不要回到 raw transcript 里照抄 agent 草稿。",
        "保留每场的信息变化和因果,压缩重复,补足自然转场。不要出现系统词、字段名、戏剧Beat、焦点物件、建议动作。",
        "ending 忠实呈现这一次【实际发生了什么】:可能是某人被杀/自尽/逃离/彻底决裂,也可能是没有人跨出不可逆的一步——后者(一次明确的拒绝、一场持续的对峙、一段已改变却未断的关系)同样是合法、完整的结局,不要因为'没死人'就把它当失败或硬补一个死。【绝不许凭空发明剧中没有任何角色做过的死或事件】。若这一次没有落定,就如实写出那个未决状态本身;既不要硬凑假死,也不要用'即将/血光在所难免/一触即发/仇恨在发酵'这类预告把它伪装成有结局。",
        "background = 幕启之前已经发生的前情(3–5 句):交代地点、人物关系、以及此刻这一幕为何如此紧张,让没读过原著的观众也能立刻看懂。只写已发生的背景,不剧透角色的隐藏心思、也不预告结局。",
        "严格输出 JSON:{title,logline,background,scenes,ending,craft_notes[]}。scenes 每项:{heading,stage,beats,turning_point}; beats 每项:{type:'action'|'dialogue',speaker?,text}。不要 Markdown。"
      ].join("\n"), {
        scenario: payload.scenario,
        cast: payload.cast,
        world: payload.world,
        keyItems: payload.keyItems,
        storyLedger: compactLedgerForScene(state.storyLedger),
        // 只送 beats(成片素材),不送 markdown(会让输入翻倍);最多取最近 10 场,控制在 Groq 12k TPM 内。
        scriptScenes: scriptScenes.slice(-10).map((scene) => ({
          title: scene.title,
          turn: scene.turn,
          clock: scene.clock,
          stage: scene.stage,
          beats: scene.beats,
          turningPoint: scene.turningPoint
        })),
        scriptRules: payload.scriptRules
      }, {
        temperature: 0.66,
        maxTokens: 4000,
        modelOverride: scriptModel,
        retryModel: repairModel,
        maxRetries: 4 // 总编是质量核心:多给重试(配合多 key 轮换),尽量别掉到本地中文地板
      });
      markdown = renderStructuredFinalScript(result, payload);
      logline = String(result.logline || "").trim();
      notes = Array.isArray(result.craft_notes) ? result.craft_notes.map(String).slice(0, 6) : [];
      usedModel = `${scriptModel}+script-scenes`;
    } catch (error) {
      state.societyLog.push({
        kind: "final_script_scenes_llm_failed",
        message: (error.message || String(error)).slice(0, 240),
        turn: state.world.turn
      });
    }
  }

  if (!markdown) {
    markdown = renderScriptScenesFinalMarkdown();
    logline = state.scenario.premise || state.scenario.centralConflict || "";
  }

  markdown = sanitizeFinalScriptMarkdown(markdown, payload);
  let validation = validateFinalScriptQuality(markdown, payload);
  if (!validation.ok && apiKey) {
    try {
      const repaired = await repairFinalScriptFromScriptScenes(markdown, payload, validation);
      const repairedValidation = validateFinalScriptQuality(repaired.markdown, payload);
      if (repaired.markdown && repairedValidation.issues.length < validation.issues.length) {
        markdown = repaired.markdown;
        validation = repairedValidation;
        logline = repaired.logline || logline;
        notes = [...notes, ...repaired.notes].slice(0, 8);
        usedModel = `${usedModel}+repair`;
      }
    } catch (error) {
      state.societyLog.push({
        kind: "final_script_scenes_repair_failed",
        message: (error.message || String(error)).slice(0, 240),
        turn: state.world.turn
      });
    }
  }

  const fileInfo = await writeFinalScript(markdown, { model: usedModel });
  const info = {
    ...fileInfo,
    title: state.scenario.title || "最终剧本",
    logline,
    model: usedModel,
    notes,
    validation,
    markdown
  };
  state.finalScript = info;
  pushDirectorEntry("最终剧本", markdown, {
    finalScript: true,
    file: info.file,
    logline,
    notes,
    source: "scriptScenes"
  });
  state.societyLog.push({
    kind: "final_script_generated",
    message: validation.ok
      ? `最终剧本已由成片场景生成: ${info.file}`
      : `最终剧本已由成片场景生成,但仍有 ${validation.issues.length} 个可改进点: ${info.file}`,
    path: info.file,
    validation,
    turn: state.world.turn
  });
  return info;
}

async function repairFinalScriptFromScriptScenes(markdown, payload, validation) {
  const result = await callJsonLLM([
    "你是剧本总编修稿人。下面的最终剧本由每轮 Scene Writer 片段整理而来,但没有通过质量检查。",
    "只能使用 scriptScenes、cast、scenario、storyLedger。不要使用 raw transcript,不要照抄 agent 草稿。",
    "必须修复 issues:对白太少就补足角色间交换;结构太平就把场景转折写清;有系统痕迹就删除。",
    "严禁出现系统词、字段名、戏剧Beat、焦点物件、建议动作、我现在就用。",
    "严格输出 JSON:{title,logline,scenes,ending,craft_notes[]}。scenes 每项:{heading,stage,beats,turning_point}; beats 每项:{type:'action'|'dialogue',speaker?,text}。不要 Markdown。"
  ].join("\n"), {
    scenario: payload.scenario,
    cast: payload.cast,
    world: payload.world,
    keyItems: payload.keyItems,
    storyLedger: payload.storyLedger || state.storyLedger,
    scriptScenes: payload.scriptScenes,
    rejectedMarkdown: markdown,
    issues: validation.issues,
    scriptRules: payload.scriptRules
  }, {
    temperature: 0.54,
    maxTokens: 4400,
    modelOverride: scriptModel,
    retryModel: repairModel
  });
  return {
    markdown: renderStructuredFinalScript(result, payload),
    logline: cleanScriptSourceText(result.logline || "", { max: 220 }),
    notes: Array.isArray(result.craft_notes) ? result.craft_notes.map(String).slice(0, 4) : [],
    model: `${scriptModel}+script-scenes-repair`
  };
}

async function generateFinalScript() {
  if (!state || state.empty) throw new Error("请先创建场景并推进一些回合。");
  const payload = finalScriptPayload();
  const fromScenes = await generateFinalScriptFromScriptScenes(payload);
  if (fromScenes) return fromScenes;
  let markdown = "";
  let logline = "";
  let notes = [];
  let usedModel = "local";
  let validation = null;
  if (apiKey && payload.transcript.length >= 2) {
    try {
      const result = await callJsonLLM([
        "你是专业编剧,不是日志整理器。把 Agent Society 的原始推演素材重写成人类愿意读的中文短剧。",
        "关键原则:只使用 payload.scriptRules.allowedCharacterNames 里的角色做对白;不要新增人物。若素材里出现未知名字,改成环境动作或删去。",
        "不要照抄机械逼问、质量审计、系统提示、fallback 模板。尤其不能出现 payload.scriptRules.forbiddenPhrases 中的任何短语。",
        "每个角色的台词必须服务他的短期目标、秘密或恐惧。每句台词要推进:给出事实、逼出代价、提出交换、暴露选择、改变关系,不要空泛绕圈。",
        "优先使用 transcript 中的 tactic/concreteAction/intendedStateChange/keyItems.state 来构造戏剧动作;不要把 action_type 当成剧情本身。",
        "dramaticSignals.beatHistory 是结构参考:用它决定每场的功能和转折,但不要在剧本文本里写'Beat Director'或'戏剧Beat'。",
        "把重复对话压缩成 3-5 个连续场景。每场都要有:进入状态、冲突升级、信息变化或不可逆选择。用具体动作和物件承接因果。",
        "允许补足自然转场和潜台词,但不要改变核心事实、已揭示秘密、截止时间和关键物件归属。",
        "严格输出 JSON:{title, logline, scenes, ending, craft_notes[]}。scenes 是数组,每项:{heading, stage, beats, turning_point}; beats 每项:{type:'action'|'dialogue', speaker?, text}。不要返回 Markdown。总长度控制在 2200 中文字以内。"
      ].join("\n"), payload, {
        temperature: 0.78,
        maxTokens: 4200,
        modelOverride: scriptModel,
        retryModel: repairModel
      });
      markdown = renderStructuredFinalScript(result, payload);
      logline = String(result.logline || "").trim();
      notes = Array.isArray(result.craft_notes) ? result.craft_notes.map(String).slice(0, 6) : [];
      usedModel = scriptModel;
    } catch (error) {
      state.societyLog.push({
        kind: "final_script_fallback",
        message: `剧本模型生成失败,使用本地整理: ${error.message || String(error)}`,
        turn: state.world.turn
      });
    }
  }
  if (!markdown) {
    markdown = renderLocalFinalScript();
    logline = state.scenario.premise || state.scenario.centralConflict || "";
  }
  validation = validateFinalScriptQuality(markdown, payload);
  if (!validation.ok && apiKey && payload.transcript.length >= 2) {
    try {
      const repaired = await repairFinalScript(markdown, payload, validation);
      const repairedValidation = validateFinalScriptQuality(repaired.markdown, payload);
      if (repaired.markdown && (repairedValidation.ok || repairedValidation.issues.length < validation.issues.length)) {
        markdown = repaired.markdown;
        logline = repaired.logline || logline;
        notes = [...notes, ...repaired.notes].slice(0, 8);
        usedModel = repaired.model || usedModel;
        validation = repairedValidation;
      }
    } catch (error) {
      state.societyLog.push({
        kind: "final_script_repair_failed",
        message: error.message || String(error),
        turn: state.world.turn
      });
    }
  }
  markdown = sanitizeFinalScriptMarkdown(markdown, payload);
  validation = validateFinalScriptQuality(markdown, payload);
  if (!markdown || (validation.issues || []).some((issue) => ["thin_dialogue", "too_short"].includes(issue.type))) {
    const localMarkdown = renderLocalFinalScript();
    const localValidation = validateFinalScriptQuality(localMarkdown, payload);
    if (localMarkdown && localValidation.issues.length < validation.issues.length) {
      markdown = localMarkdown;
      validation = localValidation;
      if (usedModel !== "local") usedModel = `${usedModel}+local-safety`;
    }
  }
  const fileInfo = await writeFinalScript(markdown, { model: usedModel });
  const info = {
    ...fileInfo,
    title: state.scenario.title || "最终剧本",
    logline,
    model: usedModel,
    notes,
    validation,
    markdown
  };
  state.finalScript = info;
  pushDirectorEntry("最终剧本", markdown, {
    finalScript: true,
    file: info.file,
    logline,
    notes
  });
  state.societyLog.push({
    kind: "final_script_generated",
    message: validation.ok
      ? `最终剧本已生成: ${info.file}`
      : `最终剧本已生成,但仍有 ${validation.issues.length} 个可改进点: ${info.file}`,
    path: info.file,
    validation,
    turn: state.world.turn
  });
  return info;
}

function countScriptScenes(markdown) {
  return (String(markdown || "").match(/^##\s*(场景|第一|第二|第三|第四|第五|开端|逼近|摊牌|尾声|终场)/gm) || []).length;
}

function validateFinalScriptQuality(markdown, payload) {
  const text = String(markdown || "");
  const issues = [];
  const forbidden = scriptForbiddenHits(text);
  if (forbidden.length) issues.push({ type: "system_residue", message: `仍有系统/模板痕迹: ${[...new Set(forbidden)].slice(0, 6).join("、")}` });
  if (/对「?[^」\n]{1,40}」?执行|伸手操作|摆到台面|换个切口|让争论落到|会比我们任何人的解释都诚实/.test(text)) {
    issues.push({ type: "log_style_residue", message: "仍有系统日志式表达,不像人类可读剧本。" });
  }
  const allowed = new Set(payload.cast.map((agent) => agent.name));
  const unknownSpeakers = [];
  for (const match of text.matchAll(/\*\*([^*\n]{1,48})\*\*[:：]/g)) {
    const speaker = match[1].trim();
    if (!allowed.has(speaker)) unknownSpeakers.push(speaker);
  }
  if (unknownSpeakers.length) issues.push({ type: "unknown_speaker", message: `出现未登记对白人物: ${[...new Set(unknownSpeakers)].slice(0, 5).join("、")}` });
  const dialogue = [...text.matchAll(/\*\*([^*\n]{1,48})\*\*[:：]\s*([^\n]+)/g)].map((m) => m[2].trim());
  if (payload.transcript.length >= 6 && dialogue.length < Math.max(4, payload.cast.length + 1)) {
    issues.push({ type: "thin_dialogue", message: "对白太少,读起来更像摘要。" });
  }
  if (payload.transcript.length >= 10 && countScriptScenes(text) < 2) {
    issues.push({ type: "flat_structure", message: "分场不足,缺少戏剧推进。" });
  }
  const repeated = [];
  for (let i = 1; i < dialogue.length; i++) {
    if (speechSimilarity(dialogue[i - 1], dialogue[i]) >= 0.58) repeated.push(dialogue[i].slice(0, 40));
  }
  if (repeated.length) issues.push({ type: "repetitive_dialogue", message: "相邻台词仍然相似,需要改写。" });
  if (payload.transcript.length >= 6 && normalizeForSimilarity(text).length < 260) {
    issues.push({ type: "too_short", message: "篇幅过短,没有承接推演素材。" });
  }
  return { ok: issues.length === 0, issues };
}

async function repairFinalScript(markdown, payload, validation) {
  const result = await callJsonLLM([
    "你是剧本修稿人。下面的剧本未通过质量检查,请重写成更像人写的短剧。",
    "必须修复所有 issues。严禁出现 forbiddenPhrases;严禁新增对白人物;删除机械逼问和系统痕迹。",
    "保留核心事实和角色目标,但把重复日志改成有潜台词、有动作、有转折的场景。",
    "严格输出 JSON:{title, logline, scenes, ending, craft_notes[]}。scenes 每项:{heading, stage, beats, turning_point}; beats 每项:{type:'action'|'dialogue', speaker?, text}。不要返回 Markdown。"
  ].join("\n"), {
    scenario: payload.scenario,
    cast: payload.cast,
    world: payload.world,
    keyItems: payload.keyItems,
    scriptRules: payload.scriptRules,
    transcript: payload.transcript,
    rejectedMarkdown: markdown,
    issues: validation.issues
  }, {
    temperature: 0.58,
    maxTokens: 4200,
    modelOverride: scriptModel,
    retryModel: repairModel
  });
  return {
    markdown: renderStructuredFinalScript(result, payload),
    logline: cleanScriptSourceText(result.logline || "", { max: 220 }),
    notes: Array.isArray(result.craft_notes) ? result.craft_notes.map(String).slice(0, 4) : [],
    model: `${scriptModel}+repair`
  };
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
  response.end(JSON.stringify(data, null, 2));
}

function sendError(response, error, status = 500) {
  sendJson(response, { error: error.message || String(error) }, status);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/agent-society.html";
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root)) {
    response.writeHead(403, corsHeaders);
    response.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream", ...corsHeaders });
    response.end(data);
  } catch {
    response.writeHead(404, corsHeaders);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/state" && request.method === "GET") {
      sendJson(response, publicState());
      return;
    }
    if (url.pathname === "/api/state/full" && request.method === "GET") {
      sendJson(response, state);
      return;
    }
    if (url.pathname === "/api/state/load" && request.method === "POST") {
      const snap = await parseBody(request);
      if (snap && typeof snap === "object" && !snap.empty) {
        state = snap;
        sendJson(response, { ok: true, turn: state.world && state.world.turn });
      } else {
        sendJson(response, { error: "invalid state snapshot" }, 400);
      }
      return;
    }
    if (url.pathname === "/api/reconstruct" && request.method === "POST") {
      try {
        const body = await parseBody(request);
        sendJson(response, reconstructEvent(body));
      } catch (err) {
        sendJson(response, { error: err.message || String(err) }, 400);
      }
      return;
    }
    // Narrate a witness's deliberation for the magistrate page. The page never holds a key:
    // it posts the deliberation the browser already computed, and this process — which does
    // hold one — returns the prose. With no key set, narrate.mjs falls back to its template
    // renderer, so the endpoint answers either way and the page never has to care.
    if (url.pathname === "/api/narrate" && request.method === "POST") {
      try {
        const body = await parseBody(request);
        const { renderLLM } = await import("./recon/narrate.mjs");
        const out = await renderLLM(body.witness, body.moves || [], body.ctx || {});
        sendJson(response, out);
      } catch (err) {
        sendJson(response, { error: err.message || String(err) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/presets" && request.method === "GET") {
      sendJson(response, { presets: listPresets() });
      return;
    }
    if (url.pathname === "/api/preset" && request.method === "GET") {
      const id = url.searchParams.get("id") || "";
      const p = getPreset(id);
      if (!p) { sendJson(response, { error: `preset ${id} not found` }, 404); return; }
      sendJson(response, p);
      return;
    }
    if (url.pathname === "/api/scenario-logs" && request.method === "GET") {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
      sendJson(response, { logs: await listScenarioLogs(limit) });
      return;
    }
    if (url.pathname === "/api/quality-audits" && request.method === "GET") {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));
      const audits = (state.metrics?.qualityAudits || []).slice(-limit).reverse();
      sendJson(response, { audits, last: state.metrics?.lastQualityAudit || null, guidance: state.director?.qualityGuidance || [] });
      return;
    }
    if (url.pathname === "/api/script/final" && request.method === "POST") {
      try {
        const script = await generateFinalScript();
        state.updatedAt = nowIso();
        sendJson(response, { script, state: publicState() });
      } catch (err) {
        sendJson(response, { error: err.message || String(err) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/scenario/from-prompt" && request.method === "POST") {
      try {
        const body = await parseBody(request);
        const prompt = String(body.prompt || "").trim();
        const generation = { sourcePrompt: true };
        const cfg = await scenarioFromPrompt(prompt, generation);
        let finalCfg = cfg;
        const validation = { ok: true };
        let next;
        try {
          next = buildStateFromScenario(finalCfg);
        } catch (err) {
          finalCfg = localScenarioFromPrompt(prompt);
          next = buildStateFromScenario(finalCfg);
          generation.repairFallback = true;
          validation.ok = false;
          validation.error = err.message || String(err);
          next.societyLog.push({
            kind: "prompt_structure_repair",
            message: `structured config failed; used local fallback: ${err.message || err}`,
            turn: 0
          });
        }
        lastScenarioInput = finalCfg;
        state = next;
        pushOpeningEntries();
        await attachScenarioLog({
          source: "prompt",
          prompt,
          cfg: finalCfg,
          generation,
          validation,
          requestBody: { prompt }
        });
        sendJson(response, publicState());
      } catch (err) {
        sendJson(response, { error: err.message || String(err) }, 400);
      }
      return;
    }
    // 用户提交自定义场景:
    //   { presetId: "rainyStation" }              → 用内置预设
    //   { scenario, world, agents }               → 用自定义输入
    //   { presetId, overrides: { scenario, ... } }→ 基于预设修改
    if (url.pathname === "/api/scenario" && request.method === "POST") {
      try {
        const body = await parseBody(request);
        let cfg;
        let source = "manual";
        let generation = { method: "manual_yaml" };
        if (body.presetId) {
          const preset = getPreset(body.presetId);
          if (!preset) throw new Error(`未知预设 ${body.presetId}`);
          cfg = JSON.parse(JSON.stringify(preset));
          source = "preset";
          generation = { method: "preset", presetId: body.presetId, hasOverrides: Boolean(body.overrides) };
          if (body.overrides && typeof body.overrides === "object") {
            if (body.overrides.scenario) Object.assign(cfg.scenario, body.overrides.scenario);
            if (body.overrides.world)    Object.assign(cfg.world,    body.overrides.world);
            if (Array.isArray(body.overrides.agents) && body.overrides.agents.length) cfg.agents = body.overrides.agents;
          }
        } else if (body.scenario && body.agents) {
          cfg = { id: body.id || null, scenario: body.scenario, world: body.world || {}, agents: body.agents };
        } else {
          throw new Error("body 需要 presetId 或 (scenario+agents)");
        }
        // 试构造一次,捕获校验错误
        const next = buildStateFromScenario(cfg);
        // 通过则替换全局 state
        lastScenarioInput = cfg;
        state = next;
        pushOpeningEntries();
        await attachScenarioLog({
          source,
          prompt: "",
          cfg,
          generation,
          validation: { ok: true },
          requestBody: body
        });
        sendJson(response, publicState());
      } catch (err) {
        sendJson(response, { error: err.message || String(err) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/reset" && request.method === "POST") {
      // 可选 body: { presetId? }。默认回到空白输入台。
      let body = {};
      try { body = await parseBody(request); } catch {}
      try {
        if (body && body.presetId) {
          const preset = getPreset(body.presetId);
          if (!preset) throw new Error(`未知预设 ${body.presetId}`);
          lastScenarioInput = JSON.parse(JSON.stringify(preset));
          state = createInitialState();
          pushOpeningEntries();
          await attachScenarioLog({
            source: "preset_reset",
            prompt: "",
            cfg: lastScenarioInput,
            generation: { method: "preset_reset", presetId: body.presetId },
            validation: { ok: true },
            requestBody: body
          });
        } else {
          lastScenarioInput = null;
          state = createEmptyState();
        }
        sendJson(response, publicState());
      } catch (err) {
        sendJson(response, { error: err.message || String(err) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/turn" && request.method === "POST") {
      if (state.empty) { sendJson(response, { error: "请先输入 prompt 创建场景" }, 400); return; }
      const body = await parseBody(request);
      const userCue = String(body.userCue || "").trim();
      const actorIds = Array.isArray(body.actorIds) ? body.actorIds.filter((id) => typeof id === "string") : null;
      const next = await advanceSociety({ userCue, actorIds });
      sendJson(response, next);
      return;
    }
    if (url.pathname === "/api/turn/stream" && request.method === "POST") {
      if (state.empty) { sendJson(response, { error: "请先输入 prompt 创建场景" }, 400); return; }
      const body = await parseBody(request);
      const userCue = String(body.userCue || "").trim();
      const actorIds = Array.isArray(body.actorIds) ? body.actorIds.filter((id) => typeof id === "string") : null;
      response.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        ...corsHeaders
      });
      const writeChunk = (obj) => new Promise((resolve) => {
        response.write(JSON.stringify(obj) + "\n", () => resolve());
      });
      // 每秒一次心跳：如果发生了限速等待，前端可以即时显示
      let lastHeartbeatRateLimitAt = 0;
      const heartbeat = setInterval(() => {
        if (state.lastRateLimitAt && state.lastRateLimitAt !== lastHeartbeatRateLimitAt) {
          lastHeartbeatRateLimitAt = state.lastRateLimitAt;
          writeChunk({ kind: "rate_limit_wait", waitMs: state.lastRateLimitWaitMs || 0 }).catch(() => {});
        } else {
          writeChunk({ kind: "heartbeat", ts: Date.now() }).catch(() => {});
        }
      }, 1500);
      try {
        await writeChunk({ kind: "turn_start", turn: state.world.turn + 1 });
        const finalState = await advanceSociety({
          userCue,
          actorIds,
          onDirectorEntry: (entry) => writeChunk({ kind: "director_entry", entry, world: state.world }),
          onActionEntry: (entry) => writeChunk({ kind: "agent_entry", entry, world: state.world })
        });
        await writeChunk({ kind: "done", state: finalState });
      } catch (error) {
        await writeChunk({ kind: "error", message: (error && error.message) || String(error) });
      } finally {
        clearInterval(heartbeat);
        response.end();
      }
      return;
    }
    if (url.pathname === "/api/event" && request.method === "POST") {
      if (state.empty) { sendJson(response, { error: "请先输入 prompt 创建场景" }, 400); return; }
      const body = await parseBody(request);
      const text = String(body.userCue || "").trim() || "环境中突然出现一个新的变量。";
      const event = buildUserCueEvent(text);
      applyDirectorEvent(event);
      state.updatedAt = nowIso();
      sendJson(response, publicState());
      return;
    }
    if (url.pathname === "/api/director" && request.method === "POST") {
      const body = await parseBody(request);
      if (typeof body.autoBeat === "boolean") state.director.autoBeat = body.autoBeat;
      state.updatedAt = nowIso();
      sendJson(response, publicState());
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Society running at http://127.0.0.1:${port}/agent-society.html`);
  console.log(apiKey ? `LLM mode: ${model}` : "LLM mode: unconfigured — 设置 OPENAI_API_KEY 后才能推进回合");
});
