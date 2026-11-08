# Conectores Tropa: estado y diseño

**Estado actual:** Gmail y Google Calendar tienen un primer conector OAuth de solo lectura, con acceso de agentes por MCP local y permisos por equipo y cuenta. La sesión y los tokens permanecen en memoria y se pierden al reiniciar; reconectar es necesario. Su puesta en marcha y prueba con una cuenta real requieren terminar la configuración y autorización OAuth. Los demás conectores del catálogo siguen sin implementar. La conexión visual de navegador existente es un mecanismo distinto y no sustituye una API ni un conector de cuenta. Nunca representar el catálogo como cuentas conectadas.

## Objetivo

Conectar cuentas de Google (Gmail, Calendar y Drive), Microsoft (Outlook, Calendar y OneDrive mediante Graph) y, en etapas posteriores, Slack, Notion y GitHub. La arquitectura debe admitir API y servidores MCP revisados; el marketplace queda para otra fase. No ejecutar comandos MCP arbitrarios introducidos por un proveedor, una web o un mensaje. La app Codex y sus conectores no se transfieren a Tropa.

## Diseño de implementación

1. Registro local de conectores con identificador estable, versión, capacidades y proveedor. Implementaciones empaquetadas o verificadas; no ejecutar código de un catálogo remoto sin diseño, validación y decisión de instalación. Mostrar cuentas, scopes reales y salud, separando instalado, autorizado, expirado y revocado.
2. OAuth desktop con navegador del sistema, autorización de código con PKCE, estado aleatorio, redirección loopback efímera y validación estricta; el escritorio es cliente público. Google y Microsoft exigen registros de aplicación/client IDs y consentimientos propios. No recopilar contraseñas ni copiar sesiones de otros programas. Identidad de aplicación verificable y revisión de scopes sensibles/restringidos para distribución.
3. Tokens únicamente en almacén seguro del sistema, nunca en SQLite en texto plano, variables entregadas a los modelos, prompts, chat, extensiones, ni logs. Investigar e integrar mecanismos compatibles de Linux Secret Service, macOS Keychain y Windows Credential Manager. Rotación, revocación y errores de refresco.
4. Política explícita por equipo y conector: cuenta, capacidades y scopes mínimos. Atlas acceso transversal solo a lo que la persona le autorice; integrantes solo su equipo. Vincular permisos al inicio y comprobar de nuevo en cada herramienta, incluido acceso a adjuntos, reanudación y cambios durante ejecución.
5. Broker MCP local por ejecución, con credenciales efímeras y herramientas filtradas por política; los proveedores nunca reciben tokens de proveedor. Validar argumentos, propiedad de recursos, límites, paginación, timeouts y cancelar tareas. Separar leer, preparar borradores y mutar/enviar. Acciones externas requieren aprobación específica, mostrando destinatario, contenido y cuenta; autorización de un mensaje no habilita todos.
6. Correo y contenido externo: datos no confiables, no instrucciones. No convertir automáticamente correo en tareas ni permitir que cambie permisos, solicite secretos o dispare escrituras. Si se incorporan disparadores de correo, autenticar notificaciones, aplicar listas de remitentes elegidas por usuario y límites; registrar sin volcar contenido privado.
7. Pruebas: OAuth PKCE, expiración y revocación; cambio de cuenta en vuelo; dos equipos con permisos distintos; prompt injection; denegación y repetición de aprobaciones; errores de red, paginación, reintentos idempotentes y ejecución real autorizada por el usuario. Las simulaciones no bastan como demostración de una conexión real.

## Fuentes oficiales

- Google OAuth para aplicaciones instaladas: https://developers.google.com/identity/protocols/oauth2/native-app
- Microsoft Graph y registro de aplicación: https://learn.microsoft.com/en-us/graph/auth-register-app-v2
- Microsoft identidad y PKCE: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Model Context Protocol: https://modelcontextprotocol.io/

La selección exacta de scopes, proveedores MCP, verificación OAuth y credenciales registradas se resuelve por integración; no se han obtenido ni solicitado credenciales aquí.

## Google: primera versión

Se solicitan únicamente `gmail.readonly`, `calendar.events.readonly`, `openid` y `email`, según los servicios elegidos. El usuario debe configurar un cliente OAuth de escritorio en Google Cloud y habilitar Gmail API y Calendar API. El conector solicita el ID y el secreto del cliente en la interfaz, en memoria, y abre la autorización de Google usando PKCE y una devolución local efímera. Una cuenta por proceso. Gmail permite buscar y leer texto plano sin adjuntos; Calendar consulta eventos del calendario principal. No permite enviar correos, crear borradores ni modificar eventos. No guarda tokens entre reinicios. La cuenta puede desconectarse desde la interfaz; esto borra la sesión local, no revoca automáticamente el consentimiento en Google.

Autorizar cada servicio en Google y asignarlo por separado a cada equipo. Los permisos se asocian al correo verificado de la cuenta y se verifican en cada llamada; cambiar de cuenta no reutiliza permisos. Los resultados se envían al proveedor de IA que use el agente, y correo/eventos son datos externos no confiables. La conexión se limita actualmente a Codex y Claude.

Antes de distribuir ampliamente se necesita una revisión de seguridad, integración con almacenes seguros del sistema, un cliente OAuth propio adecuado para la comunidad y completar la verificación de Google que corresponda a los scopes restringidos. Las pruebas con datos falsos no equivalen a una prueba real de correo.
