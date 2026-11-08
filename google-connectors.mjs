import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const OAUTH='https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPES={gmail:'https://www.googleapis.com/auth/gmail.readonly',calendar:'https://www.googleapis.com/auth/calendar.events.readonly'};
const b64=()=>randomBytes(32).toString('base64url');
export class GoogleSession {
 constructor({fetchImpl=fetch,vault=null}={}){this.fetch=fetchImpl;this.vault=vault;this.pending=null;this.account=null;this.generation=0;this.lastError='';this.persisted=false;this.ready=this.restore();}
 async restore(){if(!this.vault)return;try{const a=await this.vault.load();if(a&&typeof a.refreshToken==='string'&&typeof a.clientId==='string'&&typeof a.clientSecret==='string'&&typeof a.email==='string'&&Array.isArray(a.services)&&a.services.every(s=>Object.hasOwn(GOOGLE_SCOPES,s))){this.account={...a,accessToken:'',expiresAt:0};this.persisted=true;}}catch{this.lastError='No se pudo acceder al llavero del sistema.';}}
 status(){return {connected:!!this.account,services:this.account?.services||[],email:this.account?.email||'',expiresAt:this.account?.expiresAt||0,pending:!!this.pending,error:this.lastError,persisted:this.persisted};}
 async start({clientId,clientSecret,services}) {
  if(typeof clientId!=='string'||!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))throw Error('Ingresá un ID de cliente OAuth válido.');
  if(typeof clientSecret!=='string'||!clientSecret.trim()||clientSecret.length>512)throw Error('Ingresá el secreto del cliente de escritorio de Google.');
  if(!Array.isArray(services)||!services.length||services.some(x=>!Object.hasOwn(GOOGLE_SCOPES,x)))throw Error('Elegí Gmail o Calendar.');
  this.generation++;this.cancelPending();this.lastError='';const state=b64(),verifier=b64(),challenge=createHash('sha256').update(verifier).digest('base64url'),generation=this.generation;
  const listener=http.createServer(async(req,res)=>{
   const done=(code,text)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});res.end(text);};
   try{
    if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${listener.address().port}`)return done(400,'Solicitud inválida.');
    const url=new URL(req.url,'http://127.0.0.1');if(url.pathname!=='/callback')return done(404,'No encontrado.');
    const supplied=url.searchParams.get('state')||'';if(supplied.length!==state.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(state)))return done(403,'Solicitud inválida.');
    if(!this.pending||this.pending.state!==state)return done(400,'La autorización ya no está activa.');
    this.pending=null;clearTimeout(timer);listener.close();
    if(url.searchParams.has('error')){this.lastError='Google rechazó o canceló la autorización. Revisá los permisos y usuarios de prueba del proyecto.';return done(400,'Google no autorizó la conexión. Podés cerrar esta ventana.');}
    const code=url.searchParams.get('code');if(!code)return done(400,'No se recibió autorización.');
    const token=await this.exchange({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirect,grant_type:'authorization_code',code_verifier:verifier});
    if(generation!==this.generation)return done(400,'La conexión fue cancelada.');
    const granted=(token.scope||'').split(' ');const actual=services.filter(x=>granted.includes(GOOGLE_SCOPES[x]));if(!actual.length)throw Error('Google no concedió los permisos solicitados.');
    const user=await this.fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});if(!user.ok)throw Error('No se pudo verificar la cuenta.');const profile=await user.json();if(typeof profile.email!=='string'||!profile.email||profile.email_verified!==true)throw Error('La cuenta no tiene correo verificado.');
    if(generation!==this.generation)return done(400,'La conexión fue cancelada.');
    this.account={accessToken:token.access_token,refreshToken:token.refresh_token||null,clientId,clientSecret,services:actual,email:typeof profile.email==='string'?profile.email:'',expiresAt:Date.now()+Number(token.expires_in||3600)*1000};this.persisted=false;
    if(this.vault&&this.account.refreshToken){try{const {refreshToken,clientId,clientSecret,services,email}=this.account;await this.vault.save({refreshToken,clientId,clientSecret,services,email});this.persisted=true;}catch{this.lastError='Conexión activa, pero no se pudo guardar en el llavero del sistema.';}}
    else if(this.vault)this.lastError='Google no entregó una autorización renovable; volvé a conectar la cuenta.';
    done(200,'Cuenta conectada. Ya podés cerrar esta ventana y volver a Tropa.');
   }catch{this.lastError='No se pudo completar la conexión con Google. Revisá el cliente OAuth, los permisos y la cuenta de prueba.';done(400,'No se pudo conectar la cuenta. Volvé a intentarlo desde Tropa.');}
  });
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const redirect=`http://127.0.0.1:${listener.address().port}/callback`;const timer=setTimeout(()=>{if(this.pending?.state===state){this.pending=null;this.lastError='La solicitud de autorización venció. Iniciá la conexión nuevamente.';}listener.close();},300000);timer.unref();this.pending={listener,state,timer};
  const params=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:['openid','email',...services.map(s=>GOOGLE_SCOPES[s])].join(' '),state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'});
  return {url:'https://accounts.google.com/o/oauth2/v2/auth?'+params};
 }
 cancelPending(){if(this.pending){clearTimeout(this.pending.timer);this.pending.listener.close();this.pending=null;}}
 async disconnect(){this.generation++;this.cancelPending();this.account=null;this.lastError='';this.persisted=false;if(this.vault)await this.vault.delete();}
 close(){this.generation++;this.cancelPending();this.account=null;}
 async exchange(values){const r=await this.fetch(OAUTH,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Google rechazó la autorización.');const j=await r.json();if(typeof j.access_token!=='string')throw Error('Google no entregó un token de acceso.');return j;}
 async token(service){const a=this.account;if(!a||!a.services.includes(service))throw Error('Cuenta o permiso de Google no disponible.');if(Date.now()+60000<a.expiresAt)return a.accessToken;if(!a.refreshToken)throw Error('La sesión venció. Volvé a conectar Google.');const t=await this.exchange({client_id:a.clientId,client_secret:a.clientSecret,refresh_token:a.refreshToken,grant_type:'refresh_token'});if(this.account!==a)throw Error('La cuenta fue desconectada.');a.accessToken=t.access_token;a.expiresAt=Date.now()+Number(t.expires_in||3600)*1000;return a.accessToken;}
 async call(service,url){const token=await this.token(service);const r=await this.fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Google ${service} no pudo completar la consulta (${r.status}).`);return r.json();}
 async listMail(query='',limit=5){if(typeof query!=='string'||query.length>300||!Number.isInteger(limit)||limit<1||limit>20)throw Error('Consulta inválida.');const q=new URLSearchParams({q:query,maxResults:String(limit)});const list=await this.call('gmail','https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q);return {messages:await Promise.all((list.messages||[]).slice(0,limit).map(async m=>{if(!/^[a-zA-Z0-9_-]{1,128}$/.test(m.id))throw Error('ID de mensaje inválido.');const x=await this.call('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);return {id:x.id,snippet:String(x.snippet||'').slice(0,500),headers:(x.payload?.headers||[]).filter(h=>['from','subject','date'].includes(h.name?.toLowerCase())).map(h=>({name:h.name,value:String(h.value).slice(0,500)}))};}))};}
 async readMail(id){
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('ID de mensaje inválido.');
  const x=await this.call('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
  const collect=(part,depth=0)=>{if(!part||depth>12)return [];const text=part.mimeType==='text/plain'&&typeof part.body?.data==='string'&&!part.filename?Buffer.from(part.body.data,'base64url').toString('utf8').slice(0,16000):'';return [text,...(Array.isArray(part.parts)?part.parts.slice(0,20).flatMap(p=>collect(p,depth+1)):[])].filter(Boolean);};
  return {id:x.id,headers:(x.payload?.headers||[]).filter(h=>['from','subject','date','to'].includes(h.name?.toLowerCase())).map(h=>({name:h.name,value:String(h.value).slice(0,500)})),text:collect(x.payload).join('\n').slice(0,16000),snippet:String(x.snippet||'').slice(0,500)};
 }
 async listEvents(from,to,limit=10){if(!Number.isInteger(limit)||limit<1||limit>30||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>=Date.parse(to))throw Error('Indicá fechas válidas y un máximo entre 1 y 30.');const q=new URLSearchParams({timeMin:new Date(from).toISOString(),timeMax:new Date(to).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:String(limit)});const list=await this.call('calendar','https://www.googleapis.com/calendar/v3/calendars/primary/events?'+q);return {events:(list.items||[]).slice(0,limit).map(e=>({id:e.id,summary:String(e.summary||'').slice(0,500),start:e.start,end:e.end,status:e.status,location:String(e.location||'').slice(0,500)}))};}
}
