import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../login.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function initGoogle'));
function harness(){
  const nodes=new Map();const events={};let renders=0;let broken=true;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},hidden:false,innerHTML:'',clientWidth:320});return nodes.get(id);};
  const context={document:{getElementById:node,addEventListener(){}},navigator:{userAgent:'iPhone',platform:'iPhone'},location:{origin:'https://devfitportal.vercel.app'},URLSearchParams,setInterval(){},clearInterval(){},google:{accounts:{id:{initialize(c){context.config=c;},renderButton(){renders++;if(broken)throw new Error('SDK unavailable');}}}}};
  context.window=context;context.addEventListener=(name,fn)=>{events[name]=fn;};
  vm.createContext(context);vm.runInContext(source,context);
  return {context,events,node,ready(){broken=false;},renders:()=>renders};
}
test('GIS render failure remains retryable without uncaught exception',()=>{
  const h=harness();assert.equal(h.context.initGoogle(),false);
  h.ready();assert.equal(h.context.initGoogle(),true);
  assert.equal(h.context.initGoogle(),true);assert.equal(h.renders(),2);
  assert.equal(h.context.config.ux_mode,'redirect');
  assert.equal(h.context.config.login_uri,'https://devfitportal.vercel.app/api/google-login');
});
test('back-forward cache restoration rerenders Google button and clears stale status',()=>{
  const h=harness();h.ready();h.context.initGoogle();
  h.events.pageshow({persisted:true});assert.equal(h.renders(),2);
  assert.equal(h.node('spinner').style.display,'none');
  assert.equal(h.node('status-checking').style.display,'none');
});
test('install instructions support Chrome iOS and do not erase storage',()=>{
  const script=fs.readFileSync(new URL('../login-install.js',import.meta.url),'utf8');
  assert.match(script,/beforeinstallprompt/);assert.match(script,/Safari or Chrome/);
  assert.doesNotMatch(script,/localStorage\.(clear|removeItem)|sessionStorage\.(clear|removeItem)/);
  for(const file of ['settings.html','index.html']){
    assert.doesNotMatch(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/only works in <strong>Safari|only from Safari|CANNOT add to the home screen/);
  }
});
