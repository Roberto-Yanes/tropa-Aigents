import {Engine} from '../engine.mjs';
import {readFileSync} from 'node:fs';
import {workspace,listFiles} from '../files.mjs';
const dir=new URL('../data/tool-check/',import.meta.url).pathname;
const e=new Engine(dir);
try {
 const team=e.addTeam({name:'Verificación técnica de herramientas',agents:[{name:'Investigador GPT',provider:'codex',tools:true,instructions:'Usá búsqueda web para consultar https://www.python.org/about/ . Guardá fuentes.md con una explicación breve de qué es Python y la URL consultada. Usá las herramientas reales de búsqueda y escritura. Contestá indicando archivo y URL.'},{name:'Revisor Claude',provider:'claude',tools:true,instructions:'Leé fuentes.md con tu herramienta Read. Consultá https://www.python.org/about/ con WebFetch para contrastar. Escribí revision.md con el resultado y la URL. No simules archivos ni consultas. Informá si una herramienta falla.'}]});
 const r=e.start(team.id,'Verificar búsqueda web y transferencia mediante archivos. Entregá fuentes.md y revision.md. Máximo 150 palabras por archivo.');console.log('RUN '+r.id);await e.active.get(r.id).done;
 const result=e.get(r.id);console.log(JSON.stringify({status:result.status,steps:result.steps,error:result.error,files:listFiles(dir,r.id)},null,2));
 if(result.status!=='completed')throw Error(result.error);
 for(const name of ['fuentes.md','revision.md'])console.log(name+': '+readFileSync(workspace(dir,r.id)+'/'+name,'utf8'));
}finally{await e.close();}
