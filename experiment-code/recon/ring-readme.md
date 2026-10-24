# The Ring and the Book —— 第二个域，方法与 In a Grove 严格一致

Browning《指环与书》(1868–69)，取材 Old Yellow Book：1698 年罗马 Guido Franceschini 伯爵杀妻案。

**`ring-optimize.mjs` 是 `optimize.mjs` 的逐节镜像。** 同一条 generate–verify–optimize 管线、
三个证人、六个结构特征、严格自利的 `U_i`、在一个枚举出的 `Feasible(F)` 上取 argmax、同样的报告项与顺序。
唯一变动的是故事。

这条纪律是整个实验的前提：**只有在方法固定的前提下，第二个域才能说明框架可迁移。**
如果目标函数的形状和故事同时变，任何差异都无法归因。所有偏离 grove 方法的东西——
旁观者(Books II–IV)、教皇(Book X)、利他版 Pompilia——都被移到 `ring-extensions.mjs`，
明确标注为 departure，不进主实验。

## 为什么选这个故事

《竹林中》是 whodunit：凶手是谁本身就是自由变量，证据稀薄，所以"各说各话"永远可以被解释成
"大家真的不知道发生了什么"——分歧与真实的不确定性纠缠在一起。

Franceschini 案在三点上正好相反：

1. **罪行被承认。** Guido 在第五卷和第十一卷两次亲口认杀。`innocence`（脱罪）维度对他是常数
   ——驱动强盗全部问题的那个维度，在这里天生是死的。
2. **记录很厚。** Old Yellow Book 钉死了日期、判决、一次生产、四个雇工、门口喊的那个名字。
3. **约束一半是法律的。** 夫权杀人 (*ius mariti*) 要求当场捉获、**且**在同一瞬间行动——不得有间隔，
   尤其**不得先诉诸法官**。Guido 在客栈追上他们却**没杀**，去起诉了，八个月后带雇工上门。
   这个顺序以完全机械的方式关死了夫权，**结构上等同于竹林里那把没有血的太刀**，
   而且不同于太刀，它是历史上真实判决实际采用的理由。

## 文件

| 文件 | 作用 |
|---|---|
| `ring-domain.mjs` | STRIPS 域：算子、模拟器、`in continenti` 规则、记录 spec + diff、`RECORD` |
| `ring-objective.mjs` | 六个结构特征 + 三个证人各取三个。**全部严格自利、teller-relative**。无枚举无 LLM |
| `ring-core.mjs` | BFS 枚举、assertion 商、可行性、`pinning`、`popeScores`(扩展用) |
| `ring-evidence.mjs` | 记录拆成无争议事实 / 有争议主张；reading 的枚举与相容性 |
| **`ring-optimize.mjs`** | **主实验**，`optimize.mjs` 的镜像 |
| `ring-extensions.mjs` | 三项 departure，单独报告 |
| `ring-spectators.mjs` | 旁观者目标 + 利他版 Pompilia（报告脚本与浏览器包共用） |
| `ring-magistrate-core.mjs` | 交互层：`replay` / `preview` / `jointAudit` / `pinning` |
| `ring-magistrate.html` | **多 agent 交互页** |
| `build-ring-magistrate.mjs` | 生成 `ring-magistrate-bundle.js` |
| `bundle-esm.mjs` | ESM→classic 转换，与竹林的 `build-magistrate.mjs` 共用 |
| `test-ring.mjs` | 77 条自检 |

```bash
node recon/ring-optimize.mjs     # 主实验，无需 API key
node recon/ring-extensions.mjs   # 三项 departure
node recon/test-ring.mjs         # 77 passed
node recon/build-ring-magistrate.mjs   # 改过任何 ring-*.mjs 后必须重跑
```

## 交互页

**`demo/ring-magistrate.html`** (at the repo root; double-click to open)
（竹林那一页是 `magistrate.html`，两页并存，互不覆盖。）

左边逐份立卷 Old Yellow Book 的 11 份文件，右边三个证人各自重新优化。页面显示：

- **每份未立卷文件的实时预览**：会排除多少份叙述、会击破谁；
- **三个证人当前在说什么**，以及 `—`（他无所谓，因此在此没有主张）；
- **卷宗现状**：仍成立的叙述数、不同主张数、最多几人可同时为真、可证的谎；
- **哪些坐标被关死 / 仍然开放**；
- **故事**：每个转折点，按你造成它的顺序；
- 可选打开 **三个旁观者**（Books II–IV），页面即变成 6 个 agent。

设计上要注意的两点：

- **顺序是有意义的。** 同样几份文件按不同顺序到达就是不同的听证，所以撤卷是**从头重放**剩下的序列，
  不是撤销。页面每次切换都跑完整 `replay`（枚举只在加载时跑一次，约 250 ms），
  没有增量快路径，也就没有"增量与全量不一致"这一整类 bug。
- **"被击破"按最优解集合判定**，不按显示出来的那一份。否则字符串排序一动，
  就会报告某个证人被击破——而那正是 `—` 这条规则要防的事。

浏览器跑的是与 node 脚本**同一份代码**（由 `build-ring-magistrate.mjs` 从源模块生成）；
`test-ring.mjs` 第 13 节会 eval 生成的包并逐项比对，包与源不同步会直接测挂。

## 与 In a Grove 并排

| | In a Grove | The Ring and the Book |
|---|---|---|
| 状态数 | 3,631 | 32,928 |
| causal signatures | 22 | 1,008 |
| assertions | 22 | 576 |
| **\|Feas(F)\|** | **11** | **36** |
| **Rashomon spread** | **3/3** | **3/3** |
| 5,000 次重加权下仍 3/3 | 61.7% | **100.0%** |
| 被告的理想被否决 | 69.0%（强盗） | **100.0%**（Guido） |
| 去掉预言机 → 发布被否决叙述 | 23.3% | **66.7%** |

消融（同一枚举集、同一 `U_i`）：

| | 均匀取样 | 去掉预言机 | 本方法 |
|---|---|---|---|
| Guido | 15 | 100 †被否决 | **30** |
| Pompilia | 56 | 100 可行 | **100** |
| Caponsacchi | 37 | 100 †被否决 | **72** |

**两个不同的否决。** Guido 死在 `warrant`（法律许可）上——他先起诉了；
Caponsacchi 死在 `efficacy`（没能把她送到罗马）上。竹林里只有强盗一个人被咬，
这里是两个人、两个不同坐标，第三个人（Pompilia）的理想完全可达。

## 三份证词在哪里冲突

```
disputed fact             Guido                  Pompilia               Caponsacchi
what passed at the inn    they lay together      nothing passed         nothing passed
whose hand held the pen   Pompilia's             —                      —
who set the flight going  —                      Guido                  Pompilia
the usage at Arezzo       she wanted for nothing she was driven to fly  —
Pompilia's role           an adulteress          a wife in fear         —
Caponsacchi's role        her lover              he answered a call     he answered a call
```

`—` ＝ **该证人无所谓**：他所有最优解在这个坐标上不一致，所以他在此没有主张。
这一步是必需的，不是修饰。Pompilia 的效用只要求笔**不在她手里**，
所以"在 Caponsacchi 手里"和"在 Guido 手里"对她完全等值——直接打印 argmax 会让她指控神父，
那是排序造成的假象，与第七卷完全相反。这是论文 assertion 商那条原则再往里推一层：
**绝不把证人没表达过偏好的细节记在他账上。**

结果：三份证词在 **5/6** 个争议事实上真正冲突；
**没有任何一个可行历史同时满足三份**，而且**任何两份也不能同时为真**（三个 pair 全为 0）。
比竹林更强——那里的结论是"至少两份为假"，这里是"任意两份都不能共存"。

**博弈在哪里。** 没有任何证人的目标函数读取别人说了什么，三个优化问题彼此独立
（这与 `optimize.mjs` 一致；耦合是 Section 6 hearing 才引入的）。
交互来自**共享的约束**：一个 `Feasible(F)`，三个人从里面各取一个，然后互相撞上。
每一份单独看都没被记录否决，合起来却互斥——**这就是没有对话的博弈**。

## 记录关死了什么

6/10 个坐标被钉死：`reachedRome / sire / basis / sued / alone / usedName`。
全部 36 个可行叙述一致同意：Guido 在别墅杀人、事先已起诉、带四个雇工、喊神父的名字骗开门。

三个证人分裂的 4 个坐标——`initiator / letters / consummated / peril`——**全部是记录沉默的坐标**。
他们在记录确立的每一件事上毫无分歧。

**即便所有人都知道死者是怎么死的、凶手本人也承认，叙事照样按有利于自己的方向偏折；
证据只是把偏折挤到它够不着的地方去。**

## departures（`ring-extensions.mjs`，不进主实验）

- **(A) 旁观者。** Half-Rome / Other Half-Rome / Tertium Quid 不在场、无得失，只优化"与听众对齐"。
  Half-Rome 落在 Guido 也会满意的叙述上，Other Half-Rome 落在 Pompilia 也会满意的上，
  Tertium Quid 占据一个没人占据的**内部**最优（tilt 0.04，非顶点；本项目唯一非单调目标）。
  另：**记录本身不对称**——妻方辩护人能到 tilt −1.00 (V=100)，夫方最多 +0.24 (V=62)。
- **(B) 利他版 Pompilia。** 第三维度换成 Caponsacchi 自己的特征。结果是**部分互证而非一致**：
  它让她不再指认神父的手，但两人仍在"谁挑起私奔"上分道——她的主张由自身受害驱动，
  他的由自身动机驱动，都是自利的，指向不同的人。这一个坐标就是 3/3 spread 的来源。
- **(C) 教皇。** 无自利目标：叙述在 180 种自洽 reading 下的存活权重。
  平坦先验只判定 4 个开放坐标里的 1 个，按独立作证人数加权则判定 3 个。
  报 marginal 不报 argmax——平坦先验下三个坐标完全对称，那里的 argmax 只是排序穿了判决的外衣。

## 几个容易踩的坑（都已在 `test-ring.mjs` 锁住）

- `sue` 必须禁止"杀完再起诉"，否则 `sued` 与 `basis=honor` 共存，整个机制静默失效。
- 枚举必须把"抵达罗马"这类**没有死人**的终局也记进候选空间，
  否则 Caponsacchi 的理想根本进不了 `ALL`，会被误报成可达。
- `diffRecord` 必须读 `spec.initiator`，否则九条争议主张里三条被 credit 却从不被检查。
- 理想的 argmax 要**宽容取并列**（与 `grove-core.mjs` 的 `matchSignature` 同一纪律）。
- 冲突表要按**最优解集合**判断主张，不能按单个 argmax。
- `brief()` 必须显示所有被目标读取的坐标，否则不同 assertion 渲染成同一行。
