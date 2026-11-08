const BASE='http://127.0.0.1:4318';
let token=null,grants=new Map(),runs=new Map(),busy=false,loaded=false;
const origin=url=>{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Sólo pestañas HTTPS.');return u.origin;};
async function init(){if(loaded)return;const saved=await chrome.storage.session.get(['token','grants']);token=saved.token||null;grants=new Map(saved.grants||[]);loaded=true;}
async function save(){await chrome.storage.session.set({token,grants:[...grants]});}
async function request(path,body){const r=await fetch(BASE+'/extension/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Error(data.error||'MVP no disponible');return data;}
const send=(tabId,method,params={})=>chrome.debugger.sendCommand({tabId},method,params);
async function detach(runId){const r=runs.get(runId);if(!r)return;runs.delete(runId);await chrome.debugger.detach({tabId:r.tabId}).catch(()=>{});}
async function disconnect(){for(const id of [...runs.keys()])await detach(id);token=null;grants.clear();await save();}
async function validTab(r,sites){const t=await chrome.tabs.get(r.tabId);const current=origin(t.url);if(grants.get(t.id)!==current||!sites.includes(current))throw Error('La pestaña ya no está compartida o cambió a un sitio no permitido.');return t;}
async function world(r){const tree=await send(r.tabId,'Page.getFrameTree');const w=await send(r.tabId,'Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'community-agents'});return w.executionContextId;}
async function evaluate(r,fn,args){const result=await send(r.tabId,'Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(args)})`,contextId:await world(r),returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text||'La página cambió durante la acción.');return result.result.value;}
// Only these packaged functions run in a private world. No model-supplied JavaScript.
function inspectPage(){
 const map=new Map(),elements=[],nonce=crypto.randomUUID();let i=0;
 for(const el of document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="checkbox"],[contenteditable="true"]')){
  if(i>=80)break;const rect=el.getBoundingClientRect();if(!rect.width||!rect.height||getComputedStyle(el).visibility==='hidden')continue;
  const ref=nonce+':'+(++i);map.set(ref,el);elements.push({ref,tag:el.tagName.toLowerCase(),type:el.type||'',label:(el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.placeholder||el.name||'').slice(0,250),value:el.type==='password'?'[oculto]':String(el.value||'').slice(0,200),destination:el.href||el.form?.action||null,options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.text})):undefined});
 }
 globalThis.communityRefs=map;return {url:location.href,title:document.title,text:document.body.innerText.slice(0,12000),elements};
}
function performAction({action,args,sites,expectedUrl}){
 if(location.href!==expectedUrl||!sites.includes(location.origin))throw Error('La página cambió. Volvé a inspeccionar.');
 if(action==='scroll'){scrollBy(0,args.direction==='up'?-550:550);return;}
 const el=globalThis.communityRefs?.get(args.ref);if(!el?.isConnected)throw Error('Referencia vencida.');
 if(el.type==='password'||el.type==='file')throw Error('Este campo requiere intervención manual.');
 const dest=el.href||el.form?.action;if(dest&&!sites.includes(new URL(dest,location.href).origin))throw Error('Destino no autorizado.');
 if(action==='click')el.click();
 else if(action==='fill'){
   if(el.isContentEditable)el.textContent=args.value;
   else {const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,args.value);}
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
 }else if(action==='select'){if(el.tagName!=='SELECT')throw Error('No es una selección.');el.value=args.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
 else if(action==='press'){el.focus();return true;}
}
async function snapshot(r,sites){await validTab(r,sites);const s=await evaluate(r,inspectPage,{});if(!sites.includes(origin(s.url)))throw Error('Sitio no autorizado.');const shot=await send(r.tabId,'Page.captureScreenshot',{format:'jpeg',quality:60,captureBeyondViewport:false});await validTab(r,sites);return {...s,screenshot:shot.data};}
async function execute(c){
 if(c.expires<Date.now())throw Error('Acción vencida.');
 if(c.action==='release'){await detach(c.runId);return {};}
 if(!['open','inspect','click','fill','select','press','scroll'].includes(c.action))throw Error('Acción no permitida.');
 if(!Array.isArray(c.sites)||c.sites.length>20)throw Error('Permisos inválidos.');
 let r=runs.get(c.runId);
 if(c.action==='open'){
  const site=origin(c.args.url);if(!c.sites.includes(site))throw Error('Sitio no autorizado para este equipo.');
  if(r&&grants.get(r.tabId)!==site){await detach(c.runId);r=null;}
  if(!r){const entry=[...grants].find(([id,o])=>o===site&&![...runs.values()].some(r=>r.tabId===id));if(!entry)throw Error('Compartí una pestaña de este sitio desde la extensión. Puede estar ocupada por otro equipo.');r={tabId:entry[0],sites:c.sites,touched:Date.now()};await validTab(r,c.sites);await chrome.debugger.attach({tabId:r.tabId},'1.3');runs.set(c.runId,r);await send(r.tabId,'Page.enable');await send(r.tabId,'Fetch.enable',{patterns:[{urlPattern:'*',resourceType:'Document',requestStage:'Request'}]});}
 }else if(!r)throw Error('Primero abrí un sitio con browser_open.');
 r.sites=c.sites;r.touched=Date.now();const tab=await validTab(r,c.sites);
 if(c.args.expectedUrl&&tab.url!==c.args.expectedUrl)throw Error('La pestaña cambió después de la autorización. Inspeccioná de nuevo.');
 if(!(await request('active',{id:c.id})).active)throw Error('Acción cancelada.');
 if(c.action==='open'){
  if(tab.url!==c.args.url){const result=await send(r.tabId,'Page.navigate',{url:c.args.url});if(result.errorText)throw Error(result.errorText);}
 }else if(!['inspect'].includes(c.action)){
  await evaluate(r,performAction,{action:c.action,args:c.args,sites:c.sites,expectedUrl:tab.url});
  if(c.action==='press'){
   const keys={Enter:13,Tab:9,Escape:27,ArrowDown:40,ArrowUp:38};const key=c.args.key;if(!keys[key])throw Error('Tecla no permitida.');
   await send(r.tabId,'Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:keys[key]});await send(r.tabId,'Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:keys[key]});
  }
 }
 // Wait for this tab's document, never retry a write when a navigation races it.
 for(let n=0;n<30;n++){const t=await chrome.tabs.get(r.tabId);if(t.status==='complete')break;await new Promise(resolve=>setTimeout(resolve,100));}
 return snapshot(r,c.sites);
}
chrome.debugger.onEvent.addListener((source,method,p)=>{if(method!=='Fetch.requestPaused')return;const r=[...runs.values()].find(r=>r.tabId===source.tabId);let allowed=false;try{allowed=!!r&&r.sites.includes(origin(p.request.url))&&grants.get(source.tabId)===origin(p.request.url);}catch{}send(source.tabId,allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});});
chrome.debugger.onDetach.addListener(source=>{for(const [id,r]of runs)if(r.tabId===source.tabId)runs.delete(id);});
chrome.tabs.onRemoved.addListener(id=>{grants.delete(id);for(const [run,r]of runs)if(r.tabId===id)runs.delete(run);save();});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url&&grants.has(id)){let same=false;try{same=origin(change.url)===grants.get(id);}catch{}if(!same){grants.delete(id);for(const [run,r]of runs)if(r.tabId===id)detach(run);save();}}});
async function tick(){await init();if(busy||!token)return;busy=true;try{for(const [id,r]of runs)if(Date.now()-r.touched>1200000)await detach(id);const {command}=await request('poll',{tabs:[...grants].map(([id,origin])=>({id,origin}))});if(command){let result,error;try{result=await execute(command);}catch(e){error=e.message;}await request('result',{id:command.id,result,error});}}catch(e){if(/revocada|vincular/.test(e.message))await disconnect();}finally{busy=false;}}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id)return; (async()=>{await init();if(m.type==='pair'){const data=await request('pair',{code:m.code});await disconnect();token=data.token;await save();await tick();return {};}
 if(m.type==='status')return {connected:!!token,tabs:[...grants].map(([id,origin])=>({id,origin}))};
 if(m.type==='share'){if(!token)throw Error('Vinculá primero con el MVP.');const t=await chrome.tabs.get(m.tabId);const site=origin(t.url);if(origin(m.url)!==site)throw Error('La pestaña cambió.');grants.set(t.id,site);await save();await tick();return {};}
 if(m.type==='unshare'){grants.delete(m.tabId);for(const [id,r]of runs)if(r.tabId===m.tabId)await detach(id);await save();await tick();return {};}
 if(m.type==='disconnect'){await request('disconnect',{}).catch(()=>{});await disconnect();return {};}
 throw Error('Solicitud desconocida.');})().then(reply,e=>reply({error:e.message}));return true;});
chrome.alarms.create('poll',{periodInMinutes:0.5});chrome.alarms.onAlarm.addListener(tick);setInterval(tick,1000);tick();
