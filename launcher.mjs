import {createApp} from './server.mjs';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
const base=process.platform==='win32'?process.env.LOCALAPPDATA||homedir():process.platform==='darwin'?join(homedir(),'Library','Application Support'):process.env.XDG_DATA_HOME||join(homedir(),'.local','share');
const dir=resolve(process.env.COMMUNITY_DATA_DIR||join(base,'AgentesComunidad','data'));
const port=Number(process.env.COMMUNITY_PORT||4318);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Puerto local inválido.');
const {server,engine}=createApp({dir});
server.on('error',async e=>{console.error(e.code==='EADDRINUSE'?'Ya hay un programa usando el puerto '+port+'. Cerrá la otra instancia del MVP.':e.message);await engine.close();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 const url=`http://127.0.0.1:${port}/`;console.log(`Agentes Comunidad: ${url}\nLos datos se guardan en ${dir}\nDejá esta ventana abierta mientras trabajan tus agentes. Ctrl+C detiene el motor.`);
 if(process.env.COMMUNITY_NO_OPEN!=='1'){
  const [command,args]=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
  const child=spawn(command,args,{stdio:'ignore',detached:true});child.on('error',()=>console.log('Abrí esta dirección en tu navegador: '+url));child.unref();
 }
});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{server.close();await engine.close();process.exit(0);});
