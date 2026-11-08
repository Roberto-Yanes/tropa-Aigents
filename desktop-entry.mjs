import {createApp} from './server.mjs';
const {server,engine}=createApp({dir:process.env.COMMUNITY_DATA_DIR});
server.on('error',async e=>{console.error(e.code==='EADDRINUSE'?'El puerto del MVP está ocupado. Cerrá la otra instancia antes de abrir esta aplicación.':e.message);await engine.close();process.exit(1);});
server.listen(Number(process.env.COMMUNITY_PORT||4318),'127.0.0.1',()=>process.send?.({type:'ready',url:`http://127.0.0.1:${server.address().port}`}));
let closing=false;async function close(){if(closing)return;closing=true;server.close();await engine.close();process.exit(0);}
process.on('message',m=>{if(m?.type==='shutdown')close();});process.on('disconnect',close);process.once('SIGTERM',close);process.once('SIGINT',close);
