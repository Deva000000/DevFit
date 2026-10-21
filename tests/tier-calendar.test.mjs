import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
test('server and browser retain Pro throughout the inclusive UTC expiry day in every timezone',()=>{
  const script=String.raw`const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
    const server=fs.readFileSync('api/_lib.js','utf8').match(/export function computeTier\(sub\) \{[\s\S]*?\n\}/)[0].replace('export ','');
    const client=fs.readFileSync('devfit-auth.js','utf8').match(/function getUserTier\(\) \{[\s\S]*?\n  \}/)[0];
    const admin=fs.readFileSync('admin.html','utf8').match(/function statusPill\(s\)\{[\s\S]*?\n\}/)[0];
    const RealDate=Date;
    for(const [now,expected] of [['2026-10-20T23:59:59Z','free'],['2026-10-21T00:00:00Z','pro'],['2026-10-31T23:59:59Z','pro'],['2026-11-01T00:00:00Z','free']]){
      class Clock extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return RealDate.parse(now);}}
      const c={Date:Clock,getUser:()=>({tier:'pro',startDate:'2026-10-21',expiry:'2026-10-31'})};vm.createContext(c);vm.runInContext(server+';'+client+';'+admin,c);
      assert.equal(c.computeTier({approved:true,tier:'pro',start_date:'2026-10-21',expiry:'2026-10-31'}),expected);
      assert.equal(c.getUserTier(),expected);
      assert.equal(c.statusPill({approved:true,tier:'pro',start_date:'2026-10-21',expiry:'2026-10-31'}).includes('pill pro'),expected==='pro');
    }`;
  for(const TZ of ['UTC','Asia/Kuala_Lumpur','America/Los_Angeles','Europe/London','Pacific/Auckland'])execFileSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,TZ}});
});
test('every app page uses the same tier calculation instead of a drifting duplicate',()=>{
  for(const page of ['index.html','nutrition.html','workouts.html','settings.html']){
    const html=fs.readFileSync(new URL(page,root),'utf8');
    const helper=html.match(/function getUserTier\(\)\{[\s\S]*?\n\}/)[0];assert.match(helper,/DevFitAuth\.getUserTier\(\)/);
  }
});
