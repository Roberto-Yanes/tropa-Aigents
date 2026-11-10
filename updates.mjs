import {readFile} from 'node:fs/promises';

export const MANIFEST_URL='https://galateasoftware.com.ar/tropa/releases/latest.json';
export async function installedVersion(){return JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8')).version;}
const DOWNLOAD_ROOT='https://galateasoftware.com.ar/tropa/downloads/';
const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a,b){
  if(!versionPattern.test(a)||!versionPattern.test(b))throw Error('Versión de actualización inválida.');
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<3;i++){if(!Number.isSafeInteger(x[i])||!Number.isSafeInteger(y[i]))throw Error('Versión de actualización inválida.');if(x[i]!==y[i])return x[i]>y[i]?1:-1;}return 0;
}
export async function checkUpdates({fetcher=fetch,platform=process.platform,arch=process.arch,currentVersion}={}){
  const current=currentVersion||await installedVersion();
  compareVersions(current,current);
  const response=await fetcher(MANIFEST_URL,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw Error('No se pudo consultar la versión disponible.');
  const length=Number(response.headers.get('content-length')||0);if(length>16384)throw Error('Información de actualización inválida.');
  const text=await response.text();if(text.length>16384)throw Error('Información de actualización inválida.');
  const manifest=JSON.parse(text),available=compareVersions(manifest.version,current)>0;
  const key=`${platform}-${arch}`,file=manifest.installers?.[key];
  if(file!==undefined&&(typeof file!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(file)))throw Error('Información de descarga inválida.');
  return {currentVersion:current,latestVersion:manifest.version,available,platform,arch,downloadUrl:available&&file?DOWNLOAD_ROOT+file:null};
}
