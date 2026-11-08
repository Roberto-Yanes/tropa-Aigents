import {test} from 'node:test';import assert from 'node:assert/strict';import {GoogleSession,GOOGLE_SCOPES} from '../google-connectors.mjs';
test('Google connection is restored and explicitly disconnected through secure storage',async()=>{
 let stored={refreshToken:'refresh-private',clientId:'client',clientSecret:'secret',email:'test@example.test',services:['gmail']};
 const vault={load:async()=>stored,save:async value=>{stored=value;},delete:async()=>{stored=null;}};
 const fetchImpl=async()=>Response.json({access_token:'new-private',expires_in:3600});
 const session=new GoogleSession({vault,fetchImpl});await session.ready;
 assert.equal(session.status().persisted,true);assert.equal(session.status().connected,true);
 assert.equal(await session.token('gmail'),'new-private');assert.ok(!JSON.stringify(session.status()).includes('private'));
 session.close();assert.ok(stored);
 const restored=new GoogleSession({vault,fetchImpl});await restored.ready;assert.equal(restored.status().connected,true);
 await restored.disconnect();assert.equal(stored,null);assert.equal(restored.status().connected,false);
});
test('Google OAuth uses PKCE and state, exposes no token and applies read-only scopes',async()=>{
 let exchangeBody;const fake=async(url,options={})=>{if(String(url).includes('/token')){exchangeBody=new URLSearchParams(options.body);return Response.json({access_token:'secret-access',refresh_token:'secret-refresh',scope:`openid email ${GOOGLE_SCOPES.gmail} ${GOOGLE_SCOPES.calendar}`,expires_in:3600});}if(String(url).includes('userinfo'))return Response.json({email:'test@example.test',email_verified:true});if(String(url).includes('/messages?'))return Response.json({messages:[{id:'abc'}]});if(String(url).includes('/messages/abc'))return Response.json({id:'abc',snippet:'hello',payload:{headers:[{name:'Subject',value:'subject'}]}});if(String(url).includes('/events?'))return Response.json({items:[{id:'e',summary:'meeting',start:{date:'2026-11-08'},end:{date:'2026-11-09'}}]});throw Error('unexpected endpoint');};
 const g=new GoogleSession({fetchImpl:fake});try{const started=await g.start({clientId:'123-abc.apps.googleusercontent.com',clientSecret:'client-secret',services:['gmail','calendar']});const url=new URL(started.url),cb=new URL(url.searchParams.get('redirect_uri'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(url.searchParams.get('scope'),/gmail.readonly/);assert.ok(!url.toString().includes('client-secret'));cb.searchParams.set('state','bad');cb.searchParams.set('code','c');assert.equal((await fetch(cb)).status,403);cb.searchParams.set('state',url.searchParams.get('state'));assert.equal((await fetch(cb)).status,200);assert.ok(exchangeBody.get('code_verifier'));assert.equal(g.status().email,'test@example.test');assert.ok(!JSON.stringify(g.status()).includes('secret'));assert.equal((await g.listMail('subject:test',2)).messages[0].id,'abc');assert.equal((await g.listEvents('2026-11-08T00:00:00Z','2026-11-09T00:00:00Z')).events[0].id,'e');g.disconnect();await assert.rejects(()=>g.listMail(),/no disponible/);}finally{g.disconnect();}
});

test('team grants are bound to the account and do not cross teams',async()=>{
 const {Engine}=await import('../engine.mjs');const {mkdtempSync,rmSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const dir=mkdtempSync(join(tmpdir(),'google-grant-'));const e=new Engine(dir);
 try{const a=e.addTeam({name:'A',agents:[{name:'Agente',provider:'codex',instructions:'Ayudar'}]});const b=e.addTeam({name:'B',agents:[{name:'Otro',provider:'claude',instructions:'Ayudar'}]});e.setGoogleAccess(a.id,['gmail'],'one@example.test');assert.deepEqual(e.googleAccess(a.id,'one@example.test'),['gmail']);assert.deepEqual(e.googleAccess(a.id,'two@example.test'),[]);assert.deepEqual(e.googleAccess(b.id,'one@example.test'),[]);assert.throws(()=>e.setGoogleAccess(a.id,['unknown'],'one@example.test'));}finally{await e.close();rmSync(dir,{recursive:true,force:true});}
});
