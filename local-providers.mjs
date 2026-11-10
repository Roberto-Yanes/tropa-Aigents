// Only known loopback services are supported; never forward credentials or arbitrary URLs.
const services={ollama:{base:'http://127.0.0.1:11434',list:'/api/tags',run:'/api/generate'},lmstudio:{base:'http://127.0.0.1:1234',list:'/v1/models',run:'/v1/chat/completions'}};
export async function localModels(id,{fetcher=fetch,signal}={}){
 const service=services[id];if(!service)throw Error('Proveedor local desconocido.');
 const response=await fetcher(service.base+service.list,{signal:signal||AbortSignal.timeout(3000),redirect:'error'});
 if(!response.ok)throw Error('Servidor local no disponible.');
 const data=await response.json();const items=id==='ollama'?data.models:data.data;
 if(!Array.isArray(items))throw Error('Lista de modelos inválida.');
 return items.map(item=>id==='ollama'?item.name:item.id).filter(name=>typeof name==='string'&&name.length>0&&name.length<=100&&!/[\r\n]/.test(name)).slice(0,100);
}
export async function runLocal(id,agent,prompt,signal,{fetcher=fetch}={}){
 const service=services[id];if(!service)throw Error('Proveedor local desconocido.');
 const models=await localModels(id,{fetcher,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(3000)]):undefined});
 const model=agent.model||models[0];if(!model)throw Error('No hay modelos locales disponibles. Descargá o cargá uno en la aplicación correspondiente.');
 if(!models.includes(model))throw Error('El modelo elegido no está disponible en el servidor local.');
 const body=id==='ollama'?{model,prompt,stream:false}:{model,messages:[{role:'user',content:prompt}],stream:false};
 const response=await fetcher(service.base+service.run,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1200000)]):AbortSignal.timeout(1200000),redirect:'error'});
 if(!response.ok)throw Error('El servidor local no pudo completar la respuesta.');
 const data=await response.json(),text=id==='ollama'?data.response:data.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim()||text.length>2000000)throw Error('Respuesta local inválida.');
 return text;
}
