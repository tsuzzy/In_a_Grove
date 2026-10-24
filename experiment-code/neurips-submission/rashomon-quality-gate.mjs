#!/usr/bin/env node
// 竹林/罗生门取材的【质量闸 + 命运账本】(中英双语)。每次跑完 export 后跑它,
// 自动体检每条成片是否达投稿底线,并统计已集齐几种"死法",距目标 5 条还差几。确定性检查。
// 用法: node outputs/neurips-submission/rashomon-quality-gate.mjs [keep目录,默认 neurips-exports/keep]

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "neurips-exports");
const KEEP_DIR = process.argv[2] || join(OUT_DIR, "keep");
const TARGET_FATES = 5;

// 角色别名(中英)
const BANDIT = /多襄丸|强盗|大盗|Tajomaru|bandit/i;
const WIFE = /真砂|Masago/i;
const HUSBAND = /金泽武弘|武弘|武士|Takehiro|samurai|warrior/i;

// 死亡 / 不可逆终局(中英)。注意:英文不收"body"(太泛),避免非死场景误判。
const DEATH = /死|杀|刺|刎|自尽|自戕|血泊|倒下|倒在|贯穿|咽喉|断气|毙命|殒命|身亡|\b(dies|died|dying|kills?|killed|slain|slays?|stabs?|stabbed|stabbing|throat|blood|bleeds?|bleeding|dead|corpse|suicide|lifeless|slumps?|collapses?|run through|takes? (?:his|her) own life|(?:his|her) own end)\b/i;
// 非死亡但同样【不可逆的终局】:逃走/弃局、彻底决裂、坦白(都是放宽后认可的合法结局)
const RESOLVE = /逃|逃离|逃走|离去|转身(?:就走|离开|背对)|弃局|彻底决裂|斩断|割席|\b(flees?|fled|escapes?|escaped|escaping|walks? away|leaves? the grove|turns? (?:his|her) back|severs? (?:their|the) bond|bond (?:is )?(?:severed|broken|cut)|breaks? (?:it )?off (?:for good|forever)|abandons?|never (?:to )?(?:speak|return))\b/i;
const TERMINAL = (e) => DEATH.test(e) || RESOLVE.test(e); // 终局 = 死亡 或 逃走/决裂等不可逆收场
// 僵持/未落定。英文只收明确"无结果"措辞,不收 frozen/stillness 这类氛围词(它们也出现在死亡场景里)。
const STANDOFF = /僵持|对峙|一触即发|僵立|发酵|悬而未决|动弹不得|谁也没动|即将|就要|等着流血|血光在所难免|不可避免|下一刻便是|\b(stalemate|standoff|deadlock|unresolved|neither (?:moves|gives|yields|dares|strikes)|no one (?:moves|dies|dares|strikes)|poised on the brink|remains? locked|inevitable|awaits? the blood|about to|is coming|on the brink|moments? from|yet to (?:strike|fall))\b/i;
// 分析腔总结句残留(中英)
const SUMMARY_RESIDUE = /逼迫|权力平衡|从.{1,8}转为|不再是背景|摆到.{0,4}明面|空间变窄|改变了.{0,6}关系|\b(shifts? the balance|the power dynamic|forces? (?:him|her|them) to choose|reasserts? (?:his|her) (?:control|dominance)|the stakes? (?:rise|escalate))\b/i;
// 年代穿帮(现代道具/词,中英)
const ANACHRONISM = /电台|手机|电话|汽车|公司|股票|合同|子弹|互联网|电脑|护照|医院|\b(phone|telephone|car|automobile|computer|internet|gun|pistol|rifle|bullet|company|stock|contract|passport|hospital|police officer|camera)\b/i;

function llmTurns(r) { return (r.sceneModels || []).filter((m) => m && !String(m).includes("local")).length; }

// 把结尾归类成一种"命运"(启发式,粗分;人最终确认)。先查自尽(更具体),再查同归于尽,最后查他杀。
function classifyFate(ending) {
  const e = String(ending || "");
  // 预告式/纯氛围 → 未落定
  if (STANDOFF.test(e) && !DEATH.test(e) && !RESOLVE.test(e)) return "未落定·僵持 / standoff";
  if (!DEATH.test(e)) {
    // 非死亡的不可逆终局(逃走/决裂),也算落定
    if (/severs? (?:their|the) bond|bond (?:is )?(?:severed|broken|cut)|breaks? (?:it )?off|彻底决裂|斩断|割席/i.test(e)) return "彻底决裂 / severance (new)";
    if (RESOLVE.test(e)) return "逃走/弃局 / flight (new)";
    return STANDOFF.test(e) ? "未落定·僵持 / standoff" : "未落定·其他 / unresolved";
  }
  const wifeSuicide = WIFE.test(e) && /自尽|自戕|自刎|her own throat|into herself|takes? her own life|her own end|drives? (?:the |a )?(?:dagger|blade|knife)[^.]{0,30}\b(?:into|deep into) her/i.test(e);
  const husbandSuicide = HUSBAND.test(e) && /自尽|自刎|自戕|his own throat|into himself|takes? his own life|his own end|chosen his own end|drives? (?:the |a )?(?:dagger|blade|knife)[^.]{0,30}\b(?:into|deep into) his/i.test(e);
  const bothDie = /同归于尽|双双|互刺|回刺|both (?:men )?(?:die|fall|are dead)|kill(?:s|ing)? each other|each other[^.]{0,20}(?:die|dead|fall)|mutual/i.test(e);
  if (husbandSuicide) return "武士自尽 / Takehiro suicide (Akutagawa)";
  if (wifeSuicide) return "真砂自尽 / Masago suicide (new)";
  if (bothDie) return "两男同归于尽 / both men die (new)";
  if (/真砂.{0,6}(死|倒|血)|杀.{0,2}真砂|刺.{0,2}真砂|Masago[^.]{0,20}(?:dies|killed|dead)|kills? Masago|stabs? Masago/i.test(e)) return "真砂死 / Masago killed (new)";
  if (BANDIT.test(e) && /杀|刺|宰|kill|stab|slay|cut down|run through/i.test(e) && HUSBAND.test(e)) return "强盗杀武士 / bandit kills samurai (Akutagawa)";
  if (WIFE.test(e) && /杀|刺|kill|stab/i.test(e) && HUSBAND.test(e)) return "真砂杀武士 / Masago kills samurai (Akutagawa)";
  return "有人死·待人工归类 / a death — classify by hand";
}

function checkRun(r) {
  const ending = r.ending || "";
  const fullText = (r.markdown || "") + "\n" + ending;
  const total = (r.sceneModels || []).length || 1;
  const glm = llmTurns(r);
  const checks = {
    真GLM: !!(r.finalModel && !String(r.finalModel).includes("local")) && glm >= Math.ceil(total / 2),
    终局落定: TERMINAL(ending) && !STANDOFF.test(ending),
    无分析腔总结句: !SUMMARY_RESIDUE.test(r.markdown || ""),
    无年代穿帮: !ANACHRONISM.test(fullText)
  };
  const pass = Object.values(checks).every(Boolean);
  return { checks, pass, fate: classifyFate(ending), glm, total, endingPreview: ending.slice(0, 70) };
}

async function main() {
  let files = [];
  try { files = (await readdir(KEEP_DIR)).filter((f) => f.endsWith(".json")); } catch {
    console.error(`找不到目录: ${KEEP_DIR}`); process.exit(2);
  }
  if (!files.length) { console.error(`${KEEP_DIR} 里没有 *.json。先跑 export。`); process.exit(2); }

  const rows = [];
  for (const f of files.sort()) {
    try { rows.push({ f, ...checkRun(JSON.parse(await readFile(join(KEEP_DIR, f), "utf8"))) }); }
    catch { console.error(`跳过损坏: ${f}`); }
  }

  console.log("\n================ 竹林质量闸 + 命运账本 ================");
  const C = ["真GLM", "终局落定", "无分析腔总结句", "无年代穿帮"];
  for (const row of rows) {
    const flags = C.map((k) => `${row.checks[k] ? "✓" : "✗"}${k}`).join(" ");
    console.log(`\n● ${row.f}  [${row.pass ? "通过" : "未过"}]  GLM ${row.glm}/${row.total}`);
    console.log(`  ${flags}`);
    console.log(`  命运: ${row.fate}`);
    console.log(`  结尾: ${row.endingPreview}…`);
  }

  const passed = rows.filter((r) => r.pass);
  const fates = new Set(passed.map((r) => r.fate).filter((x) => !x.startsWith("未落定")));
  console.log("\n---------------- 汇总 ----------------");
  console.log(`成片总数: ${rows.length} | 通过质量底线: ${passed.length}`);
  console.log(`已集齐不同死法: ${fates.size}/${TARGET_FATES} → ${[...fates].join("、") || "(无)"}`);
  const need = Math.max(0, TARGET_FATES - fates.size);
  console.log(need ? `还差 ${need} 种不同的死法,继续跑(要新的走向,不是重复同一种)。` : `✅ 已集齐 ${TARGET_FATES} 种,可进入锁定/剪辑阶段。`);
  const failing = rows.filter((r) => !r.pass);
  if (failing.length) console.log(`⚠ ${failing.length} 条未过底线(回退本地/没死人/穿帮),不要用于投稿: ${failing.map((r) => r.f).join("、")}`);
  console.log("======================================================\n");

  let md = `# 竹林·命运账本(${new Date().toISOString().slice(0, 10)})\n\n`;
  md += `通过质量底线 ${passed.length}/${rows.length};集齐死法 ${fates.size}/${TARGET_FATES}。\n\n`;
  md += `| 文件 | 通过 | GLM | 命运 | 结尾 |\n|---|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.f} | ${r.pass ? "✅" : "❌"} | ${r.glm}/${r.total} | ${r.fate} | ${r.endingPreview.replace(/\|/g, "/")}… |\n`;
  await writeFile(join(OUT_DIR, "fates-ledger.md"), md);
  console.log(`命运账本已写: neurips-exports/fates-ledger.md`);

  process.exit(failing.length && passed.length === 0 ? 1 : 0);
}

main().catch((e) => { console.error("quality-gate crashed:", e); process.exit(2); });
