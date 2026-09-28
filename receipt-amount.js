// Review aid only. OCR can misread a receipt and a receipt can be altered.
// This parser must never be used to authorize access or verify a payment.
(function(root){
  function parseReceiptAmount(text){
    var lines=String(text||'').replace(/\r/g,'').split('\n');
    var found=[];
    lines.forEach(function(raw,index){
      var line=raw.replace(/\s+/g,' ').trim();
      if(!line||/\b(balance|available|fee|charge|cashback|account|reference|ref no|transaction id)\b/i.test(line))return;
      var strong=/\b(total paid|amount paid|payment amount|transfer amount|amount transferred|total amount|paid amount)\b/i.test(line);
      var medium=/\b(total|amount|paid|transferred|transfer)\b/i.test(line);
      var pattern=/(?:RM|MYR|MR)\s*([0-9]{1,5}(?:[,.][0-9]{2})?)\b|\b([0-9]{1,5}[.,][0-9]{2})\b/gi;
      var match;
      while((match=pattern.exec(line))){
        var rawAmount=(match[1]||match[2]).replace(',','.');
        var cents=Math.round(Number(rawAmount)*100);
        if(!Number.isInteger(cents)||cents<100||cents>1000000)continue;
        found.push({amountCents:cents,score:(strong?4:medium?3:match[1]?2:1),line:line.slice(0,140),lineNumber:index+1});
      }
    });
    found.sort(function(a,b){return b.score-a.score||a.lineNumber-b.lineNumber;});
    if(!found.length)return {amountCents:null,ambiguous:false,candidates:[]};
    var top=found[0].score;
    var distinct=found.filter(function(x){return x.score===top;}).map(function(x){return x.amountCents;});
    return {amountCents:found[0].amountCents,ambiguous:new Set(distinct).size>1,candidates:found.slice(0,5)};
  }
  root.DevFitReceiptAmount={parseReceiptAmount:parseReceiptAmount};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.DevFitReceiptAmount;
})(typeof window!=='undefined'?window:globalThis);
