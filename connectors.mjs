// Catalog entries describe planned integrations, not authenticated connections.
export const connectorCatalog = Object.freeze([
 {id:'gmail',name:'Gmail',category:'Correo',provider:'Google',transport:'api',description:'Lectura, búsqueda y borradores de correo.',status:'not_implemented'},
 {id:'google-calendar',name:'Google Calendar',category:'Calendario',provider:'Google',transport:'api',description:'Consulta y gestión de eventos.',status:'not_implemented'},
 {id:'google-drive',name:'Google Drive',category:'Archivos',provider:'Google',transport:'api',description:'Búsqueda y acceso a archivos autorizados.',status:'not_implemented'},
 {id:'outlook-mail',name:'Outlook Mail',category:'Correo',provider:'Microsoft',transport:'api',description:'Correo mediante Microsoft Graph.',status:'not_implemented'},
 {id:'outlook-calendar',name:'Outlook Calendar',category:'Calendario',provider:'Microsoft',transport:'api',description:'Calendarios mediante Microsoft Graph.',status:'not_implemented'},
 {id:'onedrive',name:'OneDrive',category:'Archivos',provider:'Microsoft',transport:'api',description:'Archivos mediante Microsoft Graph.',status:'not_implemented'},
 {id:'mcp',name:'Servidor MCP',category:'Integraciones',provider:'Personalizado',transport:'mcp',description:'Herramientas externas mediante MCP.',status:'not_implemented'},
 {id:'slack',name:'Slack',category:'Mensajería',provider:'Slack',transport:'api',description:'Mensajes y canales autorizados.',status:'not_implemented'},
 {id:'notion',name:'Notion',category:'Documentos',provider:'Notion',transport:'api',description:'Páginas y bases autorizadas.',status:'not_implemented'},
 {id:'github',name:'GitHub',category:'Desarrollo',provider:'GitHub',transport:'api',description:'Repositorios y tareas autorizadas.',status:'not_implemented'}
]);
