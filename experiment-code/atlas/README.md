# Rashomon Manifold — 可点击的分叉版图

把作品从"一出会跑的戏"升级为**"同一冻结瞬间可达结局空间的可走入版图"**,每片落定叶子可回溯到某个**已提交决策**。这是相对 NeurIPS 2025《Orchestrating Emergent Storytelling》的结构性差异:他们的死亡是预知史实、且无 commit-then-render 的结构化决策记录,所以做不出"可回溯的因果归属"。

## 文件
- `build-atlas.mjs` — 聚合器:读连续运行 JSON → 分类结局 + 抽责任线 → 写 `atlas-data.js`。**纯后处理,零 GLM 调用,不碰模拟/种子/B′。**
- `atlas-data.js` — 生成产物(`window.ATLAS = {...}`),被查看器内联引用。
- `atlas.html` — 静态查看器,可 `open` 直接打开,或经 :4876 服务访问。

## 数据来源(两层)
- `../neurips-exports/consec/` → 冻结 **B′**(诚实批次,导演只改环境)。当前 4 条,全未决/僵局,无死亡。
- `../neurips-exports/consec-preBprime/` → **pre-B′** 强压力(开发档案)。6 条,含 2 条真砂杀夫 + 1 强盗逃 + 3 未决。

## 重新生成
```bash
cd experiment-code
node atlas/build-atlas.mjs        # 控制台会打印每条运行的分类/主角/回退率
open ../demo/atlas.html           # the viewer lives in demo/ at the repo root; double-click to open
```
深链:`atlas.html?leaf=pre-B'/run-06` 直接选中某片叶子(录视频/做对照用)。

## 责任线如何抽(诚实约束)
对落定叶子的"主角 agent"(发起不可逆动作者;未决/责任分裂时取 withholding 最多者),沿回合取其已落盘字段:`whatToHide`(隐瞒)/ `「对象」显示：` 标记里的对象 / `privateIntent`(去目标前缀)/ `speech`。
- **`调用失败` 回退回合**(`privateIntent` 含"调用失败"或 `speech` 出现中文模板)→ 标"系统回退,不计入归属",并如实报每条运行的回退覆盖率。
- 绝不在回退回合编造归属;只引已记录字段,不臆造隐藏心理因果。

## 加新运行
把新的 `run-*.json`(同结构,带 `minds.moves`)放进 `consec/`(B′)或 `consec-preBprime/`,重跑 `build-atlas.mjs` 即可。结局分类器在模糊处会标"待人工标注",用 `HAND_TAGS`(build-atlas.mjs 顶部)按 `配置/run-id` 校正真凶。

## 验证
`node atlas/test-render.mjs` 思路:最小 DOM 垫片真实执行 `atlas.html` 的 JS,确认初始渲染不抛错、`select()` 对死亡/僵局叶子都能渲出责任线。已通过。
