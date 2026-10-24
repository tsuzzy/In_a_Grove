import fs from 'node:fs'

// ---- minimal DOM shim ----
const registry=[]; const byId={};
class El{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this._t='';this._h='';this.style={};this._cls=new Set();
    this.classList={toggle:(c,on)=>{if(on===undefined){this._cls.has(c)?this._cls.delete(c):this._cls.add(c)}else{on?this._cls.add(c):this._cls.delete(c)}},add:c=>this._cls.add(c),remove:c=>this._cls.delete(c),contains:c=>this._cls.has(c)};}
  setAttribute(k,v){this.attrs[k]=String(v); if(k==='class')this._cls=new Set(String(v).split(/\s+/).filter(Boolean));}
  getAttribute(k){return this.attrs[k];}
  appendChild(c){this.children.push(c);return c;}
  addEventListener(){}
  scrollIntoView(){}
  set textContent(v){this._t=v} get textContent(){return this._t}
  set innerHTML(v){this._h=v} get innerHTML(){return this._h}
}
const mk=t=>{const e=new El(t);registry.push(e);return e;};
global.document={
  createElementNS:(ns,t)=>mk(t), createElement:t=>mk(t),
  getElementById:id=>{ if(!byId[id])byId[id]=mk('#'+id); return byId[id]; },
  querySelectorAll:sel=>registry.filter(e=>e._cls.has(sel.replace(/^\./,''))),
};
global.window={};
global.location={search:''};

// ---- load data + page script ----
const dataJs=fs.readFileSync('../demo/atlas-data.js','utf8');
eval(dataJs); // sets window.ATLAS
const html=fs.readFileSync('../demo/atlas.html','utf8');
const blocks=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const page=blocks[blocks.length-1];

let result={};
try{
  eval(page + '\n; result.nodeCount = document.querySelectorAll(".node").length; result.findingHtml=document.getElementById("finding").innerHTML; global.__select=select;');
}catch(e){ console.log('INIT THREW:', e.message); process.exit(1); }
console.log('INIT OK — svg .node count:', result.nodeCount);
console.log('FINDING:', result.findingHtml.replace(/<[^>]+>/g,'').slice(0,160));

function testLeaf(key){
  try{ global.__select(key); }catch(e){ console.log('SELECT THREW for',key,':',e.message); return; }
  const h=document.getElementById('detail').innerHTML;
  const has=s=>h.includes(s)?'Y':'N';
  console.log(`\n=== select(${key}) ===`);
  console.log('  rendered bytes:', h.length);
  console.log('  has Responsibility line section:', has('Responsibility line'));
  console.log('  has spine card (conceals/goal):', has('Conceals:')||has('Goal:')?'Y':'N');
  console.log('  has system-fallback annotation:', has('system fallback'));
  // pull a couple of spoken lines present
  const lines=[...h.matchAll(/class="line">([^<]{8,80})/g)].map(m=>m[1]).slice(0,3);
  lines.forEach(l=>console.log('   line:', l.slice(0,70)));
}
testLeaf("pre-B'/run-06");   // death, Masago — showpiece
testLeaf("B'/run-04");       // unresolved standoff
