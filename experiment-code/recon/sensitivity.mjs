// FEATURE-VALUE SENSITIVITY — the paper reports robustness to reweighting; this is robustness
// to the hand-set VALUES inside the features, which is what "your constants are arbitrary"
// actually asks about.
//
// The parameterised copy of features() below must agree with the repository's own, at the
// nominal constants, on every assertion. It asserts that first and exits if it does not:
// otherwise nothing downstream means anything.
const {all, features, U, dimsOf, label} = await import('./grove-core.mjs')
const feasible = all.filter(r=>r.feasible)

// Nominal constants, lifted verbatim from grove-objective.mjs
const P0 = {
  floor:0.15,          // the floor for agency and clean hands
  hSelf:1, hContest:0.6, hBound:0.05, hArmed:0.5, hElse:0.3,   // honour, seen from the victim
  hDuel:1, hKillBound:0.1, hKillElse:0.3, hNotKiller:0.6,      // honour, seen from anyone else
  sKiller:0.35, sVictim:0.7, sElse:0.8,                        // sympathy
  dBase:0.4, dSlope:0.4,                                       // dignity
  wStrike:0.8, wSelf:0.4, wElse:0.6, wNotVictim:0.3,           // wronged
}
function featP(T, an, P){
  const f=an.fatal
  const isFatalActor=f.actor===T, isKiller=f.type==='strike'&&f.actor===T
  const selfWilled=f.type==='self_strike'&&T==='Takehiro'
  const contested=f.type==='impale_on_held', victimT=T==='Takehiro'
  const cleanHands=!(f.type==='strike'&&f.actor===T)?1:P.floor
  const agency=isFatalActor?1:P.floor
  let honor
  if(victimT) honor = selfWilled?P.hSelf : contested?P.hContest : (f.boundAtDeath?P.hBound : (f.victimArmed?P.hArmed:P.hElse))
  else honor = isKiller ? (f.victimArmed&&f.weapon==='longsword'?P.hDuel : f.boundAtDeath?P.hKillBound : P.hKillElse) : P.hNotKiller
  const sympathy=isKiller?P.sKiller:(victimT?P.sVictim:P.sElse)
  const dignity=P.dBase+P.dSlope*agency
  const wronged=victimT?(f.type==='strike'?P.wStrike:selfWilled?P.wSelf:P.wElse):P.wNotVictim
  return {agency,honor,cleanHands,sympathy,dignity,wronged}
}
// ---- the agreement check ----
let bad=0
for(const r of all) for(const T of ['Tajomaru','Masago','Takehiro']){
  const a=features(T,r.an), b=featP(T,r.an,P0)
  for(const k of Object.keys(a)) if(Math.abs(a[k]-b[k])>1e-12) bad++
}
console.log(bad === 0
  ? `agreement check: parameterised features() matches the repository's on all ${all.length} assertions`
  : `MISMATCH in ${bad} places — nothing below is valid`)
if(bad) process.exit(1)

const UP=(T,x)=>{const d=dimsOf[T](x);return (d[0]+d[1]+d[2])/3}
const argmaxBy=(a,f)=>a.slice().sort((x,y)=>(f(y)-f(x))||(x.sig<y.sig?-1:1))[0]
const maxOf=(a,f)=>a.reduce((m,x)=>Math.max(m,f(x)),-Infinity)
function mulberry32(a){a|=0;return function(){a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const wilson=(k,n,z=1.959964)=>{const p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return[100*(c-m),100*(c+m)]}

const CAST=['Tajomaru','Masago','Takehiro']
const results=[]
for(const DELTA of [0.10, 0.20, 0.30, 0.40, 0.50]){
  const rand=mulberry32(16980222), N=5000
  let spread=0; const bite=Object.fromEntries(CAST.map(T=>[T,0]))
  for(let t=0;t<N;t++){
    const P={}
    for(const k of Object.keys(P0)) P[k]=Math.min(1,Math.max(0, P0[k] + (rand()*2-1)*DELTA))
    const pk=new Set()
    for(const T of CAST){
      const g=r=>UP(T, featP(T,r.an,P))
      pk.add(argmaxBy(feasible,g).sig)
      if(maxOf(all,g) > maxOf(feasible,g)+1e-12) bite[T]++
    }
    if(pk.size===3) spread++
  }
  const w=wilson(spread,N)
  results.push({
    delta:DELTA,
    samples:N,
    seed:16980222,
    spread:{count:spread,percent:100*spread/N,ci:w},
    idealInfeasible:Object.fromEntries(CAST.map(T=>{
      const ci=wilson(bite[T],N)
      return [T,{count:bite[T],percent:100*bite[T]/N,ci}]
    }))
  })
  console.log(`\n  perturbing all 19 hand-set feature values by +-${DELTA}   (N=${N}, seed 16980222)`)
  console.log(`    full 3/3 spread survives : ${spread}/${N} = ${(100*spread/N).toFixed(1)}%  95% CI [${w[0].toFixed(1)}, ${w[1].toFixed(1)}]`)
  for(const T of CAST){const v=wilson(bite[T],N)
    console.log(`    ${T.padEnd(13)} ideal still infeasible: ${bite[T]}/${N} = ${(100*bite[T]/N).toFixed(1)}%  95% CI [${v[0].toFixed(1)}, ${v[1].toFixed(1)}]`)}
}

import fs from 'node:fs'
fs.writeFileSync(new URL('./sensitivity-data.json', import.meta.url), JSON.stringify({
  featureCount:Object.keys(P0).length,
  samples:5000,
  seed:16980222,
  results
}, null, 1) + '\n')
console.log('\nwritten: recon/sensitivity-data.json')
