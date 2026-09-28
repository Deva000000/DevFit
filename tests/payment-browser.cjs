const { chromium } = require('C:/Users/DevaaPrasad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]) {
      const page = await browser.newPage({viewport});
      await page.addInitScript(() => localStorage.setItem('devfit_user', JSON.stringify({email:'test@gmail.com',name:'Test Client'})));
      const errors=[]; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:8765/pricing.html', {waitUntil:'domcontentloaded'});
      await page.selectOption('#pricing-offer','coaching_8w');
      await page.locator('.coaching-card img').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {const img=document.querySelector('.coaching-card img');return img.complete&&img.naturalWidth>0;});
      const result={viewport:viewport.name,price:await page.locator('#pc-head').textContent(),reference:await page.locator('#pay-reference').textContent(),posterLoaded:await page.locator('.coaching-card img').evaluate(img=>img.complete&&img.naturalWidth>0),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors};
      await page.screenshot({path:'C:/Users/DevaaPrasad/.codex/visualizations/2026/08/14/019ffe44-6149-7b10-bdf0-e7863cf58228/payment-'+viewport.name+'.png',fullPage:true});
      console.log(JSON.stringify(result));
      if(result.price!=='RM360'||!result.reference.endsWith('_C8')||!result.posterLoaded||result.horizontalOverflow||errors.length)process.exitCode=1;
      await page.close();
    }
    const settings=await browser.newPage({viewport:{width:390,height:844}});
    let submittedPayment=null;
    const settingsErrors=[];settings.on('pageerror',e=>settingsErrors.push(e.message));
    await settings.addInitScript(()=>{
      localStorage.setItem('devfit_user',JSON.stringify({email:'test@gmail.com',name:'Test Client',approved:true}));
      localStorage.setItem('devfit_selected_offer','coaching_8w');
      sessionStorage.setItem('devfit_splash_shown','1');
    });
    await settings.route('**/devfit-auth.js',route=>route.fulfill({contentType:'application/javascript',body:'window.DevFitAuth={gate:function(){},getToken:function(){return "test-token";},getUser:function(){return {email:"test@gmail.com"};},requirePro:async function(){return false;}};'}));
    await settings.route('**/api/data',async route=>{
      let body={};try{body=route.request().postDataJSON();}catch(e){}
      if(body.op==='submitPayment')submittedPayment=body;
      const response=body.op==='paymentHistory'?{email:'test@gmail.com',reference:'DEVFIT_SEP26_TEST_APP',offers:[{code:'app_pro',label:'DevFit Pro app · 30 days',amountCents:1990},{code:'coaching_8w',label:'Coaching · 8 weeks',amountCents:36000}],ownerWhatsapp:'60183679177',payments:[]}:
        body.op==='submitPayment'?{ok:true,payment:{id:'00000000-0000-4000-8000-000000000001',status:'pending'},emailDelivered:false,emailPending:true,ownerWhatsapp:'60183679177'}:{ok:true};
      await route.fulfill({status:body.op==='submitPayment'?201:200,contentType:'application/json',body:JSON.stringify(response)});
    });
    await settings.route('**/api/config',route=>route.fulfill({contentType:'application/json',body:'{}'}));
    await settings.goto('http://127.0.0.1:8765/settings.html',{waitUntil:'domcontentloaded'});
    await settings.waitForFunction(()=>document.querySelector('#payment-offer-summary')?.textContent.includes('RM360'));
    await settings.locator('#payment-proof-box').scrollIntoViewIfNeeded();
    const settingsResult={offer:await settings.locator('#payment-offer').inputValue(),email:await settings.locator('#payment-payer-email').inputValue(),price:await settings.locator('#payment-offer-summary').textContent(),reference:await settings.locator('#payment-reference').textContent(),posterPresent:await settings.locator('.coaching-poster-details img').count(),horizontalOverflow:await settings.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors:settingsErrors};
    const samplePng=await settings.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=300;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,600,300);x.fillStyle='#111';x.font='32px Arial';x.fillText('Amount Paid RM360.00',20,100);return c.toDataURL('image/png').split(',')[1];});
    await settings.locator('#payment-payer-whatsapp').fill('60123456789');
    await settings.locator('#payment-proof-file').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from(samplePng,'base64')});
    await settings.locator('#submit-payment-proof').waitFor({state:'visible'});
    await settings.waitForFunction(()=>!document.querySelector('#submit-payment-proof').disabled);
    await settings.locator('#submit-payment-proof').click();
    await settings.waitForFunction(()=>!document.querySelector('#payment-whatsapp-followup').hidden);
    settingsResult.submitted={offer:submittedPayment?.offerCode,email:submittedPayment?.payerEmail,name:submittedPayment?.payerName,whatsapp:submittedPayment?.payerWhatsApp,imageBytes:submittedPayment?.image?.length||0,whatsappLink:await settings.locator('#payment-whatsapp-followup').getAttribute('href')};
    await settings.screenshot({path:'C:/Users/DevaaPrasad/.codex/visualizations/2026/08/14/019ffe44-6149-7b10-bdf0-e7863cf58228/payment-settings-mobile.png',fullPage:true});
    console.log(JSON.stringify(settingsResult));
    if(settingsResult.offer!=='coaching_8w'||settingsResult.email!=='test@gmail.com'||!settingsResult.reference.endsWith('_C8')||!settingsResult.posterPresent||settingsResult.horizontalOverflow||settingsErrors.length||settingsResult.submitted.offer!=='coaching_8w'||settingsResult.submitted.email!=='test@gmail.com'||settingsResult.submitted.imageBytes<100)process.exitCode=1;
    await settings.close();
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
