# Agent Society — 投稿描述文档骨架(目标:≤3 页 PDF)

> NeurIPS 2026 Creative AI Track · Artwork 轨 · 主题 **Agency**
> 这份是骨架:中文注释是给你的(排版前删掉),英文段落可直接进 PDF。
> 最终 PDF 只放【第 1 页】+【第 2 页图解】+【第 3 页 bio】三部分,控制在 3 页内。
> 用 NeurIPS 2026 LaTeX 模板的 `[creativeai]` 选项;字体/边距别动模板。

---

## 【第 1 页】Artist Statement(直接用)

### Agent Society: Delegated Authorship and the Drama of Machine Agency

*Agent Society* is a generative theater in which narrative authorship is deliberately surrendered to a society of self-interested AI agents. There is no script. Each character is an autonomous agent with a public face, a hidden agenda, and private knowledge it may conceal, leak, or weaponize. A director-agent applies dramatic pressure; the audience can inject new evidence mid-scene. What emerges is a short drama that **no human—and no single model prompt—ever wrote.**

The work treats *agency* not as a feature but as a question. When the authorial power we normally reserve for a human writer is **redistributed** across a group of agents who lie, withhold, and pursue conflicting goals, where does the story actually come from? We argue that meaning here is **negotiated, not authored**: it arises in the gaps between what each agent knows, what it pretends to know, and what the audience forces into the open. Running the same opening five times yields five irreconcilable endings—evidence that the agency lives in the system's dynamics, not in any prompt.

We are equally interested in agency's failure modes. When delegated authorship collapses, the agents repeat, contradict, and break character. Rather than hide these seams, the work exhibits them as the visible boundary of machine agency—the point where a society of agents stops cohering into a self and reverts to mechanism.

*Agent Society* asks the audience to sit with an uncomfortable form of authorship: one that is real, consequential, and emergent, yet belongs to no one in the room.

<!-- 中文提示:这一页就是评审读的"你在探究什么"。四段分别对应主题词 surrendered/redistributed/negotiated/delegated。别加技术细节,技术放第 2 页。 -->

---

## 【第 2 页】How It Works(系统图解 + 一段说明)

<!-- 中文提示:这页要一张图 + 一段文字。图先用下面的文字版,投稿前画成真正的框图(draw.io / Figma 均可)。 -->

**Figure 1. The Agent Society loop.(文字版,后续画成框图)**

```
                       ┌─────────────────────────────┐
                       │  WORLD STATE                 │
                       │  时间 / 地点 / 证据原子池      │
                       │  (evidence atoms: 谁知道、    │
                       │   揭穿谁、能帮谁)             │
                       └──────────────┬──────────────┘
                                      │ 当前局势
                                      ▼
        ┌──────────────────── DIRECTOR AGENT ───────────────────┐
        │  挑选本回合的戏剧 beat:该把压力加在谁身上、亮哪条证据   │
        └──────────────┬───────────────────────┬────────────────┘
                       │ 指派戏剧任务            │
        ┌──────────────▼──────┐   ┌────────────▼──────────────┐
        │ CHARACTER AGENT A   │   │ CHARACTER AGENT B / C ...  │
        │  公开身份 / 隐藏身份  │   │  各自的隐藏目标与私有知识   │
        │  私有知识 / 短·长目标 │   │  决定:说什么、瞒什么、抖什么│
        └──────────────┬──────┘   └────────────┬──────────────┘
                       │ 行动(台词+隐藏意图)    │
                       ▼                         ▼
              ┌─────────────────────────────────────────┐
              │ SCENE-WRITER:把这一回合写成散文场景        │
              └───────────────────┬─────────────────────┘
                                  │ 更新世界状态、关系矩阵、怀疑度
                                  ▼
                        回到 WORLD STATE,进入下一回合
            ▲
            │ 观众可随时注入一条新证据 → 改变后续所有回合
        AUDIENCE
```

**Text.(可直接用,按需补一两句)**
Agent Society runs a turn-based loop over a shared *world state* that holds time, place, and a pool of **evidence atoms**—structured facts that hurt some agents, help others, and are known only to a subset. Each turn, a **director agent** selects a dramatic beat and decides where to apply pressure; each **character agent** then acts on its own hidden identity, private knowledge, and conflicting goals, choosing what to say, what to conceal, and what to reveal. A **scene-writer** renders the turn into prose, and the resulting actions update the world state, the relationship matrix, and each agent's suspicion of the others. Crucially, the audience can inject a new evidence atom at any point, redirecting every subsequent turn. The same opening, replayed, diverges—because authorship is distributed across the agents' competing agendas rather than fixed in a prompt.

<!-- 中文提示:这页只解释机制,不放代码、不放 prompt。一张图胜过半页文字。 -->

---

## 【第 3 页】Authors / Bios / Prior Work

<!-- 中文提示:Artwork 轨要求全体作者简短 bio + 相关旧作引用。非匿名。下面是模板,你填。 -->

**Author(s).**
- 姓名 / 单位(如有,可写 Independent Artist) / 一句话身份。
- 邮箱(联系作者标 *)。

**Bio.(每人 2–4 句)**
- 你是谁、做什么方向、为什么做这件作品。如果有相关背景(交互叙事 / 多智能体 / 创作工具),点一句。

**Prior / Related Work.(引用,3–6 条即可)**
- 你自己的相关旧作(如有,哪怕是 demo / 博客 / repo,列出链接)。
- 1–2 篇你致敬或对话的作品:如 AI Dungeon、generative narrative、multi-agent simulation(Park et al. "Generative Agents", 2023)等——表明你知道自己站在什么脉络里。
- 用 NeurIPS 模板的 references,不计入 3 页正文。

---

## 提交清单(对照 CFP)

- [ ] **视频** 3–5 分钟(见 `video-script.md`)——演示作品本身,不是讲 PPT
- [ ] **本 PDF** ≤3 页(statement + 图解 + bio),NeurIPS `[creativeai]` 模板,**非匿名**
- [ ] **作者信息** 全员姓名 + bio + 旧作引用
- [ ] OpenReview 上传,**截稿 2026-08-03 AOE**
- [ ] 心理准备:录用需至少一名作者到 **悉尼**现场注册
