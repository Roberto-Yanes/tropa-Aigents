const $=s=>document.querySelector(s);
async function message(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(r.error)throw Error(r.error);return r;}
async function render(){const s=await message('status');$('#status').textContent=s.connected?'Vinculada. Compartí una pestaña y elegí su sitio en el equipo.':'Sin conexión';$('#tabs').replaceChildren();for(const t of s.tabs){const b=document.createElement('button');b.textContent='Dejar de compartir '+t.origin;b.onclick=()=>perform(async()=>{await message('unshare',{tabId:t.id});await render();});$('#tabs').append(b);}}
async function perform(fn){try{await fn();}catch(e){$('#status').textContent=e.message;}}
$('#pair').onclick=()=>perform(async()=>{await message('pair',{code:$('#code').value.trim()});$('#code').value='';await render();});
$('#share').onclick=()=>perform(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await message('share',{tabId:tab.id,url:tab.url});await render();});
$('#disconnect').onclick=()=>perform(async()=>{await message('disconnect');await render();});
perform(render);
