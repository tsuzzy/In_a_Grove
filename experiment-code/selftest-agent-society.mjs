#!/usr/bin/env node
// 自测引擎:启动服务 → 自动推演多个场景 → 抽取成片 → 扫描已知缺陷类 → 输出报告。
// 不需要 GROQ_API_KEY:走本地启发式 agent + 本地成片路径,专门检验「结构正确性 / 地板质量」。
// 用法: node outputs/selftest-agent-society.mjs   (退出码 0=全通过, 1=有失败)
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.SELFTEST_PORT || 4988;
const BASE = `http://127.0.0.1:${PORT}`;
const TURNS = Number(process.env.SELFTEST_TURNS || 8);

// ---- 测试场景:覆盖科幻生存 / 公司 / 历史三种题材,用于验证题材连贯与幽灵角色补全 ----
const SCENARIOS = [
  {
    tag: "scifi-survival",
    forbidProps: /股票|董事|律师|公告|公司|质押|期权/,
    body: {
      scenario: { title: "火星舱室断电夜", place: "火星基地 7 号生活舱", premise: "火星基地断电，三名宇航员被困，氧气只够一人撑到救援", centralConflict: "谁先用尽氧气", sceneGoal: "活到救援" },
      world: { evidence_atoms: [
        { label: "氧气罐记录", content: "事故前三小时，氧气罐使用量异常增加", known_by: "王丽" },
        { label: "备用电源记录", content: "断电前一小时，备用电源被人为损坏", known_by: "王丽", hurts: ["王丽"] },
        { label: "通信记录", content: "断电后有一条没发出去的求救信号" },
        { label: "舱压日志", content: "22:10 有人手动关掉了一处舱压报警", hurts: ["李明"] },
        { label: "药品清单", content: "镇静剂少了两支，签领栏是空的", known_by: "张华" },
        { label: "排班表", content: "事发时段的值守人被临时换成了王丽" },
        { label: "门禁记录", content: "维修舱在断电前被人用工程权限打开过", hurts: ["王丽"] },
        { label: "私人录音", content: "有人录下了三人事发前的一段争执" }
      ] },
      // 故意只给 2 个角色,但证据点名了王丽 —— 验证幽灵角色补全
      agents: [
        { name: "李明", role: "指挥官", publicIdentity: "任务指挥官", hiddenIdentity: "误操作泄氧者", shortTermGoal: "找到备用电源" },
        { name: "张华", role: "医生", publicIdentity: "随队医生", hiddenIdentity: "知道有人熬不过", shortTermGoal: "救治伤员" }
      ]
    }
  },
  {
    tag: "corporate",
    forbidProps: /火星|氧气|沙暴|宇航/,
    body: {
      scenario: { title: "深夜董事会", place: "集团总部顶层会议室", premise: "公司AI产品出事故致人受伤，董事会要决定是否对外披露", centralConflict: "是否隐瞒", sceneGoal: "统一对外口径" },
      world: { evidence_atoms: [
        { label: "审计日志", content: "事故在公开公告前已被高层确认", known_by: "陈总" },
        { label: "公告草稿", content: "公告把事故写成轻微故障，今晚截止前发送" }
      ] },
      agents: [
        { name: "陈总", role: "董事长", publicIdentity: "集团董事长", hiddenIdentity: "股票质押爆仓风险者", shortTermGoal: "压住消息" },
        { name: "林工", role: "CTO", publicIdentity: "首席技术官", hiddenIdentity: "知道是系统缺陷", shortTermGoal: "撇清技术责任" },
        { name: "苏律", role: "法务", publicIdentity: "法务总监", hiddenIdentity: "默许过删改", shortTermGoal: "控制法律风险" }
      ]
    }
  }
];

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* markdown 等非 JSON */ }
  return { status: res.status, json, text };
}

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("server did not start in time");
}

// ---- 缺陷扫描:每条返回 {name, ok, detail} ----
function runChecks(scen, finalMarkdown, state) {
  const cast = (state.agents || []).map((a) => a.name).filter(Boolean);
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok, detail });

  // 1. 说话人必须都在角色表里(无幽灵角色)
  const speakers = [...finalMarkdown.matchAll(/\*\*([^*\n]{1,40})\*\*[:：]/g)].map((m) => m[1].trim());
  const ghosts = [...new Set(speakers.filter((s) => !cast.includes(s)))];
  add("no_ghost_speakers", ghosts.length === 0, ghosts.length ? `未登记说话人: ${ghosts.join("、")}` : "");

  // 2. 角色数:幽灵补全后科幻场景应回到 3 人(prompt 写"三名"+证据点名王丽)
  if (scen.tag === "scifi-survival") {
    add("ghost_recovered_to_3", cast.length >= 3, `cast=${cast.length}: ${cast.join("、")}`);
  }

  // 3. 占位符不得出现在成片里
  const placeholders = ["对方", "宇航员1", "宇航员2", "角色A", "角色B", "item-", "prop-", "clue-", "evidence-"]
    .filter((p) => finalMarkdown.includes(p));
  add("no_placeholder_leak", placeholders.length === 0, placeholders.length ? `泄漏: ${placeholders.join("、")}` : "");

  // 4. 题材连贯:不应混入其它题材的道具/证据词
  const themeHit = finalMarkdown.match(scen.forbidProps);
  add("theme_coherence", !themeHit, themeHit ? `串入异题材词: ${themeHit[0]}` : "");

  // 5. 系统词 / 模板腔不得漏到成片
  const banned = ["会比我们任何人的解释都诚实", "我现在就用", "摆到台面", "换个切口", "戏剧Beat", "焦点物件",
    "action_type", "target_object_id", "target_evidence_id", "visible_behavior", "质量审计"]
    .filter((p) => finalMarkdown.includes(p));
  add("no_banned_phrase", banned.length === 0, banned.length ? `系统词: ${banned.join("、")}` : "");

  // 6. 年代一致:不得出现真实日历日期
  const dateHit = finalMarkdown.match(/20\d\d[-/.年]\d{1,2}[-/.月]\d{1,2}/);
  add("era_consistency", !dateHit, dateHit ? `日历日期: ${dateHit[0]}` : "");

  // 7. 跨场景台词复读:同一句对白出现 >3 次视为过度复读(模板地板上 ≤3 次属可接受)
  const lines = [...finalMarkdown.matchAll(/\*\*[^*\n]{1,40}\*\*[:：]\s*([^\n]+)/g)].map((m) => m[1].trim());
  const counts = new Map();
  for (const l of lines) counts.set(l, (counts.get(l) || 0) + 1);
  const repeated = [...counts.entries()].filter(([, c]) => c > 3).map(([l, c]) => `(${c}×) ${l.slice(0, 24)}`);
  add("low_repetition", repeated.length === 0, repeated.length ? repeated.join(" | ") : "");

  // 7b. 模板骨架复读:抹掉「…」内容和具体事实后,同一句式骨架出现过多 → 读起来像复读机
  const skeleton = (s) => s.replace(/「[^」]*」/g, "「X」").replace(/[，。:：][^，。\n]{6,}/g, "…").trim();
  const skelCounts = new Map();
  for (const l of lines) { const k = skeleton(l); if (k.length >= 6) skelCounts.set(k, (skelCounts.get(k) || 0) + 1); }
  const skelMax = Math.max(0, ...skelCounts.values());
  const skelHot = [...skelCounts.entries()].filter(([, c]) => c >= 4).map(([k, c]) => `(${c}×) ${k.slice(0, 20)}`);
  add("low_skeleton_repetition", skelHot.length === 0, skelHot.length ? skelHot.join(" | ") : `max骨架重复=${skelMax}`);

  // 8a. 不得出现双重嵌套的笨拙标签
  const nested = ["里的未公开细节", "里有一条未公开细节"].filter((p) => finalMarkdown.includes(p));
  add("no_nested_label", nested.length === 0, nested.length ? nested.join("、") : "");

  // 8c. 说话人不得在自己台词里用全名第三人称自指
  const selfRef = [];
  for (const m of finalMarkdown.matchAll(/\*\*([^*\n]{1,40})\*\*[:：]\s*([^\n]+)/g)) {
    const sp = m[1].trim();
    if (cast.includes(sp) && m[2].includes(sp)) selfRef.push(`${sp}: ${m[2].slice(0, 20)}`);
  }
  add("no_self_reference", selfRef.length === 0, selfRef.length ? selfRef.join(" | ") : "");

  // 8b. 舞台/转折提示句(斜体行)复读:同一句 *...* 出现 >2 次
  const italics = [...finalMarkdown.matchAll(/^\*([^*\n]{4,})\*$/gm)].map((m) => m[1].trim());
  const itCounts = new Map();
  for (const l of italics) itCounts.set(l, (itCounts.get(l) || 0) + 1);
  const itRepeated = [...itCounts.entries()].filter(([, c]) => c > 3).map(([l, c]) => `(${c}×) ${l.slice(0, 22)}`);
  add("low_stage_repetition", itRepeated.length === 0, itRepeated.length ? itRepeated.join(" | ") : "");

  // 8. 结尾不能是空转弱句(纯"导致/引起 X")且不能与某条转折逐字重复占满全篇
  const endMatch = finalMarkdown.match(/##\s*尾声\s*\n+\*?([^\n*]+)\*?/);
  const ending = endMatch ? endMatch[1].trim() : "";
  const weakEnding = !ending || /^(引起|导致|造成)[^，。]{0,12}$/.test(ending);
  add("ending_has_substance", !weakEnding, weakEnding ? `结尾过弱: "${ending}"` : "");

  return checks;
}

async function main() {
  const serverPath = join(__dirname, "agent-society-server.mjs");
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: "", GROQ_API_KEY: "" },
    stdio: ["ignore", "ignore", "inherit"]
  });
  let failed = 0;
  const report = [];
  try {
    await waitForServer();
    for (const scen of SCENARIOS) {
      await api("POST", "/api/reset");
      const created = await api("POST", "/api/scenario", scen.body);
      if (created.status !== 200) { report.push({ scen: scen.tag, fatal: `创建失败: ${created.json?.error || created.status}` }); failed++; continue; }
      for (let i = 0; i < TURNS; i++) await api("POST", "/api/turn", {});
      const finalRes = await api("POST", "/api/script/final", {});
      const script = finalRes.json?.script;
      const md = typeof script === "string"
        ? script
        : (script?.markdown || script?.content || script?.text || finalRes.json?.markdown || "");
      const state = finalRes.json?.state || (await api("GET", "/api/state")).json || {};
      const checks = runChecks(scen, md, state);
      report.push({ scen: scen.tag, checks, mdLen: md.length });
      failed += checks.filter((c) => !c.ok).length;
    }
  } finally {
    child.kill("SIGTERM");
  }

  // ---- 打印报告 ----
  console.log("\n================ AGENT SOCIETY 自测报告 ================");
  for (const r of report) {
    console.log(`\n● 场景 [${r.scen}]` + (r.fatal ? `  ✗ ${r.fatal}` : `  (成片 ${r.mdLen} 字)`));
    for (const c of r.checks || []) {
      console.log(`   ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);
    }
  }
  console.log(`\n总计失败检查项: ${failed}`);
  console.log("======================================================\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error("self-test crashed:", err); process.exit(2); });
