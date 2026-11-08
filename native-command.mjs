import {existsSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,delimiter} from 'node:path';
// Launch npm-installed CLIs with Node directly on Windows; never interpolate a shell command.
export function nativeCommand(command,args,env=process.env,platform=process.platform){
 if(platform!=='win32'){
  if(!['codex','claude','kimi'].includes(command))return {command,args};
  const home=env.HOME||homedir();const paths=(env.PATH||'').split(':');paths.push(join(home,'.local','bin'),join(home,'.kimi-code','bin'));
  const nvm=join(home,'.nvm','versions','node');try{for(const version of readdirSync(nvm).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})))paths.push(join(nvm,version,'bin'));}catch{}
  for(const dir of paths.filter(Boolean)){const file=join(dir,command);if(existsSync(file))return {command:file,args};}
  return {command,args};
 }
 const paths=(env.PATH||env.Path||'').split(';').filter(Boolean);
 const scripts={codex:['@openai','codex','bin','codex.js'],claude:['@anthropic-ai','claude-code','cli.js']};
 for(const dir of paths){const exe=join(dir,command+'.exe');if(existsSync(exe))return {command:exe,args};}
 if(scripts[command])for(const dir of paths){const script=join(dir,'node_modules',...scripts[command]);if(existsSync(script))return {command:process.execPath,args:[script,...args]};}
 return {command,args};
}
