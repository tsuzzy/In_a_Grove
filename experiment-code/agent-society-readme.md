# Agent Society Theater

这是「Agent 剧场」的第三档版本：Agent Society。

它不再由前端规则轮流生成台词，而是由本地后端维护一个小型社会状态：

- Director Agent：控制节奏、压力和外部事件
- Character Agents：数学家、文学家、政治家
- World State：时间、天气、资源、威胁、当前事件
- Relationship Matrix：信任、怀疑、共情、筹码
- Memory：每个角色的私人记忆和公共观察
- Secret Exposure：秘密逐步暴露，而不是一次性公开
- Structured Action：每个角色每轮输出行动、台词、可见行为、私下意图、状态变化和关系变化

## 启动

```bash
cd /Users/jingjingzheng/Documents/Codex/2026-06-09/https-chatgpt-com-share-6a271a7c-2f10
PORT=4876 node outputs/agent-society-server.mjs
```

然后打开：

```text
http://127.0.0.1:4876/agent-society.html
```

## 接入真实 LLM Agent

当前环境没有检测到 `OPENAI_API_KEY`，所以只能创建/查看场景，不能推进真实 Agent 回合。

要启用真实 API Agent：

```bash
export OPENAI_API_KEY="你的 key"
export SCENARIO_MODEL="llama-3.3-70b-versatile"
export AGENT_MODEL="llama-3.1-8b-instant"
export DIRECTOR_MODEL="llama-3.1-8b-instant"
PORT=4876 node outputs/agent-society-server.mjs
```

也可以使用兼容 OpenAI Chat Completions 的网关：

```bash
export OPENAI_BASE_URL="https://api.groq.com/openai/v1"
export OPENAI_API_KEY="你的 Groq key"
export SCENARIO_MODEL="llama-3.3-70b-versatile"
export AGENT_MODEL="llama-3.1-8b-instant"
export DIRECTOR_MODEL="llama-3.1-8b-instant"
PORT=4876 node outputs/agent-society-server.mjs
```

建议与便捷启动
----------------

本仓库已添加一个小脚本用于便捷启动并预设推荐的分层模型（可按需覆盖）：

```text
SCENARIO_MODEL=llama-3.3-70b-versatile
DIRECTOR_MODEL=llama-3.1-8b-instant
AGENT_MODEL=llama-3.1-8b-instant
BATCH_AGENT_MODEL=llama-3.1-8b-instant
REPAIR_MODEL=llama-3.3-70b-versatile   # 兜底安全网,用强模型修复弱模型输出
AGENT_BATCH_CALLS=1
```

使用方法：

```bash
# 在项目根目录下运行（先确保已设置 GROQ_API_KEY）
./outputs/run-groq-agent-society.sh
```

若要覆盖默认模型（例如测试其它型号），在运行时传入：

```bash
AGENT_MODEL="你想用的模型id" ./outputs/run-groq-agent-society.sh
```


## 核心 API

- `GET /api/state`：读取完整社会状态
- `POST /api/scenario/from-prompt`：用一句话 prompt 自动生成完整场景结构并开场
- `POST /api/scenario`：提交高级结构化场景
- `POST /api/turn`：推进一个社会回合，可传 `{ "userCue": "..." }`
- `POST /api/event`：只投放导演事件
- `POST /api/reset`：重置剧场

## 输入模式

默认输入只需要一句话：

```text
二战雨夜，数学家、文学家和政治家被困在边境火车站，他们都在隐藏一份会改变战局的秘密。
```

系统会在内部把它展开成结构化场景，包括 `scenario`、`world`、`agents`、秘密、线索和截止时间。

服务启动后默认是空白创作台，不会自动载入任何预设。只有提交一句话 prompt、选择预设，或提交高级 YAML 后，才会创建剧场。

高级模式允许直接编辑 YAML。为了保持原型稳定，复杂角色对象会以 YAML 列表中的 JSON 对象展示；这仍然是合法 YAML，也能被系统解析回内部 JSON。

每个角色 Agent 在 API 模式下会收到自己的侧写、记忆、关系、世界状态和最近对话，并输出严格 JSON：

```json
{
  "action_type": "challenge",
  "speech": "...",
  "visible_behavior": "...",
  "private_intent": "...",
  "target_agent_id": "karl",
  "emotion_delta": { "fear": 2 },
  "relationship_delta": {
    "karl": { "trust": -3, "suspicion": 6 }
  },
  "memory_write": "...",
  "expose_secret_id": "",
  "scene_effect": "..."
}
```
