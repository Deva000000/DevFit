import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPremiumPdf } from '../api/_premium-pdf.js';
const sub={email:'pdf-qa@example.invalid',name:'PDF QA'};
const docs={progress:{programStart:'2026-09-28',programDuration:'4',bw:[[70,71],[70.5,71.2]],steps:[[4000,5000]],sleep:[[7,8]],weeklyCheckin:[]},
  workouts:{plan:{name:'QA',client:'QA',workouts:[{name:'Upper',exercises:[{name:'Row',tSets:3,tReps:10}]}]},sessions:[]},
  nutrition:{targets:{cal:2000,p:120,c:200,f:60},days:{'2026-10-01':{meals:[{name:'Breakfast',items:[{name:'Egg',cal:100,p:10,c:1,f:5}]}]}}}};
test('all three server PDF services generate valid non-empty, named PDFs',()=>{
  for(const action of ['progress_pdf','workout_pdf','nutrition_pdf']){
    const r=renderPremiumPdf(docs,sub,action,{startW:0,endW:action==='progress_pdf'?1:0,date:'2026-10-01'});
    assert(r.bytes.length>1000);assert.equal(r.bytes.subarray(0,5).toString(),'%PDF-');assert.match(r.filename,/^DevFit_[a-zA-Z0-9_-]+\.pdf$/);
  }
});
test('report service rejects excessive ranges, missing programs and invalid dates',()=>{
  for(const selection of [{startW:0,endW:1000},{startW:-1,endW:1},{startW:0,endW:1,programId:'somebody-elses-program'}])
    assert.throws(()=>renderPremiumPdf(docs,sub,'progress_pdf',selection));
  assert.throws(()=>renderPremiumPdf(docs,sub,'nutrition_pdf',{date:'2026-02-31'}));
});
test('rendering is isolated per request and never mutates source account data',()=>{
  const original=JSON.stringify(docs);
  renderPremiumPdf(structuredClone(docs),sub,'progress_pdf',{startW:0,endW:0});
  const second=renderPremiumPdf(structuredClone(docs),{...sub,name:'Another user'},'workout_pdf',{});
  assert(second.bytes.length>1000);assert.equal(JSON.stringify(docs),original);
});
