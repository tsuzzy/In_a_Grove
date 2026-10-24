# PDF 第 2 页用:How It Works + 一个具体实例(英文,可直接进稿)

> 目的:用一个真实回合证明"剧情决策来自 agent、大模型只做渲染",回应"这跟直接 prompt 有何不同"。
> 数据取自真实 run(neurips-exports/ab/en.json,回合 1,角色 Takehiro)。

---

## How the script is made (and why it is not a single prompt)

Each turn runs in two separate stages. **First**, every character agent — acting only on its own private knowledge and hidden goal — emits a *structured decision*: an intent, what it will conceal, what it will reveal, which object or piece of evidence it acts on, and how its stance toward the others shifts. **Second**, a scene-writer is handed those decisions and told it *may not invent actions* — it only renders the already-decided turn into prose. A separate director-agent chooses where to apply pressure each turn. The result is logged at the decision layer *before* any prose exists, so the whole script is auditable.

### From decision to line (one real turn)

**Agent: Takehiro (the bound samurai), Turn 1 — computed before any prose:**
- *Goal pursued:* even at the cost of his life, turn this into a duel rather than a one-sided slaughter, to reclaim a shred of a warrior's dignity.
- *Conceals:* that his wife's defilement is also an unspeakable shame **to him**.
- *Acts on:* the longsword standing in the mud — the line between "warrior" and "rat."

**What the scene-writer then rendered from exactly that decision:**

> *Takehiro fixes a gaze of pure contempt on the sword in the mud, then jerks his chin at the bandit.*
> **Takehiro:** "You have the wolf's hunger, bandit, but you lack the wolf's heart… do you want to die a husband, or a liar?"

The concealed shame **never appears in the dialogue**, yet it shapes every line he chooses; the goading is his bid to provoke a duel. A single, omniscient prompt has no hidden, agent-private state to withhold — it simply narrates. Here the withholding is structural and logged.

### Emergence, not a re-roll

The same fixed opening — the assault is done, the samurai bound, all three present — replayed N times yields **incompatible deaths**, each traceable to specific agent decisions: in one run Masago drops the sword and turns her own dagger on herself; in another the bandit and the samurai kill each other and the wife alone survives. Akutagawa authored three testimonies; the agents generate these and outcomes he never wrote — and no narrator adjudicates which is true, because the truth here is a function of whose agency prevailed.

### Control: the same model, prompted directly

Asked in a single prompt to "write a Rashomon one-act where the three end differently," the same model returns one polished, omnisciently-narrated story with no private state, no information asymmetry, and no per-turn decision trail. The contrast — shown side by side — is the difference between *authoring a story* and *running a society that produces one.*

---

## 排版提示(给你/我)
- 第 2 页:上半页放"两阶段"说明 + 系统循环图(Figure 1);下半页放上面这个"From decision to line"实例框 + "Emergence"两三行 + "Control"一句。
- 实例框建议加灰底或左边框,视觉上和正文区分(这是全篇最有说服力的一块)。
- 若空间紧:Control 段可压成一句脚注;实例框不能删。
- 语言:若最终定英文生成,agent 决策层也切英文(现在 agent 跑的是中文、scene-writer 英文),实例就天然同语种、更干净。
