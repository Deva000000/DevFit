const { chromium } = require('C:/Users/DevaaPrasad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:8765/admin.html',{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(async()=>{
      const engine=await loadReceiptReader();
      const canvas=document.createElement('canvas');canvas.width=900;canvas.height=240;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,900,240);
      ctx.fillStyle='#111';ctx.font='bold 50px Arial';ctx.fillText('Amount Paid: RM360.00',25,130);
      const worker=await engine.createWorker('eng');
      try{const ocr=await worker.recognize(canvas);return {text:ocr.data.text,parsed:DevFitReceiptAmount.parseReceiptAmount(ocr.data.text)};}
      finally{await worker.terminate();}
    });
    console.log(JSON.stringify(result));
    if(result.parsed.amountCents!==36000)process.exitCode=1;
    const imageUrl=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=240;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,900,240);x.fillStyle='#111';x.font='bold 50px Arial';x.fillText('Amount Paid: RM360.00',25,130);return c.toDataURL('image/png');});
    let savedAmount=null,activationCalls=0;
    await page.route('**/api/admin',async route=>{
      const body=route.request().postDataJSON();
      if(body.action==='paymentAmount')savedAmount=body.amountCents;
      if(body.action==='activate')activationCalls++;
      const responses={login:{ok:true},list:{subscribers:[]},getConfig:{config:{}},payments:{payments:[{id:'00000000-0000-4000-8000-000000000001',email:'test@gmail.com',payer_name:'Test Client',payer_whatsapp:'60123456789',offer_code:'coaching_8w',expected_amount_cents:36000,detected_amount_cents:null,email_status:'pending',status:'pending',reference:'DEVFIT_SEP26_TEST_C8',byte_size:20000,uploaded_at:'2026-09-28T01:00:00Z'}]},paymentProof:{url:imageUrl},paymentAmount:{ok:true}};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(responses[body.action]||{ok:true})});
    });
    await page.locator('#pw').fill('test-owner-password');await page.locator('#login-btn').click();
    await page.locator('#tab-payments').click();await page.locator('[data-pay-proof]').click();
    await page.waitForFunction(()=>document.querySelector('#payment-amount-result')?.textContent.includes('RM360.00'));
    await page.locator('#payment-save-amount').click();
    await page.waitForFunction(()=>document.querySelector('#payment-amount-result')?.textContent.includes('saved for your review'));
    console.log(JSON.stringify({savedAmount,activationCalls,display:await page.locator('#payment-amount-result').textContent()}));
    if(savedAmount!==36000||activationCalls!==0)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
