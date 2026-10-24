# Agent Society — 作品视频分镜脚本(目标 3–5 分钟)

> 这是你真正要拍的东西。评审 80% 的第一印象在这条视频。
> 原则:**演示作品,不要讲 PPT**。素材来自 `outputs/neurips-exports/`(用 `neurips-export.mjs` 跑出来,必须是真 70B 那批)。
> 旁白用英文字幕或英文配音(NeurIPS 是英文场);下面旁白先给中英,拍时二选一。

---

## 镜头① 同种子·五条命运(0:00–0:40)— 最重要,放最前

**画面**:屏幕分成 5 格,同一句开局打在最上面;5 格里同时滚出 5 段不同的结局文字(取自 `neurips-exports/divergence.md`)。
**旁白**:
- EN: *"Same opening. Five runs. Five irreconcilable endings. No one wrote any of these."*
- 中:同一个开局,跑了五次,五个互不相容的结局——没有人写过其中任何一个。
**为什么**:这一刀直接回答"比 ChatGPT 强在哪"——单 prompt 给不了"每次不同且都自洽"。

## 镜头② 打开一个 agent 的"内心"(0:40–1:50)— 第二重要

**画面**:左半屏是成片里观众看到的台词;右半屏同步浮出**这个 agent 此刻的隐藏身份 / 心里想的 / 在隐瞒什么 / 想抖出什么**(取自 `neurips-exports/agent-minds.md`)。挑一两个最戏剧化的回合。
**旁白**:
- EN: *"The audience hears the line. The agent knows more than it says—and chooses what to hide."*
- 中:观众只听到台词;agent 知道的远比它说的多——并且自己决定瞒什么。
**为什么**:这是"信息不对称 / agent 有能动性"的实证,单 prompt 叙事永远没有这一层。直接命中主题 *Agency*。

## 镜头③ 能动性的转移(1:50–2:50)

**画面**:关系矩阵 / 怀疑度随回合变化的可视化(谁信任谁、怀疑度条随证据曝光跳动);叠一条"某条证据被读出 → 责任当场重新分配"的瞬间。
**旁白**:
- EN: *"Power is not assigned. It shifts—turn by turn—as evidence surfaces and blame is redistributed."*
- 中:权力不是被指派的,它在一回合回合里移动——证据浮现,责任被重新分配。
**为什么**:把抽象的 "agency is negotiated / redistributed" 变成看得见的动态,呼应 CFP 原词。

## 镜头④ 观众也是能动者(2:50–3:30)

**画面**:实时演示——往进行中的故事里**注入一条新证据**(用 `/api/event` 或前端输入框),后续回合当场改道。
**旁白**:
- EN: *"The audience is an agent too. Drop in a new fact, and the story rewrites its own future."*
- 中:观众也是一个能动者。丢进一条新事实,故事会改写它自己的后续。

## 镜头⑤ 能动性的边界(3:30–4:00)— 加分项,坦诚

**画面**:短暂展示当 delegated authorship 失控时的崩坏(复读 / 串台 / 出戏),配一行字幕标注"failure mode"。
**旁白**:
- EN: *"And when the society stops cohering, agency breaks down into mechanism. We show the seams, not hide them."*
- 中:当这个社会不再自洽,能动性退回成机械。我们展示裂缝,而不是藏起来。
**为什么**:把你修过的那些 bug 重构成观念(机器能动性的脆弱边界),化负为正,也显得诚实、有反思——这条 track 很吃这个。

## 收尾(4:00–4:30)

**画面**:作品名 + 一句话题眼 + (可选)二维码指向可玩 demo / repo。
**旁白**:
- EN: *"Agent Society. An authorship that is real, consequential, and emergent—yet belongs to no one in the room."*

---

## 制作清单

- [ ] 配额恢复后跑 `GROQ_API_KEY=... node outputs/neurips-export.mjs`,确认 `summary.json` 里 `usableForSubmission: true`(每次都有真 70B)
- [ ] 镜头①素材:`neurips-exports/divergence.md`
- [ ] 镜头②素材:`neurips-exports/agent-minds.md`
- [ ] 镜头③④:用前端 `agent-society.html` 实录(屏幕录制)——关系矩阵/注入证据这两个交互前端已有
- [ ] 剪辑:剪映 / Final Cut / DaVinci 均可;3–5 分钟,英文字幕
- [ ] 旁白:英文配音或纯字幕(纯字幕也完全可接受)
- [ ] 导出 1080p,确认 OpenReview 接受的视频格式/大小
