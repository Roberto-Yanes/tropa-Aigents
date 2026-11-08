export function siteOrigin(value) {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname.includes('*')||u.hostname.endsWith('.')||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':'))throw Error('Usá sitios HTTPS públicos, sin comodines ni puertos.');
 return u.origin;
}
export function browserPolicy(value) {
 if(value===undefined)return {mode:'isolated',sites:[]};
 if(!value||!['isolated','existing','internal'].includes(value.mode)||!Array.isArray(value.sites)||value.sites.length>20)throw Error('Permisos de navegador inválidos.');
 const sites=[...new Set(value.sites.map(siteOrigin))];
 if(value.mode!=='isolated'&&!sites.length)throw Error('Elegí al menos un sitio para usar tus sesiones.');
 return {mode:value.mode,sites};
}
export function assertSite(url,sites){if(!sites.includes(siteOrigin(url)))throw Error('Este sitio no está autorizado para el equipo.');}
