#!/usr/bin/env node
// 把 neurips-exports/keep/ 里历次保存的"好成片"(全 GLM)聚合成视频素材。
// 背景:Cerebras 免费档每日 token 上限 ~= 2.5 个完整 6 回合,一天攒不够 5 条命运,
//       所以分多天跑 export、每天把好成片存进 keep/,再用本脚本合成最终素材。
// 用法: node outputs/neurips-aggregate.mjs
// 产物(覆盖到 neurips-exports/):divergence.md(所有命运并排)、agent-minds.md(取最丰富一次)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, "neurips-exports");
const KEEP_DIR = join(EXPORT_DIR, "keep");

function llmTurns(r) { return (r.sceneModels || []).filter((m) => m && !String(m).includes("local")).length; }
function isGood(r) {
  // 至少多数回合是真 GLM,且最终成片不是本地模板
  return r.finalModel && !String(r.finalModel).includes("local") && llmTurns(r) >= Math.ceil((r.sceneModels || []).length / 2);
}

async function main() {
  let files = [];
  try { files = (await readdir(KEEP_DIR)).filter((f) => f.endsWith(".json")); } catch { /* 无 keep 目录 */ }
  if (!files.length) { console.error(`没找到 ${KEEP_DIR} 里的 *.json。先跑 export 并把好成片存进 keep/。`); process.exit(1); }

  const runs = [];
  for (const f of files.sort()) {
    try {
      const r = JSON.parse(await readFile(join(KEEP_DIR, f), "utf8"));
      r._file = f;
      runs.push(r);
    } catch { console.error(`跳过损坏文件: ${f}`); }
  }
  const good = runs.filter(isGood);
  console.log(`keep/ 共 ${runs.length} 份,其中合格(全/多数 GLM 且成片非本地): ${good.length} 份`);
  if (!good.length) { console.error("没有合格成片。"); process.exit(1); }

  // divergence.md —— 所有命运并排(用文件名当编号,稳定可追溯)
  const premise = good[0].minds ? null : null;
  let dv = `# 同一开局,${good.length} 条命运\n\n`;
  dv += `> 开局对所有 ${good.length} 次完全相同,没有人为每条结局写过一个字。差异全部来自 agent 各自的隐藏目标与逐回合博弈。\n\n`;
  dv += `> 素材跨多天用 Cerebras GLM-4.7 跑出,逐份存于 \`neurips-exports/keep/\`。\n\n---\n\n`;
  good.forEach((r, i) => {
    dv += `## 命运 ${i + 1}（${r._file}）\n\n${(r.ending || "(空)").trim()}\n\n`;
  });
  await writeFile(join(EXPORT_DIR, "divergence.md"), dv);

  // agent-minds.md —— 取"内心动作最丰富"的一次
  const best = [...good].sort((a, b) => (b.minds?.moves?.length || 0) - (a.minds?.moves?.length || 0))[0];
  let am = `# 打开每个 agent 的"内心"(取自 ${best._file})\n\n`;
  am += `> 观众在成片里只看到台词;下面是同一时刻 agent 自己知道、隐瞒、盘算的东西——单条 prompt 永远给不出的维度。\n\n`;
  for (const a of best.minds?.agents || []) {
    am += `## ${a.name}（${a.role}）\n- 公开身份:${a.publicIdentity}\n- **隐藏身份**:${a.hiddenIdentity}\n- 短期目标:${a.shortTermGoal}\n- 长期目标:${a.longTermGoal}\n\n`;
  }
  am += `---\n\n## 逐回合的"言"与"心"\n\n`;
  for (const m of best.minds?.moves || []) {
    am += `### 第 ${m.turn} 回合 · ${m.clock || ""} · ${m.agent}\n`;
    if (m.speech) am += `- 说出口:「${m.speech}」\n`;
    if (m.subtext) am += `- 潜台词:${m.subtext}\n`;
    if (m.privateIntent) am += `- 心里想:${m.privateIntent}\n`;
    if (m.whatToHide) am += `- 此刻隐瞒:${m.whatToHide}\n`;
    if (m.whatToReveal) am += `- 此刻想抖出:${m.whatToReveal}\n`;
    if (m.leverage) am += `- 手里筹码:${m.leverage}\n`;
    am += `\n`;
  }
  await writeFile(join(EXPORT_DIR, "agent-minds.md"), am);

  console.log(`✅ 已合成:`);
  console.log(`   divergence.md  — ${good.length} 条命运`);
  console.log(`   agent-minds.md — 取自 ${best._file}(${best.minds?.moves?.length || 0} 个内心动作)`);
  console.log(`\n要凑够 5 条命运:目前 ${good.length}/5。明天 token 重置后再跑一次 export、把好成片存进 keep/,再跑本脚本。`);
}

main().catch((e) => { console.error("aggregate crashed:", e); process.exit(2); });
