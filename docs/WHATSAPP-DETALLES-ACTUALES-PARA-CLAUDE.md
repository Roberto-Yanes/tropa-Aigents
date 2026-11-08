# Tropa AI: detalles actuales para implementar WhatsApp

Revisión del código de `community-agents/` al 8 de noviembre de 2026. Este documento describe lo que existe hoy. **No existe un canal WhatsApp, Baileys, UI de QR ni bus de eventos de aplicación.** Las rutas son relativas a la raíz del repositorio. El canal propuesto hablaría con el agente principal desde el proceso backend Node; su implementación queda pendiente.

## 1. Ciclo de vida

### Cierre de Electron y backend

`desktop/main.cjs`:

```js
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{quitting=true;setupChild?.kill();if(backend?.connected)backend.send({type:'shutdown'});if(backend){const child=backend;setTimeout(()=>child.kill(),4000).unref();}});
```

Cerrar la última ventana termina Electron, envía `shutdown` al backend y, si sigue vivo cuatro segundos después, llama `child.kill()`. No hay icono de bandeja, servicio en segundo plano, arranque automático al iniciar sesión ni `powerSaveBlocker`. WhatsApp dejaría de estar conectado al cerrar la ventana si no se cambia el ciclo de vida. Tampoco hay mecanismo de autoactualización ni `electron-updater`.

`desktop-entry.mjs`:

```js
let closing=false;async function close(){if(closing)return;closing=true;server.close();await engine.close();process.exit(0);}
process.on('message',m=>{if(m?.type==='shutdown')close();});process.on('disconnect',close);process.once('SIGTERM',close);process.once('SIGINT',close);
```

No hay manejador propio `process.on('exit')`. `Engine.close()` cancela las ejecuciones activas, espera sus promesas y cierra SQLite:

```js
async close() { this.closed = true; const current = [...this.active.values()]; current.forEach(c => c.abort()); await Promise.all(current.map(c => c.done)); this.db.close(); }
```

En `server.mjs`, el cierre se envuelve para detener scheduler, Google y navegadores:

```js
const closeEngine=engine.close.bind(engine); engine.close=async()=>{clearInterval(timer);google.close?.();googleKeys.clear();await closeEngine();await browsers.closeAll();};
```

Es un punto existente para integrar el cierre limpio de WhatsApp; hay que considerar el límite de cuatro segundos de Electron y no depender de una limpieza asíncrona tras un apagado forzado.

### IPC entre Electron y backend

`desktop/main.cjs` inicia el proceso Node con IPC:

```js
backend=spawn(node,[path.join(backendDir,'desktop-entry.mjs')],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
backend.on('message',async message=>{if(message.type==='ready'){origin=message.url;await win.loadURL(origin);}});
```

El canal Node IPC es bidireccional. Los únicos mensajes de aplicación implementados son backend → Electron `{type:'ready',url}` y Electron → backend `{type:'shutdown'}`. No hay protocolo de petición/respuesta con IDs, ni integración con `safeStorage`, ni cifrado propio del intercambio IPC. Cualquier paso de secretos cifrados requiere implementarse.

## 2. Empaquetado y dependencias

### `package.json` completo del backend

```json
{
  "name": "community-agents",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=24" },
  "scripts": { "start": "node server.mjs", "test": "node --test" },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "0.3.319",
    "@modelcontextprotocol/sdk": "1.32.2",
    "playwright": "1.65.0"
  }
}
```

### `desktop/package.json` completo

```json
{
  "name": "agentes-comunidad-desktop",
  "version": "0.1.0",
  "description": "Equipos de agentes con tus cuentas de IA",
  "author": "Comunidad Agentes",
  "private": true,
  "license": "Apache-2.0",
  "main": "main.cjs",
  "devDependencies": {
    "electron": "45.2.3",
    "electron-builder": "26.18.0"
  },
  "build": {
    "appId": "org.comunidad.agentes",
    "productName": "Agentes Comunidad",
    "asar": true,
    "directories": { "output": "../release-native" },
    "files": ["main.cjs", "loading.html", "package.json"],
    "extraResources": [
      { "from": "stage/backend", "to": "backend" },
      { "from": "stage/runtime", "to": "runtime" }
    ],
    "linux": {
      "target": ["deb", "AppImage"],
      "category": "Office",
      "maintainer": "Comunidad Agentes",
      "icon": "icons/icon.png"
    },
    "win": {
      "target": ["nsis"],
      "signAndEditExecutable": false,
      "icon": "icons/tropa-ai.ico"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "deleteAppDataOnUninstall": false
    },
    "mac": {
      "target": ["dmg"],
      "category": "public.app-category.productivity",
      "identity": null,
      "icon": "icons/tropa-ai.icns"
    },
    "dmg": { "sign": false },
    "artifactName": "Agentes-Comunidad-${version}-${os}-${arch}.${ext}",
    "afterPack": "after-pack.cjs"
  },
  "homepage": "http://127.0.0.1:4318",
  "desktopName": "org.comunidad.agentes.desktop"
}
```

Desktop no declara `scripts`, `type` ni `asarUnpack`. Electron es 45.2.3, electron-builder 26.18.0; `desktop/prepare.py` prepara Node 24.22.1, copia el backend a `stage/backend` y ejecuta `npm ci --omit=dev` para la plataforma y arquitectura. `extraResources` coloca backend y runtime fuera del ASAR de Electron. `desktop/after-pack.cjs` copia explícitamente los `node_modules`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  await fs.cp(path.join(__dirname, 'stage', 'backend', 'node_modules'), path.join(resources, 'backend', 'node_modules'), {recursive: true});
};
```

El lockfile incluye binarios opcionales de `@anthropic-ai/claude-agent-sdk` por plataforma/arquitectura. Playwright usa navegadores externos, y SQLite usa `node:sqlite` integrado en Node. La persistencia Google de Linux usa `python3` y `secretstorage` del sistema. `desktop/README.md` explica que electron-builder excluía `node_modules` y por eso se copian en `after-pack`; no documenta prueba definitiva de instalación y ejecución en Windows/macOS. No hay evidencia suficiente para afirmar un fallo concreto de runtime en esos sistemas.

## 3. Motor: enganches

### Guardado de runs

`engine.mjs`:

```js
save(r) { this.db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?)').run(r.id, JSON.stringify(r)); }
```

Todos los llamadores directos de `this.save` son:

- `Engine.constructor()`: marca `interrupted` runs recuperados que estaban `running` o `queued`.
- `startSnapshot()`: crea el run inicial en `queued`.
- `executeDirectChat()`: inicio `running`, agente actual, delegaciones, respuestas, finalización y error/cancelación.
- `executeTeamChat()`: inicio, agente actual, respuestas/delegaciones, finalización y error/cancelación.
- `execute()`: inicio, agente actual, cada etapa, finalización y error/cancelación.

`resume()` y `cancel()` no guardan directamente; relanzan o abortan y la ejecución termina guardando. Emitir después de `save` observaría esos cambios, pero se emite más de un guardado por etapa o finalización: un consumidor debe filtrar y soportar duplicados. No existe bus de eventos durable, cursor ni garantía de entrega de mensajes WhatsApp.

### Lectura de run y ajustes

```js
runs() { return this.db.prepare('SELECT body FROM runs ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
get(id) { const r = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id); if (!r) throw new Error('Ejecución no encontrada.'); return JSON.parse(r.body); }
mainTeamId() { return this.db.prepare("SELECT value FROM settings WHERE key='mainTeamId'").get()?.value || null; }
```

No existen getters/setters genéricos de `settings`. Se accede de forma específica desde `mainTeamId()`, `createMain(body)`, `googleAccess(teamId,email)` y `setGoogleAccess(teamId,services,email)`.

### Límite de concurrencia

`Engine.active` es un `Map` en memoria. `chat(teamId,index,message)` termina llamando `startSnapshot(team,objective,source,files=[])`:

```js
startSnapshot(team, objective, source, files=[]) {
  if (this.closed || this.active.size >= 2) throw new Error('El motor está ocupado o cerrado.');
  team = {...validateTeam(team), id: team.id};
  const run = { source, id: randomUUID(), team, objective: string(objective, 'Objetivo', 12000), status: 'queued', steps: [], createdAt: new Date().toISOString(), error: '' };
  addInputs(this.dir,run.id,files);
  this.save(run); this.launch(run.id); return this.get(run.id);
}
```

Con dos activos, `chat()` lanza `Error('El motor está ocupado o cerrado.')` antes de crear el run. No encola ni guarda el mensaje. `queued` es el estado inicial de una ejecución aceptada, no una cola de espera de capacidad.

### Contrato de `chat`

```js
chat(teamId, index, message) {
  const teams=this.teams(), team=teams.find(t=>t.id===teamId);
  if(!team||!Number.isInteger(index)||index<0||index>=team.agents.length)throw Error('Agente no encontrado.');
  message=string(message,'Mensaje',4000);
  const prior=this.chatRuns(teamId,index);if(prior.some(r=>['queued','running'].includes(r.status)))throw Error('Esperá a que termine la respuesta anterior.');
  // ...
}
```

- `mainTeamId()` devuelve `null` si no hay equipo principal. `chat(null,0,...)` lanza `Error('Agente no encontrado.')`; no hay error especial para la ausencia de Atlas.
- Si ya existe un chat pendiente para el mismo par equipo/índice, lanza `Error('Esperá a que termine la respuesta anterior.')`.
- Un valor que no es string, vacío luego de `trim()`, o de más de 4.000 unidades de longitud de JavaScript produce `Error('Mensaje: valor vacío o demasiado largo.')`.
- Esos son errores `Error` comunes. Por HTTP el servidor los devuelve como JSON con status 400.

El run de chat colaborativo completado guarda el mensaje final en `run.steps.filter(x=>x.kind==='final').at(-1)?.output`, con `target:'Vos'`. El mensaje de error de un run fallido es `run.error`. Para demo, que usa ejecución secuencial, el motor hace fallback a `run.steps.at(-1)?.output` porque sus pasos no llevan `kind:'final'`.

### Origen y privacidad de historial

El `source` guarda `kind`, `teamId`, `index`, `message` y, en chat colaborativo, participantes, historial, pila y contador; no existe `source.channel`. Una propiedad adicional se serializaría dentro del JSON y no es rechazada por los filtros actuales. Sin embargo, `chat()` no acepta un argumento de origen y crea `source` internamente: asignar `channel` solo al run retornado no asegura persistencia ni evita carreras, ya que el run ya fue lanzado. Debe incorporarse antes de `startSnapshot()`.

`chatRuns(teamId,index)` filtra por equipo e índice, no por canal. Si se agrega WhatsApp sin cambiar el diseño, el historial del mismo agente se mezcla entre interfaz y WhatsApp. También hay un único chat pendiente por par equipo/índice, independientemente del canal.

## 4. Aprobaciones de navegador

### Sesiones y runId

`browser-service.mjs` inicializa `this.sessions = new Map()` y `this.keys = new Map()`. La clave de `sessions` es el **runId**. La firma y registro de capacidad son:

```js
bind(runId,agent,signal,policy={mode:"isolated",sites:[]}){const key=randomBytes(32).toString('hex');const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();this.keys.set(key,{runId,agent,policy,signal:controller.signal});return {key,release:()=>{controller.abort();signal.removeEventListener('abort',abort);this.keys.delete(key);}};}
```

Cada llamada recupera el `binding`, busca la sesión por `binding.runId` y asigna `s.agent=binding.agent`. Varios agentes del mismo run pueden compartir sesión; `s.agent` es el agente de la acción actual. `sessions` y `pending` viven en memoria.

### Consulta y decisión desde la interfaz

`server.mjs`:

```js
const browserRead=path.match(/^\/api\/runs\/([a-f0-9-]{36})\/browser$/);
if(req.method==='GET'&&browserRead){engine.get(browserRead[1]);return send(200,browsers.state(browserRead[1]));}
```

```js
const browserAction=path.match(/^\/api\/runs\/([a-f0-9-]{36})\/browser\/(decide|close)$/);
if(browserAction){engine.get(browserAction[1]);if(browserAction[2]==='close')await browsers.close(browserAction[1]);else {if(typeof body.allow!=='boolean')throw Error('Decisión inválida.');browsers.decide(browserAction[1],body.id,body.allow);}return send(200,{ok:true});}
```

`public/app.js`, `loadBrowser(id)`, consulta `api(`runs/${id}/browser`)`, muestra `b.pending.action` y los botones invocan:

```js
if(b.dataset.browserDecision){await api(`runs/${b.dataset.run}/browser/decide`,{id:b.dataset.browserDecision,allow:b.dataset.allow==='true'});await loadBrowser(b.dataset.run);}
```

La UI se entera por polling, no eventos push. `state(id)` expone `pending` como `{id,action,url}`. `approval(s,action,signal)` permite una pendiente por sesión y espera cinco minutos; si cambia la URL, se cancela, se cierra o vence, se rechaza. El reinicio pierde la aprobación de memoria. Puede haber pendientes en varias sesiones/runs a la vez, sujetos al límite de dos ejecuciones y al control exclusivo del navegador interno personal.

### Objetos `action` reales

En apertura de navegador aislado/interno:

```js
{type:'Abrir página',url:args.url}
```

Para click, fill, select y press:

```js
{type:{click:'Hacer clic',fill:'Completar campo',select:'Seleccionar opción',press:'Pulsar tecla'}[action],target:desc.label.slice(0,250),destination:desc.destination,value:args.value??args.key}
```

En navegador personal con extensión, la apertura usa `{type:'Abrir con tu sesión personal',url:args.url}` y las acciones:

```js
{type:action,target:el.label,destination:el.destination||s.url,value:args.value??args.key,session:'Tu navegador personal'}
```

`value` puede contener información privada. No registrar el contenido de mensajes o valores en logs. No hay callback de aplicación que notifique una nueva aprobación a WhatsApp; habría que agregar uno o un mecanismo equivalente.

## 5. Interfaz

La UI es HTML, CSS y JavaScript plano, sin framework React/Vue y sin librería QR instalada. `public/app.js` mantiene `view`, construye HTML con plantillas e `innerHTML`, utiliza botones `data-view` y listeners delegados.

```js
async function api(path, body) {
  const r = await fetch(`/api/${path}`, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await r.json(); if (!r.ok) throw new Error(data.error || 'No se pudo completar la acción.'); return data;
}
```

La pantalla de Google está en `async renderConnectors()`; consulta catálogo, estado y permisos mediante:

```js
const [items,status,grants]=await Promise.all([api('connectors'),api('google/status'),Promise.all(state.teams.map(async t=>({id:t.id,services:(await api(`teams/${t.id}/google-access`)).services})))]);
```

Al guardar un formulario `.google-grant`:

```js
await api(`teams/${f.dataset.team}/google-access`,{services:['gmail','calendar'].filter(n=>f.elements[n].checked)});
```

Una pantalla WhatsApp deberá agregar navegación, vista, QR/estado y endpoints; nada de eso existe todavía. El `api()` actual presupone respuestas JSON.

## 6. Calidad y convenciones

No existe un logger central estructurado de aplicación. Hay `console.log` / `console.error` puntuales de arranque y scripts de verificación que pueden imprimir resultados completos. `browser-service.mjs` mantiene un historial en memoria (últimas 40 entradas):

```js
log(s,text,counts=true){if(counts)s.actionCount=(s.actionCount||0)+1;s.history.push({at:new Date().toISOString(),agent:s.agent,text});s.history=s.history.slice(-40);s.touched=Date.now();}
```

Puede guardar URLs, etiquetas y errores en memoria. Evitar logs de WhatsApp no evita que el motor guarde el texto del chat y sus respuestas en SQLite `runs.body`: deben definirse explícitamente las políticas de almacenamiento y acceso.

### Test representativo

`test/chat.test.mjs` usa `node:test`, `node:assert/strict`, directorio temporal y proveedor inyectado:

```js
test('direct chat persists turns and gives the next invocation the previous answer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'agent-chat-'));const prompts=[];
 const engine=new Engine(dir,async (_agent,prompt)=>{prompts.push(prompt);return JSON.stringify({accion:'finalizar',mensaje:`respuesta ${prompts.length}`});});
 try{
  const team=engine.addTeam({name:'Equipo',agents:[{name:'Ana',provider:'codex',instructions:'Ayudá'}]});
  const first=engine.chat(team.id,0,'Hola');await engine.active.get(first.id).done;
  const second=engine.chat(team.id,0,'Continuá');await engine.active.get(second.id).done;
  assert.match(prompts[1],/Hola/);assert.match(prompts[1],/respuesta 1/);
  assert.deepEqual(engine.chatRuns(team.id,0).map(r=>r.source.message),['Hola','Continuá']);
  assert.throws(()=>engine.chat(team.id,2,'Hola'),/Agente no encontrado/);
 }finally{await engine.close();rmSync(dir,{recursive:true,force:true});}
});
```

Aunque el test declara `provider:'codex'`, inyecta el proveedor y no llama a Codex. Otros tests usan agentes `provider:'demo'`. Ejecutar con `npm test`.

El backend usa ESM `.mjs`, Electron principal y `after-pack` usan CommonJS `.cjs`; variables y métodos suelen estar en inglés, mensajes al usuario en español rioplatense. La persistencia usa JSON en SQLite sin ORM. La UI tiene código compacto y handlers delegados; no se encontró configuración formal de lint o formatter. Se favorece la inyección de dependencias en pruebas para evitar servicios externos reales.
