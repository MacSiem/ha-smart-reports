'use strict';
// Capability negotiation only: Rich schema2 analysis retains its own native-source checks.
function createSmartCalendarAccessV53({card,guard,onChange=()=>{},onInvalidate=()=>{}}){
 const copy=v=>JSON.parse(JSON.stringify(v));
 let enabled=false,identity=null,epoch=0,raw=null,pending=false,ack=false,off=null,subscribing=null,authority=null,wire=null;
 let view={status:'idle',revision:null,analysis:null};
 const context=()=>{const t=guard.observe();return [t.connection,t.callWS,t.user,t.active,t.admin,t.owner,t.groups,t.groupIds,t.connected,t.online,t.epoch,card.isConnected,card._activeTab,card.preview];};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 const available=()=>enabled&&card.isConnected&&card._activeTab==='energy'&&card.preview!==true&&card._hass?.connected!==false&&guard.available(guard.snapshot());
 const emit=()=>onChange();
 function clear(status='idle'){epoch++;pending=false;view={status,revision:null,analysis:null};onInvalidate();emit();}
 function disposeSubscription(){try{const result=off?.();result?.catch?.(()=>{});}catch(_){}off=null;ack=false;subscribing=null;}
 function observe(){const next=context();if(!same(identity,next)){identity=next;disposeSubscription();clear(available()?'loading':'idle');pending=available();if(pending)queueMicrotask(()=>pump());}return available();}
 const current=e=>e===epoch&&available()&&same(identity,context());
 function invalidate(){if(!enabled)return;clear(available()?'loading':'idle');pending=available();if(pending)queueMicrotask(()=>pump());}
 function envelope(value){
  const a=value?.capabilities?.energy_analysis;
  if(value?.status!=='ready'||!Number.isSafeInteger(value.revision)||value.revision<0||!a||typeof a.visible!=='boolean'||typeof a.read!=='boolean')throw {code:'invalid_capabilities'};
  return {status:'ready',revision:value.revision,analysis:{visible:a.visible,read:a.read}};
 }
 async function subscribe(e){
  if(ack)return true;
  if(subscribing)return subscribing;
  const connection=card._hass?.connection;
  if(typeof connection?.subscribeMessage!=='function')throw {code:'analysis_subscription_unavailable'};
  const association=identity;
  const task=(async()=>{
   const unsub=await connection.subscribeMessage(()=>{if(enabled&&same(association,context()))invalidate();},{type:'ha_tools_email/subscribe_analysis_updates'});
   if(typeof unsub!=='function')throw {code:'analysis_subscription_unavailable'};
   if(!current(e)){try{unsub();}catch(_){}return false;}
   off=unsub;ack=true;return true;
  })();subscribing=task;
  try{return await task;}finally{if(subscribing===task)subscribing=null;}
 }
 async function pump(){
  if(!observe()||!pending||raw||guard.occupied())return;
  pending=false;const e=epoch,token=guard.snapshot(),lane={};raw=lane;view={status:'loading',revision:null,analysis:null};emit();
  try{
   let grant=envelope(await guard.call(token,{type:'ha_tools_email/feature_capabilities'}));
   if(!current(e))return;
   // ACK first, then reconfirm the current actor's grants. Control events contain no report data.
   if(!ack){if(!await subscribe(e)||!current(e))return;grant=envelope(await guard.call(token,{type:'ha_tools_email/feature_capabilities'}));if(!current(e))return;}
   view=grant;emit();
  }catch(error){if(current(e)){view={status:error?.code==='unknown_command'?'unsupported':['unauthorized','not_allowed'].includes(error?.code)?'denied':'error',revision:null,analysis:null};onInvalidate();emit();}}
  finally{if(raw===lane)raw=null;if(pending)void pump();}
 }
 function start(){if(!enabled){enabled=true;authority=guard.subscribe(()=>{if(enabled)observe();});wire=guard.subscribeWire(()=>{if(enabled)void pump();});}observe();if(pending)void pump();}
 function stop(){enabled=false;disposeSubscription();authority?.();wire?.();authority=wire=null;identity=null;clear();}
 function state(){if(enabled)observe();return copy(view);}
 return {start,stop,observe,state,refresh:invalidate};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createSmartCalendarAccessV53};
