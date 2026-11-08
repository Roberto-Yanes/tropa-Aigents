import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserPolicy,assertSite} from '../site-policy.mjs';
import {BrowserBridge} from '../browser-bridge.mjs';
import {Engine} from '../engine.mjs';
import {VisualBrowser} from '../browser-service.mjs';

test('site grants are exact origins, reject broad or non-HTTPS grants',()=>{
 assert.deepEqual(browserPolicy({mode:'existing',sites:['https://EXAMPLE.com/a','https://example.com/b']}),{mode:'existing',sites:['https://example.com']});
 for(const site of ['http://example.com','https://*.example.com','https://user:pass@example.com','https://127.0.0.1','https://example.com:444','https://example.com.'])assert.throws(()=>browserPolicy({mode:'existing',sites:[site]}));
 assert.throws(()=>assertSite('https://example.com.evil.org',['https://example.com']));
 assert.throws(()=>assertSite('https://sub.example.com',['https://example.com']));
 assert.throws(()=>browserPolicy({mode:'existing',sites:[]}));
});
function linked(){const b=new BrowserBridge();const {code}=b.pairing();const origin='chrome-extension://'+'a'.repeat(32);const {token}=b.connect(code,origin);return {b,token,origin};}
test('pairing is short lived and single-use; bridge binds token to extension',()=>{
 const b=new BrowserBridge();const p=b.pairing();p.expires=0;assert.throws(()=>b.connect(p.code,'x'));
 const {b:c,token,origin}=linked();assert.equal(c.authorized(token,origin),true);assert.equal(c.authorized(token,origin+'x'),false);assert.throws(()=>c.connect('bad',origin));c.revoke();assert.equal(c.authorized(token,origin),false);
});
test('extension commands are claimed once and cancelled or revoked without replay',async()=>{
 const {b}=linked();const c=new AbortController();const p=b.request('run','open',{url:'https://example.com'},['https://example.com'],c.signal);
 const command=b.poll([{id:2,origin:'https://example.com'}]);assert.ok(command.id);assert.equal(b.poll([]),null);c.abort();await assert.rejects(p,/cancelada/);assert.throws(()=>b.finish(command.id,{}));
 const q=b.request('run','inspect',{},['https://example.com'],new AbortController().signal);b.revoke();await assert.rejects(q,/revocada/);assert.equal(b.status().connected,false);
});
test('personal browser rejects unlisted site before creating approval or dispatching command',async()=>{
 const b=new VisualBrowser(()=> 'http://127.0.0.1:4318');const p=b.bridge.pairing();b.bridge.connect(p.code,'ext');const c=new AbortController();const access=b.bind('run','A',c.signal,{mode:'existing',sites:['https://example.com']});
 try{await assert.rejects(()=>b.call(access.key,'browser_open',{url:'https://evil.org'}),/autorizado/);assert.equal(b.state('run').pending,null);assert.equal(b.bridge.pending.size,0);}finally{access.release();b.sessions.clear();await b.closeAll();}
});
test('team access survives snapshot, is passed to provider, and changed permissions prevent resume',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'browser-access-'));let received;const engine=new Engine(dir,async(a,p,c,s,context)=>{received=context;throw Error('test interruption');});
 try{
 const team=engine.addTeam({name:'test',agents:[{name:'A',provider:'codex',instructions:'Inspect',browser:true}]});
 engine.setBrowserAccess(team.id,{mode:'existing',sites:['https://example.com']});
 const r=engine.start(team.id,'Inspect');await engine.active.get(r.id)?.done;
 assert.deepEqual(received.browserAccess,{mode:'existing',sites:['https://example.com']});assert.deepEqual(engine.get(r.id).team.browserAccess,received.browserAccess);
 engine.setBrowserAccess(team.id,{mode:'isolated',sites:[]});assert.throws(()=>engine.resume(r.id),/permisos cambiaron/);
 }finally{await engine.close();rmSync(dir,{recursive:true,force:true});}
});

test('internal browser enforces allowed origins for open and inspect before reading or navigating',async()=>{
 const b=new VisualBrowser(()=> 'http://127.0.0.1:4318');let touched=false;
 const fake={owner:null,sites:[],refs:new Map(),history:[],page:{url:()=> 'https://not-allowed.example/',goto:()=>{touched=true;},locator:()=>{touched=true;}}};b.internal=async()=>fake;
 const c=new AbortController();const access=b.bind('scope','A',c.signal,{mode:'internal',sites:['https://example.com']});
 try{await assert.rejects(()=>b.call(access.key,'browser_open',{url:'https://example.org'}),/autorizado/);await assert.rejects(()=>b.call(access.key,'browser_inspect',{}),/autorizado/);assert.equal(touched,false);assert.equal(b.state('scope').actionCount,0);assert.match(b.state('scope').history[0].text,/no realizada/);}finally{access.release();b.sessions.clear();await b.closeAll();}
});
test('internal browser disallows manual interaction while an agent owns the page',async()=>{
 const b=new VisualBrowser(()=> 'http://127.0.0.1:4318');b.internal=async()=>({owner:'active-team'});
 try{await assert.rejects(()=>b.manual('type',{text:'never sent'}),/equipo/);assert.equal(b.manualBusy,false);}finally{await b.closeAll();}
});
