import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

test('a cold-start login burst shares one Google key request, and key rotation remains retryable',async()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...pair.publicKey.export({format:'jwk'}),kid:'initial',alg:'RS256'};
  const original=globalThis.fetch;let calls=0,keys=[jwk];
  globalThis.fetch=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return{ok:true,headers:{get:()=> 'max-age=3600'},json:async()=>({keys})};};
  try{
    const {identityFromGoogleIdToken}=await import('../api/_lib.js?auth-scale');
    const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
    const token=kid=>{const h=b64({alg:'RS256',kid});const p=b64({iss:'https://accounts.google.com',
      aud:'94871311791-ql8k9lo0q9e1uq3ri98ghnfr1m187chh.apps.googleusercontent.com',
      sub:'synthetic',email:'scale@example.invalid',email_verified:true,exp:Math.floor(Date.now()/1000)+300});
      return h+'.'+p+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+p),pair.privateKey).toString('base64url');};
    const signed=token('initial');const users=await Promise.all(Array.from({length:2000},()=>identityFromGoogleIdToken(signed)));
    assert.equal(calls,1);assert.ok(users.every(u=>u?.email==='scale@example.invalid'));
    keys=[jwk,{...jwk,kid:'rotated'}];
    const rotated=token('rotated');
    const rotatedUsers=await Promise.all(Array.from({length:2000},()=>identityFromGoogleIdToken(rotated)));
    assert.ok(rotatedUsers.every(u=>u?.email==='scale@example.invalid'));
    assert.equal(calls,2);
    const invalid=await Promise.all(Array.from({length:100},(_,i)=>identityFromGoogleIdToken(token('invalid-'+i))));
    assert.ok(invalid.every(v=>v===null));assert.equal(calls,2,'random unknown kids cannot cause a fetch storm');
  }finally{globalThis.fetch=original;}
});
