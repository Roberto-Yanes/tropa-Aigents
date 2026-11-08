import {mkdir,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';

// The transport is started only after the user explicitly links the account.
// Only text and media can be orders or deserve a reply; reactions, edits and protocol traffic are ignored.
export function messageKind(content={},text){
 if(typeof text==='string')return 'text';
 if(content.reactionMessage)return 'reaction';
 if(content.protocolMessage||content.senderKeyDistributionMessage&&Object.keys(content).length===1||content.editedMessage||content.pollUpdateMessage||content.keepInChatMessage)return 'protocol';
 if(['imageMessage','videoMessage','audioMessage','documentMessage','documentWithCaptionMessage','stickerMessage','locationMessage','contactMessage'].some(k=>content[k]))return 'media';
 return Object.keys(content).length?'other':'protocol';
}
export class BaileysTransport {
 constructor({load=()=>import('baileys'),loadLogger=()=>import('pino')}={}){this.load=load;this.loadLogger=loadLogger;this.socket=null;this.stopped=true;this.retry=0;this.timer=null;this.jid=null;this.generation=0;}
 async start({authDir,onQr=()=>{},onPairingCode=()=>{},onStatus=()=>{},onMessage=()=>{},method='qr',phone}={}){
  if(!authDir)throw Error('Falta el directorio de sesión.');
  this.stopped=false;this.authDir=authDir;this.handlers={onQr,onPairingCode,onStatus,onMessage,method,phone};const generation=++this.generation;
  await mkdir(authDir,{recursive:true,mode:0o700});await chmod(authDir,0o700);
  // The session folder is 0700, so files Baileys creates inside stay private without changing the umask of the whole app.
  let lib,logger;try{lib=await this.load();logger=(await this.loadLogger()).default({level:'silent'});}catch{this.stopped=true;onStatus('unavailable');throw Error('WhatsApp no está disponible en este sistema.');}
  if(this.stopped||generation!==this.generation)return;
  this.lib=lib;const {state,saveCreds}=await lib.useMultiFileAuthState(authDir);if(this.stopped||generation!==this.generation)return;
  const socket=lib.default({auth:state,logger,printQRInTerminal:false,syncFullHistory:false});this.socket=socket;let pairingRequested=false;
  socket.ev.on('creds.update',()=>{saveCreds().then(()=>chmod(join(authDir,'creds.json'),0o600)).catch(()=>onStatus('credentials_error'));});
  socket.ev.on('connection.update',update=>{
   if(this.stopped||generation!==this.generation)return;
   if(update.qr){onQr(update.qr);if(method==='code'&&!state.creds.registered&&!pairingRequested&&/^\d{8,15}$/.test(phone||'')){pairingRequested=true;socket.requestPairingCode(phone).then(onPairingCode).catch(()=>onStatus('pairing_error'));}}
   if(update.connection==='open'){this.retry=0;this.jid=lib.jidNormalizedUser(socket.user?.id||'');this.lid=socket.user?.lid?lib.jidNormalizedUser(socket.user.lid):null;onStatus('connected');}
   if(update.connection==='close'){this.socket=null;this.jid=null;this.lid=null;const code=update.lastDisconnect?.error?.output?.statusCode;if(code===lib.DisconnectReason.loggedOut||code===lib.DisconnectReason.forbidden){this.stopped=true;onStatus(code===lib.DisconnectReason.loggedOut?'logged_out':'forbidden');return;}onStatus('disconnected');const delay=Math.min(60000,1000*2**Math.min(this.retry++,6));this.timer=setTimeout(()=>this.start({authDir,...this.handlers}).catch(()=>{}),delay);this.timer.unref?.();}
  });
  socket.ev.on('messages.upsert',event=>{if(this.stopped||generation!==this.generation)return;for(const item of event.messages||[]){const key=item.key||{},jid=lib.jidNormalizedUser(key.remoteJid||'');const alt=key.remoteJidAlt?lib.jidNormalizedUser(key.remoteJidAlt):null;const content=item.message||{};const text=content.conversation??content.extendedTextMessage?.text;const timestamp=Number(item.messageTimestamp||0);onMessage({id:key.id,jid,alt,fromMe:!!key.fromMe,timestamp,text,kind:messageKind(content,text),isGroup:jid.endsWith('@g.us')});}});
  onStatus('connecting');
 }
 ownJid(){return this.jid;}
 ownJids(){return [this.jid,this.lid].filter(Boolean);}
 async send(jid,payload){if(!this.socket)throw Error('WhatsApp está desconectado.');const result=await this.socket.sendMessage(jid,payload);return result?.key?.id;}
 async react(jid,key,emoji){if(!this.socket)throw Error('WhatsApp está desconectado.');return this.socket.sendMessage(jid,{react:{text:emoji,key:{...key,remoteJid:jid}}});}
 async stop(){this.stopped=true;this.generation++;clearTimeout(this.timer);const s=this.socket;this.socket=null;this.jid=null;s?.end?.(undefined);}
 async logout(){const s=this.socket;this.stopped=true;this.generation++;clearTimeout(this.timer);this.socket=null;this.jid=null;if(s)await s.logout();if(this.authDir)await rm(this.authDir,{recursive:true,force:true});}
}
