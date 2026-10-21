// Authorization always happens first. Public food data can then be shared
// between server instances without exposing diary data or bypassing account checks.
import crypto from 'crypto';
async function foodRpc(...args){const {sbRpc}=await import('./_lib.js');return sbRpc(...args);}
const results = new Map();
const pending = new Map();
const MAX_ITEMS = 200;
const TTL = 15 * 60 * 1000;
const STALE_TTL = 24 * 60 * 60 * 1000;

function busy(retryAfter=2){const e=new Error('food_search_busy');e.retryAfter=retryAfter;return e;}
function remember(key,items){
  results.delete(key);results.set(key,{items,at:Date.now()});
  while(results.size>MAX_ITEMS)results.delete(results.keys().next().value);
}
export async function cachedFood(key, fetchItems, options={}) {
  const existing = results.get(key);
  if (existing && Date.now() - existing.at < TTL) return existing.items;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    let lease=null,sharedKey=null,stale=existing&&Date.now()-existing.at<STALE_TTL?existing.items:null;
    try {
      if(options.shared){
        sharedKey=options.provider+':v2:'+crypto.createHash('sha256').update(key).digest('hex');
        const args={p_key:sharedKey,p_provider:options.provider,p_limit:options.limit,p_window:options.windowSeconds};
        let claim=await foodRpc('claim_devfit_food_cache',args,2000);
        if(!claim) throw new Error('food_cache_unavailable');
        if(Array.isArray(claim.items)) stale=claim.items;
        if(claim.status==='busy'&&!stale){
          // One bounded wait for a different instance filling this exact key.
          await new Promise(resolve=>setTimeout(resolve,750));
          claim=await foodRpc('claim_devfit_food_cache',args,2000);
          if(!claim)throw new Error('food_cache_unavailable');
          if(Array.isArray(claim.items))stale=claim.items;
        }
        if(claim.status==='cached'||(['busy','limited'].includes(claim.status)&&stale)){
          if(!Array.isArray(claim.items))throw new Error('invalid_food_response');
          remember(key,claim.items);return claim.items;
        }
        if(claim.status!=='fetch')throw busy(claim.retryAfter);
        lease=claim.lease;if(!lease)throw new Error('food_cache_unavailable');
      }
      const items = await fetchItems();
      if (!Array.isArray(items)) throw new Error('invalid_food_response');
      if(lease)await foodRpc('finish_devfit_food_cache',{p_key:sharedKey,p_lease:lease,p_items:items,p_success:true},2000);
      if (items.length) {
        remember(key,items);
      }
      return items;
    } catch (error) {
      if(lease)await foodRpc('finish_devfit_food_cache',{p_key:sharedKey,p_lease:lease,p_items:null,p_success:false},1500);
      if(stale)return stale;
      throw error;
    }
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
