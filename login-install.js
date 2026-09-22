// Installation never resets account/session data. The browser owns confirmation.
(function(){
  'use strict';
  var help=document.getElementById('install-help');
  var button=document.getElementById('install-now');
  var status=document.getElementById('install-status');
  var promptEvent=null;
  function standalone(){return navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;}
  if(standalone()){help.hidden=true;return;}
  var ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  document.getElementById('install-instructions').textContent=ios
    ? 'In Safari or Chrome, tap Share → Add to Home Screen → Add. If Safari offers Open as Web App, leave it on. If the option is missing, open devfitportal.vercel.app/login.html in Safari and use Share there.'
    : 'Tap Install DevFit when available. Otherwise, in Chrome open the browser menu → Install app or Add to Home screen, then confirm.';
  window.addEventListener('beforeinstallprompt',function(event){
    event.preventDefault();promptEvent=event;button.hidden=false;
  });
  button.addEventListener('click',async function(){
    if(!promptEvent)return;
    var current=promptEvent;promptEvent=null;button.hidden=true;
    try{
      await current.prompt();
      var choice=await current.userChoice;
      status.textContent=choice.outcome==='accepted'?'Installation accepted. Open DevFit from your home screen when it appears.':'Installation cancelled. You can still use DevFit in this browser.';
    }catch(_){status.textContent='Use your browser menu to install DevFit instead.';}
  });
  window.addEventListener('appinstalled',function(){help.hidden=true;promptEvent=null;});
})();
