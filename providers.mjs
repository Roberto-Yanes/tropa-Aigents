import {nativeCommand} from './native-command.mjs';
import {localModels,runLocal} from './local-providers.mjs';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const providers = [
  { id: 'codex', name: 'Codex · cuenta ChatGPT', login: 'codex login', detail: 'Usa tu sesión de ChatGPT en Codex. Podés habilitar búsqueda web y escritura en la carpeta de trabajo por agente.' },
  { id: 'claude', name: 'Claude Code · cuenta propia', login: 'claude auth login', detail: 'Usa tu sesión de Claude. Con herramientas habilitadas, puede consultar páginas y trabajar con archivos en modo restringido.' },
  { id: 'kimi', name: 'Kimi Code · cuenta propia', login: 'kimi login', detail: 'Usa la sesión de Kimi Code instalada en esta computadora, sin pedir una clave API.' },
  { id: 'ollama', name: 'Ollama · modelos locales', login: '', detail: 'Detecta los modelos del servidor local de Ollama en el puerto 11434. No requiere cuenta.' },
  { id: 'lmstudio', name: 'LM Studio · modelos locales', login: '', detail: 'Detecta los modelos del servidor local de LM Studio en el puerto 1234. Activá su servidor desde LM Studio.' },
  { id: 'gemini', name: 'Gemini CLI', login: '', supported: false, detail: 'Se detecta la instalación de Gemini CLI. La conexión para ejecutar agentes todavía está en desarrollo.' },
  { id: 'demo', name: 'Demostración · sin IA', login: '', detail: 'Respuestas simuladas para comprobar el flujo. No consume cuotas.' }
];

// Credentials stay with the official applications. Do not collect or persist their tokens.
export function nativeEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) =>
    !/API_KEY|AUTH_TOKEN|ACCESS_TOKEN|BEARER_TOKEN|^ANTHROPIC_BASE_URL$|^OPENAI_BASE_URL$|^CLAUDECODE$/.test(k)));
}

export function processCall(command, args, { cwd, input = '', signal, timeout = 180000, env = nativeEnv(), includeStderr = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Ejecución cancelada.'));
    const native=nativeCommand(command,args,env);
    const child = spawn(native.command, native.args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', bytes = 0, problem, settled = false, killTimer;
    function kill() {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500);
      killTimer.unref();
    }
    function stop(message) { problem ||= new Error(message); kill(); }
    const abort = () => stop('Ejecución cancelada.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('El proveedor superó el tiempo máximo de ejecución.'), timeout);
    const consume = (chunk, isOutput) => {
      bytes += chunk.length;
      if (bytes > 2000000) return stop('La respuesta superó el límite de tamaño.');
      if (isOutput || includeStderr) output += chunk.toString();
    };
    child.stdout.on('data', c => consume(c, true));
    child.stderr.on('data', c => consume(c, false));
    child.stdin.on('error', () => {});
    function finish(err) {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      err ? reject(err) : resolve(output);
    }
    child.on('error', () => finish(new Error(`No se pudo iniciar ${command}. Revisá su instalación y PATH.`)));
    child.on('close', code => finish(problem || (code !== 0 ? new Error(`${command} terminó con error (${code}). Revisá el inicio de sesión en su terminal oficial.`) : null)));
    child.stdin.end(input);
  });
}

// Ask Kimi's local authenticated server; its bearer token remains in memory only.
export async function queryKimiLocal(endpoint) {
  if(!['/api/v1/auth','/api/v1/oauth/usage'].includes(endpoint))throw Error('Consulta de Kimi no permitida.');
  const env = nativeEnv(), native = nativeCommand('kimi', ['web', '--port', '0', '--no-open'], env);
  return new Promise(resolve => {
    const child = spawn(native.command, native.args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', checking = false, finished = false;
    const finish = result => { if (finished) return; finished = true; clearTimeout(timer); child.kill(); resolve(result); };
    const timer = setTimeout(() => finish(null), 20000);
    const read = async chunk => {
      output += chunk.toString();
      if (output.length > 16384) return finish(null);
      const url = output.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0];
      const token = output.match(/Token:\s*(\S+)/)?.[1];
      if (!url || !token || checking) return;
      checking = true;
      try {
        const response = await fetch(`${url}${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
        const body=await response.json();if(!response.ok)throw Error('Estado no disponible');finish(body?.data||null);
      } catch { finish(null); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
  });
}

export async function inspectKimiAccount() {
 const status=(await queryKimiLocal('/api/v1/auth'))?.managed_provider?.status;
 if(!status)return {accountState:'unknown',accountLabel:'No se pudo comprobar la sesión'};
 return status==='authenticated'?{accountState:'connected',accountLabel:'Kimi conectado'}:{accountState:'disconnected',accountLabel:status==='expired'?'Sesión de Kimi vencida':'Iniciá sesión con Kimi'};
}

export async function inspectProviders() {
  return Promise.all(providers.map(async p => {
    if (p.id === 'demo') return { ...p, installed: true, version: 'Simulación' };
    if(['ollama','lmstudio'].includes(p.id)){
      try{const models=await localModels(p.id);return {...p,installed:true,version:models.length?`${models.length} modelo(s) disponible(s)`:'Sin modelos disponibles',models,accountState:models.length?'connected':'disconnected',accountLabel:models.length?'Servidor local disponible':'Sin modelos disponibles'};}
      catch{return {...p,installed:false,version:'',accountState:'unknown',accountLabel:'Servidor local no detectado'};}
    }
    try {
      const version = await processCall(p.id, ['--version'], { timeout: 8000 });
      if(p.supported===false)return {...p,installed:true,version:version.trim().slice(0,120),accountState:'unknown',accountLabel:'Detectado · integración pendiente'};
      let accountState = 'unknown', accountLabel = 'Sesión sin comprobar';
      try {
        if(p.id==='codex') {
          const status=await processCall('codex',['login','status'],{timeout:8000,includeStderr:true});
          accountState=status.includes('Logged in using ChatGPT')?'connected':'other';
          accountLabel=accountState==='connected'?'ChatGPT conectado':'Otro método de acceso';
        }
        if(p.id==='claude') {
          const status=JSON.parse(await processCall('claude',['auth','status'],{timeout:8000}));
          accountState=status.loggedIn&&status.authMethod==='claude.ai'?'connected':'disconnected';
          accountLabel=accountState==='connected'?'Claude conectado':'Iniciá sesión con Claude';
        }
        if(p.id==='kimi') ({ accountState, accountLabel } = await inspectKimiAccount());
      } catch { accountState='disconnected'; accountLabel='Sesión no disponible'; }
      return { ...p, installed: true, version: version.trim().slice(0, 120), accountState, accountLabel, usage: null };
    } catch { return { ...p, installed: false, version: '' }; }
  }));
}

export async function runProvider(agent, prompt, cwd, signal, browserAccess, googleAccess) {
  if(['ollama','lmstudio'].includes(agent.provider))return runLocal(agent.provider,agent,prompt,signal);
  if (agent.provider === 'demo') {
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(t); reject(new Error('Ejecución cancelada.')); };
      const t = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 700);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    return `[DEMOSTRACIÓN — sin IA]\n${agent.name} recibió la tarea y el contexto anterior.\nRol: ${agent.instructions}\nEn una ejecución real, aquí aparecerá su resultado.`;
  }
  const browserCommand={command:process.execPath,args:[fileURLToPath(new URL('./browser-mcp.mjs',import.meta.url))],env:browserAccess?{COMMUNITY_BROWSER_URL:browserAccess.url,COMMUNITY_BROWSER_KEY:browserAccess.key}:{}};
  const browserConfig=agent.browser&&browserAccess;
  // Only this local broker is trusted by the CLI; external actions are gated in the app UI.
  const codexBrowser=browserConfig?['-c',`mcp_servers.visual_browser.command=${JSON.stringify(browserCommand.command)}`,'-c',`mcp_servers.visual_browser.args=${JSON.stringify(browserCommand.args)}`,'-c',`mcp_servers.visual_browser.env={COMMUNITY_BROWSER_URL=${JSON.stringify(browserAccess.url)},COMMUNITY_BROWSER_KEY=${JSON.stringify(browserAccess.key)}}`,'-c','mcp_servers.visual_browser.tool_timeout_sec=360','-c','mcp_servers.visual_browser.default_tools_approval_mode="approve"']:[];
  const mcpServers={...(browserConfig?{visual_browser:browserCommand}:{}),...(googleAccess?{google:{command:process.execPath,args:[fileURLToPath(new URL('./google-mcp.mjs',import.meta.url))],env:{TROPA_GOOGLE_URL:googleAccess.url,TROPA_GOOGLE_CAPABILITY:googleAccess.key}}}:{})};
  const claudeBrowser=Object.keys(mcpServers).length?['--mcp-config',JSON.stringify({mcpServers})]:[];
  const claudeTools=agent.tools?'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch':'';
  const claudeAllowed=[claudeTools,browserConfig?'mcp__visual_browser__*':'',googleAccess?'mcp__google__*':''].filter(Boolean).join(',');
  const googleCommand=googleAccess?{command:process.execPath,args:[fileURLToPath(new URL('./google-mcp.mjs',import.meta.url))],env:{TROPA_GOOGLE_URL:googleAccess.url,TROPA_GOOGLE_CAPABILITY:googleAccess.key}}:null;
  const codexGoogle=googleCommand?['-c',`mcp_servers.google.command=${JSON.stringify(googleCommand.command)}`,'-c',`mcp_servers.google.args=${JSON.stringify(googleCommand.args)}`,'-c',`mcp_servers.google.env={TROPA_GOOGLE_URL=${JSON.stringify(googleAccess.url)},TROPA_GOOGLE_CAPABILITY=${JSON.stringify(googleAccess.key)}}`,'-c','mcp_servers.google.tool_timeout_sec=60','-c','mcp_servers.google.default_tools_approval_mode="approve"']:[];
  const model = agent.model ? ['--model', agent.model] : [];
  if (agent.provider === 'codex') {
    const file = join(cwd, '.last-response.txt');
    const events = await processCall('codex', ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--sandbox', agent.tools?'workspace-write':'read-only', '-c', agent.tools?'web_search="live"':'web_search="disabled"', '--color', 'never', ...(browserConfig?['--json']:[]), ...codexBrowser, ...codexGoogle, ...model, '-o', file, '-'], { cwd, input: prompt, signal, timeout:agent.browser?1200000:agent.tools?480000:180000 });
    if(browserConfig){const records=events.split('\n').flatMap(line=>{try{const e=JSON.parse(line);if(e.item?.type==='mcp_tool_call'||e.type==='error')return [{type:e.type,item:e.item?{type:e.item.type,server:e.item.server,tool:e.item.tool,status:e.item.status,error:e.item.error,result:e.item.result?.content?.filter(c=>c.type==='text')}:undefined,message:e.message}];}catch{}return [];});await writeFile(join(cwd,'.browser-tool-diagnostics.json'),JSON.stringify(records,null,2));}
    return await readFile(file, 'utf8');
  }
  if (agent.provider === 'claude') {
    const out = await processCall('claude', ['-p', '--output-format', 'json', '--tools', claudeTools, ...(agent.tools||agent.browser||googleAccess?['--restricted',...(!agent.browser&&!googleAccess?['--safe-mode']:['--disable-slash-commands','--settings','{"disableAllHooks":true}']),'--allowedTools',claudeAllowed]:[]), ...claudeBrowser, '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', ...model], { cwd, input: prompt, signal, timeout:agent.browser?1200000:agent.tools?480000:180000 });
    let result;
    try { result = JSON.parse(out); } catch { throw new Error('Claude devolvió un formato no reconocido.'); }
    if (result.is_error || typeof result.result !== 'string') throw new Error('Claude no completó la tarea. Revisá su cuenta y cuota en la aplicación oficial.');
    return result.result;
  }
  if (agent.provider === 'kimi') {
    return await processCall('kimi', [...model, '--prompt', prompt, '--output-format', 'text'], { cwd, signal });
  }
  throw new Error('Proveedor no compatible.');
}
