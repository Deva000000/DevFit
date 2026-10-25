// Release assets are immutable within a worker. Generate a patch with --patch
// after intentional edits; CI independently rejects stale/missing hashes.
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const context={};
vm.runInNewContext(source.slice(source.indexOf('const SHELL_FILES'),source.indexOf('// Keep this list aligned'))+'\nglobalThis.files=SHELL_FILES;globalThis.hashes=SHELL_HASHES;globalThis.releaseId=typeof RELEASE_ID!=="undefined"?RELEASE_ID:null;',context);
const hashes={};
for(const name of context.files){
  let bytes=fs.readFileSync(new URL('../'+name.slice(2),import.meta.url));
  if(/\.(html|js|css|json|svg)$/.test(name))bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
  hashes[name]=crypto.createHash('sha256').update(bytes).digest('hex');
}
if(process.argv.includes('--patch')){
  const old=source.slice(source.indexOf('const SHELL_HASHES'),source.indexOf('// RELEASE_HASHES_END')).trimEnd();
  const releaseId=crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
  const next='const SHELL_HASHES = '+JSON.stringify(hashes,null,2)+';\nconst RELEASE_ID = '+JSON.stringify(releaseId)+';';
  process.stdout.write('*** Begin Patch\n*** Update File: '+new URL('../sw.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')+'\n@@\n-'+old.split('\n').join('\n-')+'\n+'+next.split('\n').join('\n+')+'\n*** End Patch\n');
}else{
  const bad=Object.keys(hashes).filter(k=>hashes[k]!==context.hashes[k]);
  if(bad.length)throw new Error('Release hashes need regeneration: '+bad.join(', '));
  if(context.releaseId!==crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex'))throw new Error('Release content identity needs regeneration');
  console.log('Verified '+Object.keys(hashes).length+' immutable release assets');
}
