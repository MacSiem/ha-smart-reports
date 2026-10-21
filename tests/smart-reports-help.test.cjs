"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadRuntime,makeHass}=require('./helpers/smart-reports-harness.cjs');
test('Full report help explains separate sources and exports, preserves open state across language changes, and stays out of summary',()=>{
 const dom=loadRuntime(),w=dom.window,card=w.document.createElement('ha-smart-reports');try{card.setConfig({show_support:false});w.document.body.append(card);const h=makeHass();card.hass=h;const help=card.shadowRoot.querySelector('[data-smart-help]');assert.ok(help);assert.equal(help.open,false);help.open=true;assert.match(help.textContent,/Missing measurements are not zero/);assert.match(help.textContent,/Calendar.*historical rate versions/);h.language='pl';card.hass=h;assert.equal(card.shadowRoot.querySelector('[data-smart-help]'),help);assert.equal(help.open,true);assert.match(help.textContent,/Jak czytać raport/);card.setConfig({variant:'compact'});assert.equal(help.hidden,true);card.setConfig({variant:'full',show_help:false});assert.equal(help.hidden,true);}finally{card.remove();w.close();}
});
