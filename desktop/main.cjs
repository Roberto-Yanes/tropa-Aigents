const {app,BrowserWindow,dialog,shell}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
app.setName('Agentes Comunidad');
let win,backend,setupChild,origin,quitting=false;
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(async()=>{
  const windowIcon=path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'stage'),'backend','public','tropa-icon.png');
  win=new BrowserWindow({icon:windowIcon,width:1320,height:880,minWidth:850,minHeight:600,backgroundColor:'#16161a',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(u.origin==='https://accounts.google.com'&&u.pathname==='/o/oauth2/v2/auth')shell.openExternal(url);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!origin||new URL(url).origin!==origin)event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  await win.loadFile(path.join(__dirname,'loading.html'));
  const resources=app.isPackaged?process.resourcesPath:path.join(__dirname,'stage');
  const backendDir=path.join(resources,'backend');const runtime=path.join(resources,'runtime');
  const node=path.join(runtime,process.platform==='win32'?'node.exe':'bin/node');
  const data=path.join(app.getPath('userData'),'data');
  const browsers=path.join(app.getPath('userData'),'browsers');
  const extraPaths=[process.platform==='win32'?runtime:path.join(runtime,'bin'),path.join(app.getPath('home'),'.local','bin'),path.join(app.getPath('home'),'.kimi-code','bin')];
  if(process.platform==='win32')extraPaths.push(path.join(process.env.APPDATA||'', 'npm'));
  else extraPaths.push('/opt/homebrew/bin','/usr/local/bin');
  const env={...process.env,PATH:[...extraPaths,process.env.PATH].join(path.delimiter),COMMUNITY_DATA_DIR:data,PLAYWRIGHT_BROWSERS_PATH:browsers};
  const chrome=process.platform==='darwin'?fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'):process.platform==='win32'?[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).some(p=>fs.existsSync(path.join(p,'Google/Chrome/Application/chrome.exe'))):fs.existsSync('/opt/google/chrome/chrome');
  env.COMMUNITY_BROWSER_CHANNEL=chrome?'chrome':'chromium';
  try {
   if(!chrome)await new Promise((resolve,reject)=>{const child=setupChild=spawn(node,[path.join(backendDir,'node_modules/playwright/cli.js'),'install','chromium'],{env,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('exit',c=>c===0?resolve():reject(Error('No se pudo preparar Chromium. Comprobá la conexión a Internet y volvé a abrir la app.')));});
   backend=spawn(node,[path.join(backendDir,'desktop-entry.mjs')],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
   let lastError='';backend.stderr.on('data',b=>{lastError=(lastError+b.toString()).slice(-2000);});
   backend.on('message',async message=>{if(message.type==='ready'){origin=message.url;await win.loadURL(origin);}});
   backend.on('error',e=>dialog.showErrorBox('No se pudo iniciar el motor',e.message));
   backend.on('exit',code=>{if(!quitting){dialog.showErrorBox('El motor se detuvo',lastError||`Salida ${code}. Cerrá otras copias del MVP que usen el puerto 4318.`);app.quit();}});
  }catch(e){dialog.showErrorBox('No se pudo iniciar Agentes Comunidad',e.message);app.quit();}
 });
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;setupChild?.kill();if(backend?.connected)backend.send({type:'shutdown'});if(backend){const child=backend;setTimeout(()=>child.kill(),4000).unref();}});
}
