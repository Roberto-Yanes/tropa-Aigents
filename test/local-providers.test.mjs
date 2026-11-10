import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localModels,runLocal} from '../local-providers.mjs';
import {validateTeam} from '../engine.mjs';

test('Ollama usa los modelos detectados y devuelve la respuesta real del servidor',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push([url,options]);return new Response(JSON.stringify(url.endsWith('/tags')?{models:[{name:'llama3:latest'}]}:{response:'Respuesta local'}));};
 assert.deepEqual(await localModels('ollama',{fetcher}),['llama3:latest']);
 assert.equal(await runLocal('ollama',{model:''},'Hola',undefined,{fetcher}),'Respuesta local');
 const body=JSON.parse(calls.at(-1)[1].body);assert.equal(body.model,'llama3:latest');assert.equal(body.prompt,'Hola');assert.equal(body.stream,false);
 await assert.rejects(runLocal('ollama',{model:'desconocido'},'Hola',undefined,{fetcher}),/no está disponible/);
});
test('LM Studio usa su interfaz local de chat y no acepta servidores arbitrarios',async()=>{
 const fetcher=async(url,options)=>new Response(JSON.stringify(url.endsWith('/models')?{data:[{id:'local-model'}]}:{choices:[{message:{content:JSON.parse(options.body).messages[0].content}}]}));
 assert.equal(await runLocal('lmstudio',{model:'local-model'},'Pregunta',undefined,{fetcher}),'Pregunta');
 await assert.rejects(localModels('https://otro-sitio',{fetcher}),/desconocido/);
});
test('los proveedores locales se pueden agregar como agentes sin herramientas no soportadas',()=>{
 for(const provider of ['ollama','lmstudio']){
  const team=validateTeam({name:'Local',agents:[{name:'A',provider,instructions:'Ayudá'}]});assert.equal(team.agents[0].provider,provider);
  assert.throws(()=>validateTeam({name:'Local',agents:[{name:'A',provider,instructions:'Ayudá',browser:true}]}),/Navegador/);
 }
});
