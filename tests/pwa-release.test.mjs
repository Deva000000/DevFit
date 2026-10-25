import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker({corrupt=false,tabs=1,sourceText=source,authSource=null}={}){
  const events={},stored=new Map();let network=0,skipped=false,message=null,cacheName=null;
  const cache={async put(k,r){stored.set(new URL(typeof k==='string'?k:k.url,'https://devfit.test/').pathname,r.clone());},
    async match(k){return stored.get(new URL(typeof k==='string'?k:k.url,'https://devfit.test/').pathname)?.clone();}};
  const c={URL,Response,TextEncoder,Uint8Array,crypto:webcrypto,console,
    caches:{open:async name=>{cacheName=name;return cache;},keys:async()=>[],delete:async()=>true},
    fetch:async p=>{network++;const name=String(p).replace('./','');const bytes=name==='devfit-auth.js'&&authSource?authSource:fs.readFileSync(new URL('../'+name,import.meta.url));return new Response(corrupt&&name==='devfit-auth.js'?'WRONG RELEASE':bytes);},
    self:{location:{origin:'https://devfit.test'},addEventListener:(k,v)=>events[k]=v,
      clients:{claim:async()=>{},matchAll:async()=>Array(tabs).fill({})},skipWaiting:async()=>{skipped=true;}}
  };
  vm.runInNewContext(sourceText,c);
  return {events,stored,get cacheName(){return cacheName;},get network(){return network;},get skipped(){return skipped;},get message(){return message;},
    async install(){let done;events.install({waitUntil:p=>done=p});await done;},
    async request(path){let r;events.fetch({request:{method:'GET',url:'https://devfit.test'+path,mode:'navigate'},respondWith:p=>r=p});return r;},
    async update(){let done;events.message({data:{type:'SKIP_WAITING'},source:{postMessage:m=>message=m},waitUntil:p=>done=p});await done;}};
}
test('a mismatched or partial release cannot install',async()=>{
  const w=worker({corrupt:true});await assert.rejects(w.install(),/Release asset mismatch/);assert.equal(w.skipped,false);
});
test('verified release serves matching HTML and code without pulling newer individual assets',async()=>{
  const w=worker();await w.install();const network=w.network;
  assert((await (await w.request('/')).text()).includes('DevFit'));
  assert((await (await w.request('/devfit-auth.js')).text()).includes('authorize')||w.stored.size>30);
  assert.equal(w.network,network,'Online navigation must not mix in the next release');
  w.stored.delete('/devfit-auth.js');assert.equal((await w.request('/devfit-auth.js')).status,503);
});
test('manual update waits until other editing tabs are closed',async()=>{
  const busy=worker({tabs:2});await busy.update();assert.equal(busy.skipped,false);assert.equal(busy.message.type,'DEVFIT_UPDATE_BLOCKED');
  const ready=worker();await ready.update();assert.equal(ready.skipped,true);
});

test('changed content uses a different cache even when a version label is accidentally reused',async()=>{
  const manifest=JSON.parse(source.match(/const SHELL_HASHES = ([\s\S]*?);\r?\nconst RELEASE_ID/)[1]);
  const auth=fs.readFileSync(new URL('../devfit-auth.js',import.meta.url),'utf8').replace(/\r\n/g,'\n')+'\n// next release fixture\n';
  manifest['./devfit-auth.js']=createHash('sha256').update(auth).digest('hex');
  const id=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const next=source.replace(/const SHELL_HASHES = [\s\S]*?;\r?\nconst RELEASE_ID = "[a-f0-9]+";/,
    'const SHELL_HASHES = '+JSON.stringify(manifest)+';\nconst RELEASE_ID = "'+id+'";');
  const a=worker(),b=worker({sourceText:next,authSource:auth});await a.install();await b.install();
  assert.notEqual(a.cacheName,b.cacheName);
});
