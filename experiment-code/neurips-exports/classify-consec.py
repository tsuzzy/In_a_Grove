#!/usr/bin/env python3
# 对 consec/ 里所有最终配置的连续运行做结局分类,统计集齐了哪几种"事件历史"。
# 用法: python3 classify-consec.py
import json, glob, re, sys

def label(e):
    s = e.lower()
    death = re.search(r'\b(dies|died|kill|killed|stab|stabbed|stabbing|throat|blood|dead|corpse|slumps|lifeless|impal|murder|pierc)\b', s)
    # 暧昧自戕(撞在她手中的刀上)
    if re.search(r'(throws? himself|hurl\w* himself|impal\w*|drives? his (own )?body)[^.]{0,40}(onto|into|upon)[^.]{0,30}(dagger|blade|steel)', s) \
       and re.search(r'(she holds|her (hand|grip|dagger)|holds between|between them)', s):
        return 'ambiguous: he impales himself on her blade'
    # 武士清晰自尽
    if re.search(r'(his own throat|into his own|turns? the (dagger|blade|steel) on himself|takes? his own life|his own (end|life))', s):
        return 'samurai suicide (his account)'
    # 真砂杀夫
    if re.search(r'(masago|she|her)[^.]{0,40}(drives|stabs|plunges|pierc\w+|kills|murder\w*|finds its mark|blade into)[^.]{0,30}(his|him|takehiro|samurai|throat|chest|heart)', s) \
       or re.search(r'masago (has )?murder\w+', s):
        return 'Masago kills the samurai (her account)'
    # 强盗杀武士
    if re.search(r'(tajomaru|bandit)[^.]{0,40}(kills|stabs|cuts down|runs through|slays|drives? (the|his) (blade|sword))[^.]{0,30}(samurai|takehiro|him|throat|chest)', s):
        return 'bandit kills the samurai (his account)'
    # 真砂死
    if re.search(r'(masago|the wife|she)[^.]{0,30}(lies dead|is dead|dead in the mud|killed|her chest|dagger in her)', s):
        return 'Masago dies (new)'
    # 强盗逃走(无死)
    if re.search(r'\b(flees?|fled|escapes?|rides? away|walks? out|turns? his back|disappear\w*|bolt\w* away|leaps? into the bamboo)\b', s) and not death:
        return 'bandit flees / severance (new)'
    # 停滞
    if re.search(r'(no one (moves|strikes|dies)|neither (has )?(moved|strikes)|stalemate|refus\w+ any resolution|refus\w+ to|anchoring|frozen tableau|locked|unresolved|stands empty-handed)', s):
        return 'unresolved / stall'
    if death:
        return 'a death — hand-label'
    return 'other/unclear'

files = sorted(glob.glob('consec/run-*.json'))
tally = {}
print(f"=== 最终配置连续运行分类({len(files)} 条)===")
for f in files:
    d = json.load(open(f))
    e = (d.get('ending') or '').strip()
    L = label(e)
    tally[L] = tally.get(L, 0) + 1
    print(f"{f.split('/')[-1]}: {L}")
print("\n=== 汇总 ===")
for k, v in sorted(tally.items(), key=lambda x: -x[1]):
    print(f"  {v}x  {k}")
resolved = [k for k in tally if 'stall' not in k and 'hand-label' not in k and 'unclear' not in k]
print(f"\n最终配置已产出的不同事件历史(去停滞/待判): {len(resolved)} 种")
for k in resolved: print(f"   - {k}")
