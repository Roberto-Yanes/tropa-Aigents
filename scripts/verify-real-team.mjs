import { Engine } from '../engine.mjs';
import { inspectProviders } from '../providers.mjs';
import { randomBytes } from 'node:crypto';
const connections=await inspectProviders();
console.log(JSON.stringify(connections.filter(p=>['codex','claude'].includes(p.id)).map(({id,accountState,accountLabel})=>({id,accountState,accountLabel}))));
if(!connections.filter(p=>['codex','claude'].includes(p.id)).every(p=>p.accountState==='connected'))throw Error('Falta una sesión de cuenta oficial.');
const engine=new Engine(new URL('../data/',import.meta.url).pathname);
try {
 const team=engine.addTeam({name:'Operaciones · GPT + Claude',agents:[
 {name:'Analista GPT',provider:'codex',instructions:'Calculá la facturación total, cobros y saldo pendiente por pedido usando exclusivamente los datos del objetivo. Creá un código de revisión propio de 8 caracteres, distinto del identificador del objetivo, y escribilo como CODIGO_ANALISTA. No lo omitas.'},
 {name:'Auditor Claude',provider:'claude',instructions:'Auditá los cálculos del Analista GPT disponibles en resultados previos. Repetí exactamente su CODIGO_ANALISTA para demostrar que leíste su entrega. Identificá errores o confirmá la conciliación. Agregá una recomendación concreta llamada RECOMENDACION_AUDITOR.'},
 {name:'Coordinador GPT',provider:'codex',instructions:'Prepará un informe final breve para el responsable. Citá exactamente el CODIGO_ANALISTA y la RECOMENDACION_AUDITOR recibidos en los resultados previos. Incluí totales auditados, prioridades y próximos pasos. Aclará que los pedidos son datos de prueba y no se enviaron mensajes externos.'}
 ]});
 const marker=randomBytes(5).toString('hex');
 const run=engine.start(team.id,`Prueba real de traspaso ${marker}. Datos ficticios en ARS: Pedido A: 3 unidades a 12000, cobrado 18000. Pedido B: 2 unidades a 18500, cobrado 37000. Pedido C: 5 unidades a 4200, cobrado 0. Analizar saldos, auditar y entregar informe operativo. No consultar archivos ni internet. No enviar comunicaciones. Respondé en no más de 220 palabras por agente.`);
 console.log('RUN_ID='+run.id);
 await engine.active.get(run.id).done;
 const result=engine.get(run.id);
 console.log(JSON.stringify(result,null,2));
 if(result.status!=='completed')process.exitCode=1;
}finally{await engine.close();}
