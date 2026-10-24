# 冻结配置 B′(2026-06-23)

原则:保护可能性空间,不优化补全率。看新结果前冻结,中途不调参,不为凑结局优化。

引擎改动(agent-society-server.mjs):
- escalationDirective() 重写为 **diegetic、非定向环境变化**(时间/光/雨/远处声音/马/绳结/泥泞),明确"不要求任何人动手/逃/结束场景;可等待、拒绝、维持对峙"。
- 删除 #3 情绪阈值的"倾向不可逆行动"指令 + atBreakingPoint 字段(定向、剔除)。
- 总编 prompt:去掉"必须落定终局"强制 → 改为"忠实呈现实际发生了什么;未决(拒绝/持续对峙/已变未断的关系)同样是合法完整结局,不补假死;不许凭空发明事件;不用预告伪装结局"。
- 导演加最高约束:"只能改变环境与等待的代价;不能要求落定/不可逆动作/暴力/特定戏剧形状。"

固定:种子=rashomon-seed-en.json;模型=zai-glm-4.7;OUTPUT_LANG=en;EXPORT_TURNS=8;decoding 同 .env.local。只 sampling 变。

计划:连续累计到 16 条(小批 2×8,不中途改配置),全部留底于 consec/,据实重建 Table 2。区分 meaningful unresolved vs degenerate stall 分别报告。
