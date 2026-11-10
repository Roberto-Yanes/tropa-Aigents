import test from 'node:test';
import assert from 'node:assert/strict';
import {checkUpdates,compareVersions,MANIFEST_URL} from '../updates.mjs';

const response=body=>new Response(JSON.stringify(body),{status:200});
test('compara versiones numéricamente y rechaza entradas inválidas',()=>{
  assert.equal(compareVersions('1.10.0','1.9.9'),1);
  assert.equal(compareVersions('1.2.0','1.2.0'),0);
  assert.throws(()=>compareVersions('1.2.0-beta','1.2.0'));
});
test('ofrece solo el instalador para el sistema y arquitectura actuales',async()=>{
  const fetcher=async url=>{assert.equal(url,MANIFEST_URL);return response({version:'0.2.0',installers:{'linux-x64':'Tropa-0.2.0.deb'}});};
  const found=await checkUpdates({fetcher,currentVersion:'0.1.0',platform:'linux',arch:'x64'});
  assert.equal(found.available,true);assert.equal(found.downloadUrl,'https://galateasoftware.com.ar/tropa/downloads/Tropa-0.2.0.deb');
  const other=await checkUpdates({fetcher,currentVersion:'0.1.0',platform:'darwin',arch:'arm64'});assert.equal(other.downloadUrl,null);
  const same=await checkUpdates({fetcher,currentVersion:'0.2.0',platform:'linux',arch:'x64'});assert.equal(same.available,false);assert.equal(same.downloadUrl,null);
});
test('rechaza rutas o URL externas en el manifiesto',async()=>{
  for(const file of ['../evil.exe','https://bad.example/a.exe','x.exe?bad'])
    await assert.rejects(checkUpdates({fetcher:async()=>response({version:'0.2.0',installers:{'win32-x64':file}}),currentVersion:'0.1.0',platform:'win32',arch:'x64'}));
});
