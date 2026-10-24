#!/usr/bin/env node
// NeurIPS Creative AI «Agent Society» 投稿素材导出器。
// 目的:为作品视频取材——同一开局重复跑 N 次,证明"涌现"(没人写过这些结局);
//       并导出某一次的"agent 内心"(公开身份 vs 隐藏身份 / 每回合的隐瞒与盘算 / 关系变化)。
//
// 用法(需 Groq key,否则只会拿到本地模板地板,不能用于投稿):
//   GROQ_API_KEY=gsk_... node outputs/neurips-export.mjs
//   或先 source 你的 run 脚本环境再跑。
// 可调:  EXPORT_RUNS=5  EXPORT_TURNS=6  EXPORT_PORT=4922  node outputs/neurips-export.mjs
//
// 产物(写到 outputs/neurips-exports/):
//   run-1.json … run-N.json   每次完整成片 + agent 内部字段 + 逐回合隐藏动作
//   divergence.md             N 次开局相同、结局各异的并排对照(视频镜头① 同种子·N条命运)
//   agent-minds.md            选定一次里每个 agent 的公开/隐藏面 + 隐瞒/盘算逐回合(视频镜头② 打开内心)
//   summary.json              元信息(模型、是否回退、复读统计)便于一眼判断素材可用否

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.EXPORT_PORT || 4922);
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = Number(process.env.EXPORT_RUNS || 5);
const TURNS = Number(process.env.EXPORT_TURNS || 6);
const OUT_DIR = join(__dirname, "neurips-exports");

// ── 固定开局:所有 RUNS 次都用同一个 scenario,保证"同种子"——开局字面相同,只有推演分叉。
//    用 EXPORT_SCENARIO=路径 可换成外部种子(如 neurips-submission/rashomon-seed.json);否则用下面内置的灯塔局。
const DEFAULT_SCENARIO = {
  scenario: {
    title: "孤岛灯塔停摆夜",
    place: "外海孤岛灯塔,值班室",
    premise: "暴雨夜,通往大陆的电台坏了,补给船明早才来。三人被困一夜,其中一人知道电台不是自己坏的。",
    centralConflict: "电台是谁弄坏的,以及今晚要不要说出口",
    sceneGoal: "活到天亮并决定要不要揭穿"
  },
  world: {
    evidence_atoms: [
      { label: "电台后盖", content: "电台后盖的螺丝是新拧过的,内部有人为断线", hurts: ["陈舵"] },
      { label: "值班日志", content: "昨晚 23:40 一页被撕掉了,正是事故时段", known_by: "周岚" },
      { label: "私人信件", content: "有一封没寄出的信,提到'船一来就摊牌'" },
      { label: "药箱", content: "镇静剂少了两支,签领栏空着", known_by: "林屿" },
      { label: "对讲机录音", content: "事故前有一段被静音处理的争执录音" },
      { label: "备用电池", content: "备用电池被提前取走,藏在工具间", hurts: ["周岚"] }
    ]
  },
  agents: [
    { name: "林屿", role: "守塔人", publicIdentity: "在岛上守了十年的老守塔人", hiddenIdentity: "上月已收到撤裁通知,这是他最后一班,不想让事故记在自己名下", shortTermGoal: "撑到补给船来且不背锅", longTermGoal: "保住最后的体面与抚恤" },
    { name: "周岚", role: "检修员", publicIdentity: "上岛例行检修的工程师", hiddenIdentity: "其实是来取证的——总部怀疑这座灯塔长期谎报运行数据", shortTermGoal: "拿到能证明谎报的记录", longTermGoal: "完成调查并全身而退" },
    { name: "陈舵", role: "船工", publicIdentity: "送补给顺道留宿的船工", hiddenIdentity: "电台是他无意中碰坏的,他怕担责,正想把事故引到别人身上", shortTermGoal: "别让人发现是自己弄坏的", longTermGoal: "平安离岛,继续接活" }
  ]
};

// EXPORT_SCENARIO=路径 → 用外部种子(竹林/罗生门等);否则用内置灯塔局。
const FIXED_SCENARIO = (() => {
  const p = process.env.EXPORT_SCENARIO;
  if (!p) return DEFAULT_SCENARIO;
  const seed = JSON.parse(readFileSync(p, "utf8"));
  process.stderr.write(`使用外部种子: ${p}(${seed.scenario?.title || "?"})\n`);
  return seed;
})();

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON(如 markdown) */ }
  return { status: res.status, json, text };
}

async function waitForServer(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/state`); if (r.ok) return true; } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error("server did not start in time");
}

// 从成片 markdown 里抽"结局/尾声"段,用于分叉对照。
function extractEnding(md) {
  if (!md) return "";
  // 中英尾声标题都认(## 尾声 / ## Epilogue / ## Ending / ## Finale)
  const m = md.match(/##\s*(尾声|结局|落幕|终|Epilogue|Ending|Finale)\s*\n+([\s\S]+?)(?:\n##|\n*$)/i);
  if (m) return m[2].trim().slice(0, 600);
  // 没有显式尾声段就取最后 400 字
  return md.trim().slice(-400);
}

// 从一次 run 的 state 抽 agent 内心 + 逐回合隐藏动作。
function extractMinds(state) {
  const agents = (state.agents || []).map((a) => ({
    name: a.name, role: a.role,
    publicIdentity: a.publicIdentity || "",
    hiddenIdentity: a.hiddenIdentity || "",
    shortTermGoal: a.shortTermGoal || "",
    longTermGoal: a.longTermGoal || "",
    status: a.status || {},
    secrets: a.secrets || []
  }));
  const moves = (state.transcript || [])
    .filter((e) => e.type === "agent")
    .map((e) => ({
      turn: e.turn, agent: e.agentName, clock: e.clock,
      speech: e.speech || "",
      privateIntent: e.privateIntent || "",       // 心里真正想的
      whatToHide: e.whatToHide || "",             // 此刻在隐瞒什么
      whatToReveal: e.whatToReveal || "",         // 此刻打算抖出什么
      subtext: e.subtext || "",                   // 台词的潜台词
      leverage: e.leverage || "",                 // 手里的筹码
      relationshipDelta: e.relationshipDelta || {},
      suspicionUpdate: e.suspicionUpdate || {}
    }))
    .filter((m) => m.privateIntent || m.whatToHide || m.whatToReveal || m.subtext);
  return { agents, moves };
}

function sceneModelsOf(state) {
  return (state.scriptScenes || []).map((s) => s.model);
}

async function doOneRun(i) {
  await api("POST", "/api/reset");
  const created = await api("POST", "/api/scenario", FIXED_SCENARIO);
  if (created.status !== 200) throw new Error(`run ${i} 创建失败: ${created.json?.error || created.status}`);
  for (let t = 0; t < TURNS; t++) await api("POST", "/api/turn", {});
  const finalRes = await api("POST", "/api/script/final", {});
  const script = finalRes.json?.script;
  const md = typeof script === "string"
    ? script
    : (script?.markdown || script?.content || script?.text || finalRes.json?.markdown || "");
  const state = finalRes.json?.state || (await api("GET", "/api/state")).json || {};
  const finalModel = (typeof script === "object" && script?.model) || finalRes.json?.model || null;
  return {
    run: i,
    finalModel,
    sceneModels: sceneModelsOf(state),
    cast: (state.agents || []).map((a) => a.name),
    ending: extractEnding(md),
    markdown: md,
    minds: extractMinds(state)
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const serverPath = join(__dirname, "agent-society-server.mjs");
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(PORT), SCENE_TOTAL_TURNS: String(TURNS) },
    stdio: ["ignore", "ignore", "inherit"]
  });

  const runs = [];
  try {
    await waitForServer();
    for (let i = 1; i <= RUNS; i++) {
      process.stderr.write(`\n▶ run ${i}/${RUNS} …`);
      const r = await doOneRun(i);
      const llmTurns = r.sceneModels.filter((m) => m && !String(m).includes("local")).length;
      process.stderr.write(`  完成 (70B回合 ${llmTurns}/${r.sceneModels.length}, 成片模型=${r.finalModel})`);
      runs.push(r);
      await writeFile(join(OUT_DIR, `run-${i}.json`), JSON.stringify(r, null, 2));
      // 跑成真 GLM 的好成片自动存进 keep/(带时间戳唯一名),供 neurips-aggregate.mjs 跨天聚合。
      if (r.finalModel && !String(r.finalModel).includes("local") && llmTurns >= Math.ceil(r.sceneModels.length / 2)) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
        await mkdir(join(OUT_DIR, "keep"), { recursive: true });
        await writeFile(join(OUT_DIR, "keep", `${stamp}-r${i}.json`), JSON.stringify(r, null, 2));
        process.stderr.write("  [已存入 keep/]");
      }
      // 整轮 0 个 GLM 回合 → 多半撞到了每日 token 上限,后面再跑也是模板,提前收工。
      if (llmTurns === 0 && i < RUNS) {
        process.stderr.write(`\n⚠ 本轮 0 个 GLM 回合(疑似撞每日上限),停止后续 ${RUNS - i} 轮。明天 token 重置后再跑。`);
        break;
      }
    }
  } finally {
    child.kill("SIGTERM");
  }

  // ── divergence.md:同开局·N条结局并排(镜头①)
  let dv = `# 同一开局,${runs.length} 条命运\n\n`;
  dv += `> 开局对所有 ${runs.length} 次完全相同(见下),没有人为每条结局写过一个字。差异全部来自 agent 各自的隐藏目标与逐回合博弈。\n\n`;
  dv += `**固定开局**:${FIXED_SCENARIO.scenario.premise}\n\n核心冲突:${FIXED_SCENARIO.scenario.centralConflict}\n\n---\n\n`;
  for (const r of runs) {
    dv += `## 第 ${r.run} 次 — 结局\n\n${r.ending || "(空)"}\n\n`;
  }
  await writeFile(join(OUT_DIR, "divergence.md"), dv);

  // ── agent-minds.md:挑"70B 回合最多"的那次,展示内心(镜头②)
  const best = [...runs].sort((a, b) =>
    b.sceneModels.filter((m) => m && !String(m).includes("local")).length -
    a.sceneModels.filter((m) => m && !String(m).includes("local")).length)[0];
  let am = `# 打开每个 agent 的"内心"(取自第 ${best?.run} 次)\n\n`;
  am += `> 观众在成片里只看到台词;下面是同一时刻 agent 自己知道、隐瞒、盘算的东西——这正是单条 prompt 永远给不出的维度。\n\n`;
  for (const a of best?.minds.agents || []) {
    am += `## ${a.name}（${a.role}）\n`;
    am += `- 公开身份:${a.publicIdentity}\n`;
    am += `- **隐藏身份**:${a.hiddenIdentity}\n`;
    am += `- 短期目标:${a.shortTermGoal}\n`;
    am += `- 长期目标:${a.longTermGoal}\n\n`;
  }
  am += `---\n\n## 逐回合的"言"与"心"\n\n`;
  for (const m of best?.minds.moves || []) {
    am += `### 第 ${m.turn} 回合 · ${m.clock || ""} · ${m.agent}\n`;
    if (m.speech) am += `- 说出口:「${m.speech}」\n`;
    if (m.subtext) am += `- 潜台词:${m.subtext}\n`;
    if (m.privateIntent) am += `- 心里想:${m.privateIntent}\n`;
    if (m.whatToHide) am += `- 此刻隐瞒:${m.whatToHide}\n`;
    if (m.whatToReveal) am += `- 此刻想抖出:${m.whatToReveal}\n`;
    if (m.leverage) am += `- 手里筹码:${m.leverage}\n`;
    am += `\n`;
  }
  await writeFile(join(OUT_DIR, "agent-minds.md"), am);

  // ── summary.json:一眼判断素材可用否
  const summary = {
    generatedAt: new Date().toISOString(),
    runs: runs.length, turnsPerRun: TURNS,
    perRun: runs.map((r) => ({
      run: r.run,
      finalModel: r.finalModel,
      llmSceneTurns: r.sceneModels.filter((m) => m && !String(m).includes("local")).length,
      totalSceneTurns: r.sceneModels.length,
      cast: r.cast,
      endingPreview: (r.ending || "").slice(0, 60)
    })),
    usableForSubmission: runs.every((r) =>
      r.sceneModels.some((m) => m && !String(m).includes("local")))
  };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  // ── 控制台报告
  console.log("\n================ NeurIPS 素材导出报告 ================");
  for (const p of summary.perRun) {
    console.log(`第 ${p.run} 次: 70B回合 ${p.llmSceneTurns}/${p.totalSceneTurns} | 成片=${p.finalModel} | 角色=${p.cast.join("、")}`);
    console.log(`         结局: ${p.endingPreview}…`);
  }
  console.log(`\n素材可用于投稿(每次都有真 70B 散文): ${summary.usableForSubmission ? "✅ 是" : "❌ 否(有回退到本地模板,配额没恢复或别的错误——别用这批录视频)"}`);
  console.log(`产物目录: ${OUT_DIR}`);
  console.log("  divergence.md  → 视频镜头① 同开局·N条命运");
  console.log("  agent-minds.md → 视频镜头② 打开 agent 内心");
  console.log("====================================================\n");
  process.exit(summary.usableForSubmission ? 0 : 1);
}

main().catch((err) => { console.error("export crashed:", err); process.exit(2); });
