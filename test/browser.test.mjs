import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualBrowser, publicIP } from '../browser-service.mjs';
test('browser blocks local network URLs except its exact demo routes',async()=>{
 const b=new VisualBrowser(()=> 'http://127.0.0.1:4318');
 try{
  assert.equal(await b.allowed('http://127.0.0.1:4318/browser-demo'),true);
  for(const url of ['http://127.0.0.1:4318/api/state','file:///etc/passwd','https://127.0.0.1/','https://10.0.0.1/','https://[::1]/'])await assert.rejects(()=>b.allowed(url));
  assert.equal(publicIP('192.168.1.1'),false);assert.equal(publicIP('169.254.169.254'),false);assert.equal(publicIP('8.8.8.8'),true);
 }finally{await b.closeAll();}
});
test('browser approval is single-use, bound to page, and rejected on release',async()=>{
 const b=new VisualBrowser(()=> 'http://127.0.0.1:4318');const controller=new AbortController();
 const access=b.bind('r','Agent',controller.signal);const s={page:{url:()=> 'https://example.org/'},history:[],agent:'Agent',touched:Date.now(),pending:null};b.sessions.set('r',s);
 try{
  const promise=b.approval(s,{type:'Completar campo'},b.keys.get(access.key).signal);const id=s.pending.id;
  b.decide('r',id,true);await promise;assert.throws(()=>b.decide('r',id,true));
  const rejected=b.approval(s,{type:'Enviar'},b.keys.get(access.key).signal);access.release();await assert.rejects(rejected,/cancelada/);assert.equal(s.pending,null);assert.equal(b.keys.has(access.key),false);
  const other=b.bind('r','Agent',controller.signal);const changed=b.approval(s,{type:'Clic'},b.keys.get(other.key).signal);const changedId=s.pending.id;s.page.url=()=> 'https://elsewhere.org/';b.decide('r',changedId,true);await assert.rejects(changed,/cambió/);other.release();
 }finally{b.sessions.clear();await b.closeAll();}
});
