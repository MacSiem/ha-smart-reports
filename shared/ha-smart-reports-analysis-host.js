// Smart owns only the selected HA Energy calendar snapshot. No Recorder fallback.
function createSmartAnalysisHostV53({card,initialSelection={}}) {
 let root=null,started=false,ticket=0,section='overview',identity=null,calendarOpen=false,selectionPending=false;
 const exportButtons=new Map();
 let selection={period:'day',comparison:'previous'},options={level:'areas',view:'chart',selected:null};
 if(['day','week','month','year'].includes(initialSelection.period))selection.period=initialSelection.period;
 const allowedComparisons=period=>period==='day'?['previous','same_weekday','mean7']:['previous','year_ago'];
 const allowed=allowedComparisons(selection.period);
 if(allowed.includes(initialSelection.comparison))selection.comparison=initialSelection.comparison;
 if(typeof initialSelection.anchor==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(initialSelection.anchor)&&Number.isFinite(Date.parse(initialSelection.anchor+'T12:00:00Z'))&&new Date(initialSelection.anchor+'T12:00:00Z').toISOString().slice(0,10)===initialSelection.anchor)selection.anchor=initialSelection.anchor;
 const context=()=>[card._hass?.connection,card._hass?.user?.id,card._hass?.user?.is_active,card._hass?.user?.is_admin,card._hass?.connected,card._hass?.config?.time_zone,card._hass?.connection?.connected,card._hass?.callWS,JSON.stringify([card._hass?.user?.is_owner,card._hass?.user?.groups,card._hass?.user?.group_ids])];
 const same=(a,b)=>a&&b&&a.every((v,i)=>v===b[i]);
 const active=()=>card.isConnected&&root?.isConnected&&card._analysisMode==='calendar'&&card._activeTab==='energy';
 const text=(en,pl)=>String(card._hass?.locale?.language||card._hass?.language||'en').startsWith('pl')?pl:en;
 const controller=createEnergyAnalysisV53({card,onChange:()=>{paint();card._invalidateReviewedExport?.();}});
 const binding=createEnergyAnalysisBindingV53({card,controller,onInvalidate:()=>{started=false;ticket++;root?.replaceChildren();if(active())void read();}});
 function observe(){const next=context(),changed=!same(identity,next);if(changed){calendarOpen=false;started=false;ticket++;root?.replaceChildren();identity=next;binding.stop();}binding.observe();return changed;}
 function exportState(){if(!active())return {status:'idle',selection:null,snapshot:null,error:null};observe();const state=binding.observe(),grant=card._calendarAccessGate?.state();if(grant&&(grant.status!=='ready'||grant.analysis?.visible!==true||grant.analysis?.read!==true||state.snapshot&&state.snapshot.context.feature_access_revision!==grant.revision))return {status:'error',selection:state.selection,snapshot:null,error:'analysis_access_unconfirmed'};return selectionPending?{status:'loading',selection:{...selection},snapshot:null,error:null}:state;}
 function paint(){
  if(!active())return;
  const state=exportState(),view=createEnergyAnalysisViewV53({card});
  if(card._simpleReport?.()){card._renderSimpleReport(root,state,true);return;}
  const calendar=root.querySelector('[data-analysis-calendar-options]');if(calendar)calendarOpen=calendar.open;
  const focused=root.getRootNode().activeElement,saved=root.contains(focused)?{action:focused.dataset.analysisAction,value:focused.dataset.analysisValue,draft:focused.matches('input')?focused.value:null}:null;
  root.innerHTML=`<style>${view.styles()}</style>`;
  const nav=root.ownerDocument.createElement('nav');nav.setAttribute('aria-label',text('Calendar report views','Widoki raportu kalendarzowego'));
  for(const [key,en,pl]of [['overview','Summary','Podsumowanie'],['comparison','Comparison','Porównanie'],['rates','Rates and costs','Stawki i koszty']]){const b=root.ownerDocument.createElement('button');b.type='button';b.className='action';b.dataset.analysisAction='section';b.dataset.analysisValue=key;b.setAttribute('aria-pressed',String(section===key));b.textContent=text(en,pl);nav.append(b);}for(const format of ['csv','json']){let b=exportButtons.get(format);if(!b){b=root.ownerDocument.createElement('button');b.type='button';b.className='action';b.dataset.smartCalendarExport=format;b.addEventListener('click',()=>card._downloadExport(format));exportButtons.set(format,b);}b.disabled=state.status!=='ready';b.textContent=text('Export ','Eksport ')+format.toUpperCase();nav.append(b);}root.append(nav);
  const body=root.ownerDocument.createElement('div');
  if(state.status==='ready')body.innerHTML=view.markup(state.snapshot,{...selection,...options,section});
  else{const p=root.ownerDocument.createElement('p');p.setAttribute('role','status');p.textContent=state.status==='error'?(state.error==='unknown_command'?text('Install or update HA Tools Email to use calendar analysis. Your standalone reports remain available.','Zainstaluj lub zaktualizuj HA Tools Email, aby korzystać z analizy kalendarzowej. Samodzielne raporty pozostają dostępne.'):text('Calendar analysis unavailable. Access or the server response could not be confirmed.','Analiza kalendarzowa niedostępna. Nie potwierdzono dostępu lub odpowiedzi serwera.')):text('Loading calendar analysis…','Ładowanie analizy kalendarzowej…');body.append(p);}root.append(body);
  const retry=root.ownerDocument.createElement('button');retry.type='button';retry.className='action';retry.dataset.analysisAction='retry';retry.textContent=text('Retry','Ponów');root.append(retry);
  const nextCalendar=root.querySelector('[data-analysis-calendar-options]');if(nextCalendar)nextCalendar.open=calendarOpen;
  if(saved){const next=[...root.querySelectorAll('[data-analysis-action]')].find(e=>e.dataset.analysisAction===saved.action&&e.dataset.analysisValue===saved.value);if(next){if(saved.draft!==null&&next.matches('input'))next.value=saved.draft;next.focus({preventScroll:true});}}
 }
 async function read(){if(!active())return;const token=++ticket,before=binding.observe();started=true;await binding.read(selection);if(token===ticket&&active()){const changed=selectionPending;selectionPending=false;const after=binding.observe();if(changed||before.status!==after.status||before.error!==after.error||before.snapshot?.snapshot_id!==after.snapshot?.snapshot_id)paint();if(changed)card._invalidateReviewedExport?.();}}
 function action(event){
  const el=event.target.closest('[data-analysis-action]');if(!el||!root?.contains(el))return;
  if(event.type==='click'&&el.matches('select,input')||event.type==='change'&&!el.matches('select,input'))return;
  const key=el.dataset.analysisAction,value=el.matches('select,input')?el.value:el.dataset.analysisValue;
  if(key==='retry'){card._calendarAccessGate?.refresh();binding.invalidate();started=false;void read();return;}
  if(key==='section'&&['overview','comparison','rates'].includes(value))section=value;
  else if(key==='period'&&['day','week','month','year'].includes(value)){selection.period=value;if(!allowedComparisons(value).includes(selection.comparison))selection.comparison='previous';}
  else if(key==='anchor'){if(value)selection.anchor=value;else delete selection.anchor;}
  else if(key==='comparison')selection.comparison=value;
  else if(key==='level'&&['areas','floors','devices'].includes(value))options.level=value;
  else if(key==='view'&&['chart','data'].includes(value))options.view=value;
  else if(key==='point')options.selected=value;
  else return;
  if(['period','anchor','comparison'].includes(key)){options.selected=null;selectionPending=true;card._invalidateReviewedExport?.();void read();}else paint();
 }
 function mount(next){observe();if(!next?.isConnected){stop();return;}if(root!==next){if(root){root.removeEventListener('click',action);root.removeEventListener('change',action);}root=next;root.addEventListener('click',action);root.addEventListener('change',action);}paint();if(!started)void read();}
 function refresh(){observe();if(!active())return;const focused=root.getRootNode().activeElement;if(root.contains(focused)&&focused.matches('input,select'))return;void read();}
 function stop(){exportButtons.clear();selectionPending=false;calendarOpen=false;started=false;ticket++;if(root){root.removeEventListener('click',action);root.removeEventListener('change',action);root.replaceChildren();root=null;}binding.stop();identity=null;}
 return {mount,stop,observe,refresh,state:exportState,selection:()=>({...selection})};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createSmartAnalysisHostV53};
