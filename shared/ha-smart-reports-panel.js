// Adapted from Baby b9c920486de82e06873a820f9fbe4733b8d1ac3f.
// HA owns the live hass after source detach. The real Smart child owns its reads.
function createSmartReportPanelV53({host,getHass,getConfig,getSourceKey,getSelection,
  applySelection,createGuard=typeof createTariffGuardV3==='function'?createTariffGuardV3:null}) {
  const doc=host.ownerDocument,win=doc.defaultView,tag='ha-tools-smart-report-panel-dialog-v53';
  const route=()=>win.location.pathname+win.location.search+win.location.hash;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const identity=h=>[h?.user?.id,h?.user?.is_admin===true,h?.user?.is_owner===true,
    h?.user?.is_active!==false,JSON.stringify(h?.user?.groups||[]),JSON.stringify(h?.user?.group_ids||[]),h?.connection,h?.callWS];
  const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  // Only selection primitives cross the boundary, never host/controller state.
  const seed=value=>{
    value=value||{};
    const selected={tab:['energy','automations','system'].includes(value.tab)?value.tab:null};
    if(['1d','7d','30d'].includes(value.recordedPeriod))selected.recordedPeriod=value.recordedPeriod;
    if(['summary','devices','costs'].includes(value.energyView))selected.energyView=value.energyView;
    if(['recorded','calendar'].includes(value.analysisMode))selected.analysisMode=value.analysisMode;
    const calendar=value.calendarSelection;
    if(calendar&&['day','week','month','year'].includes(calendar.period)){
      selected.calendarSelection={period:calendar.period};
      if(typeof calendar.anchor==='string')selected.calendarSelection.anchor=calendar.anchor;
      const comparisons=calendar.period==='day'?['previous','same_weekday','mean7']:['previous','year_ago'];
      if(comparisons.includes(calendar.comparison))selected.calendarSelection.comparison=calendar.comparison;
    }
    return selected;
  };
  if(!win.customElements.get(tag))win.customElements.define(tag,class extends win.HTMLElement {
    set hass(value){
      this._hass=value;this.style.colorScheme=value?.themes?.darkMode?'dark':'light';
      if(!this._request)return;
      this._guard?.observe();
      if(!this._current()){this.closeDialog();return;}
      if(this._card)this._card.hass=value;const close=this.querySelector('[data-smart-panel-close]');if(close)close.textContent=String(value?.locale?.language||value?.language||'en').startsWith('pl')?'Zamknij raport':'Close report';
      this._start();
    }
    get hass(){return this._hass;}
    _current(){
      const r=this._request,h=this._hass;
      return !!r&&!r.closed&&same(identity(h),r.identity)&&route()===r.route&&
        h?.connection?.connected!==false&&win.navigator.onLine!==false&&
        (!this._guard||this._guard.current(this._token,false));
    }
    showDialog(request){
      this.closeDialog();
      this._cancelFocusRestore?.();
      if(request.closed)return;
      this._request=request;request.owner=this;
      // HA can call showDialog before attaching the element/providing hass.
      win.queueMicrotask(()=>this._start());
    }
    connectedCallback(){this._start();}
    disconnectedCallback(){this.closeDialog();}
    _start(){
      const r=this._request;
      if(!r||r.closed||this._dialog||!this.isConnected||!this._hass)return;
      if(!this._current()){this.closeDialog();return;}
      if(!this._guard){
        this._guard=r.createGuard({getHass:()=>this._hass,
          getContext:()=>({config:r.config,route:route()}),browser:win});
        this._token=this._guard.snapshot();
        if(!this._guard.current(this._token,false)){this.closeDialog();return;}
        this._unsubscribe=this._guard.subscribe(()=>{if(!this._current())this.closeDialog();});
      }
      const dialog=doc.createElement('dialog');
      dialog.setAttribute('data-smart-report-panel','');dialog.setAttribute('aria-label',r.title);
      const style=doc.createElement('style');
      style.textContent='dialog[data-smart-report-panel]{box-sizing:border-box;width:min(1100px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:12px;border:1px solid var(--divider-color,#888);border-radius:16px;background:var(--primary-background-color,#fff);color:var(--primary-text-color,#222);overflow:auto}dialog[data-smart-report-panel]::backdrop{background:rgba(0,0,0,.5)}dialog[data-smart-report-panel] [data-smart-panel-close]{min-width:44px;min-height:44px;font:inherit;display:block;margin-inline-start:auto;margin-block-end:8px}dialog[data-smart-report-panel] :focus-visible{outline:3px solid var(--primary-color,#1565c0);outline-offset:2px}';
      const close=doc.createElement('button');close.type='button';close.setAttribute('data-smart-panel-close','');
      close.textContent=r.language==='pl'?'Zamknij raport':'Close report';
      close.addEventListener('click',()=>this.closeDialog());
      const card=doc.createElement('ha-smart-reports');
      card._inReportPanelV53=true; // Before config, hass, or connectedCallback.
      this._card=card;this._dialog=dialog;
      try{
        card.setConfig(clone(r.config));
        // Pure owner-supplied adapter; runs before hass/connected reads start.
        r.applySelection(card,clone(r.selection));
        card.hass=this._hass;
        dialog.append(style,close,card);this.append(dialog);
        dialog.addEventListener('cancel',event=>{event.preventDefault();if(this._dialog===dialog)this.closeDialog();});
        dialog.addEventListener('close',()=>{if(this._dialog===dialog)this.closeDialog();});
        this._leave=()=>this.closeDialog();
        for(const name of ['offline','location-changed','popstate','hashchange'])win.addEventListener(name,this._leave);
        dialog.showModal();close.focus({preventScroll:true});
      }catch(error){this.closeDialog();throw error;}
    }
    _restoreFocusAfterHa(opener,sourceCurrent,closedIdentity,closedRoute){
      this._cancelFocusRestore?.();
      let pending=true,frame,timer;
      const events=['show-dialog','pointerdown','keydown','focusin','location-changed','popstate','hashchange','offline'];
      const cancel=()=>{
        if(!pending)return;pending=false;
        for(const name of events)win.removeEventListener(name,cancel,true);
        if(frame!==undefined)win.cancelAnimationFrame(frame);
        if(timer!==undefined)win.clearTimeout(timer);
        if(this._cancelFocusRestore===cancel)this._cancelFocusRestore=null;
      };
      this._cancelFocusRestore=cancel;
      for(const name of events)win.addEventListener(name,cancel,true);
      // HA's dialog-closed handler blurs synchronously and restores its old
      // targets after rAF + timer. Register after dispatch, behind that handler.
      frame=win.requestAnimationFrame(()=>{
        frame=undefined;
        if(!pending)return;
        timer=win.setTimeout(()=>{
          const allowed=pending&&!this._request&&sourceCurrent()&&route()===closedRoute&&
            same(identity(this._hass),closedIdentity)&&this._hass?.connection?.connected!==false&&
            win.navigator.onLine!==false;
          cancel();if(!allowed)return;
          let focused=doc.activeElement;
          while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;
          if(focused&&focused!==doc.body&&focused!==doc.documentElement)return;
          if(opener?.isConnected)opener.focus({preventScroll:true});
        },0);
      });
    }
    closeDialog(){
      const r=this._request;if(!r)return true;
      this._cancelFocusRestore?.();
      const restore=this._current(),opener=r.opener,sourceCurrent=r.canRestoreFocus,
        closedIdentity=r.identity,closedRoute=r.route;
      this._request=null;r.owner=null;r.closed=true;
      this._unsubscribe?.();this._unsubscribe=null;
      this._guard?.dispose();this._guard=null;this._token=null;
      for(const name of ['offline','location-changed','popstate','hashchange'])win.removeEventListener(name,this._leave);
      this._leave=null;
      this._card?.remove();this._card=null;
      const dialog=this._dialog;this._dialog=null;dialog?.close();dialog?.remove();
      if(r.standalone&&restore&&sourceCurrent()&&opener?.isConnected)opener.focus({preventScroll:true});
      r.opener=null;r.config=null;r.selection=null;r.identity=null;r.applySelection=null;r.createGuard=null;
      this.dispatchEvent(new win.CustomEvent('dialog-closed',{detail:{dialog:tag},bubbles:true,composed:true}));
      if(!r.standalone&&restore&&sourceCurrent())this._restoreFocusAfterHa(opener,sourceCurrent,closedIdentity,closedRoute);
      r.canRestoreFocus=null;
      if(r.standalone)this.remove();
      return true;
    }
  });
  let request=null,sourceFocusEpoch=0;
  const close=()=>{
    const r=request;request=null;if(!r)return;
    if(r.owner)r.owner.closeDialog();
    else{r.closed=true;r.opener=null;r.config=null;r.selection=null;r.identity=null;r.applySelection=null;r.createGuard=null;}
  };
  return {
    open(opener){
      if(request&&!request.closed)return true;
      const h=getHass();
      if(!host.isConnected||host.preview||host._inReportPanelV53||!h?.user?.id||h.user.is_active===false||
        !h.connection||h.connection.connected===false||typeof h.callWS!=='function'||win.navigator.onLine===false||
        typeof createGuard!=='function'||typeof applySelection!=='function')return false;
      const config=clone(getConfig()),selection=seed(getSelection?.()),focusEpoch=sourceFocusEpoch,
        source=JSON.stringify(getSourceKey()),sourceIdentity=identity(h),sourceRoute=route();
      const available=['energy','automations','system'].filter(tab=>config['show_'+tab]!==false);
      selection.tab=available.includes(selection.tab)?selection.tab:available.includes(config.default_tab)?config.default_tab:available[0]||null;
      let ancestor=host;
      while(ancestor&&ancestor.localName!=='home-assistant')ancestor=ancestor.parentElement||ancestor.getRootNode?.().host;
      const native=typeof ancestor?.provideHass==='function';
      request={config:{...config,type:'custom:ha-smart-reports',variant:'full',compact:false,tap_target:'full',default_tab:selection.tab||'energy'},
        selection,identity:sourceIdentity,route:sourceRoute,source,
        canRestoreFocus:()=>host.isConnected&&sourceFocusEpoch===focusEpoch&&route()===sourceRoute&&
          JSON.stringify(getSourceKey())===source&&same(identity(getHass()),sourceIdentity)&&
          getHass()?.connection?.connected!==false&&win.navigator.onLine!==false,
        title:config.title||'Smart Reports',language:String(h.locale?.language||h.language||'en').startsWith('pl')?'pl':'en',
        opener,applySelection,createGuard,closed:false,standalone:!native};
      if(native)host.dispatchEvent(new win.CustomEvent('show-dialog',{bubbles:true,composed:true,
        detail:{dialogTag:tag,dialogImport:()=>Promise.resolve(),dialogParams:request,addHistory:false}}));
      else{
        const owner=doc.createElement(tag);owner.hass=h;owner.showDialog(request);doc.body.append(owner);
      }
      return true;
    },
    update(){
      if(!request||request.closed)return;
      // Native ownership survives source removal; never authorize from stale hass.
      if(!host.isConnected){if(request.standalone)close();return;}
      if(JSON.stringify(getSourceKey())!==request.source){close();return;}
      const h=getHass();
      if(!same(identity(h),request.identity)||h?.connection?.connected===false||route()!==request.route||win.navigator.onLine===false){close();return;}
      if(request.standalone&&request.owner)request.owner.hass=h;
    },
    close,
    sourceDisconnected(){sourceFocusEpoch++;if(request?.standalone)close();}
  };
}
if(typeof module!=='undefined'&&module.exports)module.exports={createSmartReportPanelV53};
