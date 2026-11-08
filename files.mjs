import { readdirSync, lstatSync, mkdirSync, writeFileSync, openSync, readFileSync, closeSync, constants } from 'node:fs';
import { join, resolve, sep } from 'node:path';
export function workspace(dir,id){return resolve(dir,'runs',id,'workspace');}
export function addInputs(dir,id,files=[]) {
 if(!Array.isArray(files)||files.length>5)throw Error('Máximo: cinco archivos de texto.');
 let total=0;const names=new Set();
 for(const f of files){if(typeof f.name!=='string'||!/^[\p{L}\p{N}_ .-]+\.(txt|md|csv|json)$/u.test(f.name)||f.name.length>100||f.name.startsWith('.')||names.has(f.name)||typeof f.content!=='string')throw Error('Archivo de entrada inválido o repetido.');names.add(f.name);total+=Buffer.byteLength(f.content);}
 if(total>50000)throw Error('Los archivos de entrada no pueden superar 50 KB en total.');
 const root=workspace(dir,id);mkdirSync(root,{recursive:true,mode:0o700});
 for(const f of files)writeFileSync(join(root,f.name),f.content,{mode:0o600,flag:'wx'});
}
export function listFiles(dir,id){
 const root=workspace(dir,id),result=[];
 function walk(folder,prefix='',depth=0){if(depth>5||result.length>=100)return;let entries;try{entries=readdirSync(folder,{withFileTypes:true});}catch{return;}
 for(const e of entries){if(e.name.startsWith('.')||result.length>=100)continue;const path=join(folder,e.name),name=prefix+e.name;if(e.isSymbolicLink())continue;if(e.isDirectory())walk(path,name+'/',depth+1);else if(e.isFile()){const s=lstatSync(path);result.push({name,size:s.size});}}}
 walk(root);return result;
}
export function readArtifact(dir,id,name){
 if(typeof name!=='string'||!name||name.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||name.includes('\\'))throw Error('Ruta inválida.');
 const root=workspace(dir,id),target=resolve(root,name);if(!target.startsWith(root+sep))throw Error('Ruta inválida.');
 let current=root;for(const part of name.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('Enlaces no permitidos.');}
 const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=lstatSync(target);if(!s.isFile()||s.size>2000000)throw Error('Archivo no disponible o mayor a 2 MB.');return readFileSync(fd);}finally{closeSync(fd);}
}
