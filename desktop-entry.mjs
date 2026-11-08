import {createApp} from './server.mjs';
import {randomUUID} from 'node:crypto';
const pending=new Map();
const onAutostart=enabled=>new Promise((resolve,reject)=>{if(!process.send)return reject(Error('Es necesario abrir Tropa como aplicación de escritorio.'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('No se pudo configurar el inicio automático.'));},5000);pending.set(id,{resolve,reject,timer});process.send({type:'autostart:set',id,enabled});});
const {server,engine}=createApp({dir:process.env.COMMUNITY_DATA_DIR,onChannelStatus:status=>process.send?.({type:'channel-status',status}),onAutostart});
server.on('error',async e=>{console.error(e.code==='EADDRINUSE'?'El puerto del MVP está ocupado. Cerrá la otra instancia antes de abrir esta aplicación.':e.message);await engine.close();process.exit(1);});
server.listen(Number(process.env.COMMUNITY_PORT||4318),'127.0.0.1',()=>process.send?.({type:'ready',url:`http://127.0.0.1:${server.address().port}`}));
let closing=false;async function close(){if(closing)return;closing=true;server.close();await engine.close();process.exit(0);}
process.on('message',m=>{if(m?.type==='shutdown')close();if(m?.type==='autostart:result'){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.ok?p.resolve():p.reject(Error('No se pudo configurar el inicio automático.'));}}});process.on('disconnect',close);process.once('SIGTERM',close);process.once('SIGINT',close);
