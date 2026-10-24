#!/usr/bin/env bash
set -euo pipefail

# Keys must come from the environment or the private .env.local file below.
# Never commit or paste live credentials into this launcher.
GROQ_API_KEY="${GROQ_API_KEY:-}"
export GROQ_API_KEY

# 也支持从同目录下的本地密钥文件读取 key(该文件不要分享、不要进版本库)。
# 在 outputs/.env.local 里写一行: GROQ_API_KEY=gsk_xxx   即可,脚本会自动加载。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.local"
  set +a
fi

has_numbered_openai_key=0
for key_name in ${!OPENAI_API_KEY_@}; do
  if [[ -n "${!key_name:-}" ]]; then has_numbered_openai_key=1; break; fi
done

if [[ -z "${GROQ_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" && -z "${OPENAI_API_KEYS:-}" && "$has_numbered_openai_key" -eq 0 ]]; then
  echo "未找到 key。二选一:"
  echo "  1) 在 $SCRIPT_DIR/.env.local 写一行: GROQ_API_KEY=gsk_你的key"
  echo "  2) 或先 export OPENAI_API_KEY='你的key'"
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" && -n "${GROQ_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$GROQ_API_KEY"
fi
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.groq.com/openai/v1}"
# 按影响分层路由。原因:Groq 免费档 70B 仅 12000 TPM(每分钟token),
# 把高频的 agent/director(每回合 3+ 次)也放 70B 会瞬间撑爆配额 → 所有 LLM 调用被 413 拒绝 → 回退模板。
# 策略:高频、其产出会被 scene-writer 重写的调用走 8B(TPM 高得多);
#       低频、直接决定可读性的 scenario / scene-writer / repair 走 70B。
export OPENAI_MODEL="${OPENAI_MODEL:-llama-3.1-8b-instant}"
export SCENARIO_MODEL="${SCENARIO_MODEL:-llama-3.3-70b-versatile}"
export DIRECTOR_MODEL="${DIRECTOR_MODEL:-llama-3.1-8b-instant}"
export AGENT_MODEL="${AGENT_MODEL:-llama-3.1-8b-instant}"
export BATCH_AGENT_MODEL="${BATCH_AGENT_MODEL:-$AGENT_MODEL}"
# scene-writer(SCRIPT_MODEL)是真正把推演写成散文的那一遍,质量核心,保持 70B。
export SCRIPT_MODEL="${SCRIPT_MODEL:-llama-3.3-70b-versatile}"
# repair 频次低,用 70B 修复地板质量,性价比最高。
export REPAIR_MODEL="${REPAIR_MODEL:-llama-3.3-70b-versatile}"
export AGENT_BATCH_CALLS="${AGENT_BATCH_CALLS:-1}"
export PORT="${PORT:-4876}"

echo "Agent Society model routing:"
echo "  scenario:    $SCENARIO_MODEL"
echo "  director:    $DIRECTOR_MODEL"
echo "  agent:       $AGENT_MODEL"
echo "  batch agent: $BATCH_AGENT_MODEL"
echo "  repair:      $REPAIR_MODEL"
echo "  script:      $SCRIPT_MODEL"

node "$(dirname "$0")/agent-society-server.mjs"
