# tropa-Aigents

La documentación del estado actual del código para Claude está en [docs/ESTADO-ACTUAL-PARA-CLAUDE.md](docs/ESTADO-ACTUAL-PARA-CLAUDE.md).

Aplicación local, código original Apache-2.0, para equipos de agentes que utilizan los programas oficiales y las cuentas del usuario. No se copió código de OpenBot.

## Ejecutar

Requiere Node.js 24 o superior. No requiere instalar dependencias npm.

```sh
npm start
```

Abrir http://127.0.0.1:4318. Para otro puerto: `PORT=4320 npm start`.

1. En Conexiones se detectan Codex, Claude Code y Kimi Code mediante `--version`. **Instalación no prueba autenticación.**
2. Iniciar sesión en una terminal con el programa oficial: `codex login`, `claude auth login` o `kimi login`.
3. Crear un equipo y elegir proveedor, modelo opcional e instrucciones para cada agente.
4. Asignar un objetivo. El motor ejecuta las etapas en orden, compartiendo resultados y guardándolos en SQLite.
5. En Actividad se pueden ver resultados, cancelar y continuar un trabajo fallido. La etapa pendiente puede consumir cuota nuevamente; las terminadas no se repiten.

La demostración es explícitamente simulada: no conecta con IA ni gasta cuotas. Los adaptadores reales usan las CLI oficiales; se han validado las opciones con las versiones instaladas, pero requieren una prueba real por proveedor antes de declarar compatibilidad de extremo a extremo.

## Alcance real

- Equipos de 1 a 8 agentes; mezcla de proveedores por equipo.
- Un paso por agente; hasta dos equipos ejecutándose a la vez.
- Persistencia local de configuración, resultados y estado; los trabajos inciertos al reiniciar requieren continuación manual.
- Límite de tres minutos por etapa y límites de tamaño de respuestas y contexto.
- Codex: `exec`, configuración de usuario desactivada, modo `read-only` y respuesta final en archivo.
- Claude: `-p`, salida JSON, herramientas desactivadas, MCP externos desactivados y sin persistencia nativa de sesión.
- Kimi: `--prompt`, salida texto, modo planificación. Su configuración nativa sigue aplicándose. **Planificación no es una barrera de seguridad.**
- Las sesiones de chat desktop y las de los programas oficiales pueden ser diferentes. Iniciar sesión en ChatGPT/Claude/Kimi en el navegador no garantiza que la CLI esté autenticada.
- Se eliminan variables comunes de claves API del entorno hijo para priorizar sesiones propias. Esto no certifica el tipo de facturación: las CLI pueden tener otras configuraciones propias. Revisar la cuenta en cada proveedor.
- No se almacenan tokens ni contraseñas de proveedores en esta app. Cada programa conserva sus credenciales.
- No hay login OAuth propio, descarga automática de CLI, MCP, navegador, acciones externas, cron, importación de documentos ni empaquetado desktop todavía.
- No es un equipo con planificación dinámica: es una cadena de agentes autónoma una vez iniciada. El próximo incremento incorpora coordinador, delegación y permisos.
- No soporta todavía modelos locales en la interfaz; el contrato de proveedor permite agregarlos después.

## Datos y límites

`data/state.sqlite` contiene el historial y los equipos. `data/runs/` contiene carpetas de trabajo por etapa. La carpeta está excluida de Git. Hacer backups con la app detenida, incluyendo toda la carpeta `data/`.

Uso personal local, una instancia por carpeta de datos. No exponer el puerto a Internet. El servidor escucha exclusivamente en 127.0.0.1, valida Host y Origin, usa cookie HttpOnly SameSite y no activa CORS. No es una plataforma multiusuario ni un aislamiento entre empresas. Los proveedores locales se ejecutan con tu usuario y pueden tener capacidades propias: para clientes sensibles usar máquinas o usuarios aislados.

Cancelar detiene el proceso local; no garantiza revertir una petición ya aceptada por el proveedor ni su consumo. No se hacen reintentos automáticos.

## Pruebas

```sh
npm test
```

Las pruebas usan dobles de proveedores; no gastan suscripciones. Cubren el traspaso real de contexto, cancelación, recuperación, continuación sin duplicar etapas guardadas y protección HTTP local.

## Próximos pasos

1. Pruebas de cuentas reales con el usuario y una tarea pequeña por proveedor.
2. Codex App Server y Kimi ACP, con eventos en vivo, sesiones nativas y aprobación de herramientas.
3. Onboarding de cada proveedor usando exclusivamente sus flujos autorizados; evaluar condiciones de distribución de Claude antes de ofrecer un login embebido.
4. Coordinador con tareas estructuradas y cola durable; límites por ejecución y permisos por herramienta.
5. Conectores MCP y modelos locales; luego empaquetado para Linux y otras plataformas.

Ver `docs/openbot-research.md` para investigación y fuentes.

## Rutinas, flujos, tareas y programación

- Rutinas: guardar y editar un objetivo asociado a un equipo; ejecutarlo de nuevo.
- Flujos: editor visual secuencial con inicio manual, objetivo, uno o varios equipos ordenables y salida guardada. Máximo ocho agentes en total. No hay ramificaciones, condiciones, aprobaciones, conectores externos ni arrastre libre todavía.
- Tareas: tablero de ejecuciones en curso, completadas y con problemas; acceso a sus resultados.
- Programación: rutinas de una sola vez o repetidas por intervalo (hora, 24 horas, siete días). Se pueden pausar y reactivar. Requiere el servidor encendido. Las ocurrencias vencidas se condensan en una al volver. No superpone la ejecución anterior de la misma programación. La ocurrencia se registra antes de lanzarse: un cierre justo en ese instante puede omitirla, pero no la repite automáticamente.
- Las rutinas toman la versión guardada actual del equipo al comenzar; cada ejecución conserva una copia de sus agentes y objetivo.
- La conexión móvil queda fuera de esta versión.

Validación: ocho pruebas del motor y API; recorrido visual de creación, guardado y ejecución de flujo en modo demostración. Proveedores reales pendientes de validación con sesión iniciada.

## Verificación con cuentas reales — 7 de noviembre de 2026

Completada una ejecución de tres agentes con las sesiones oficiales existentes: Codex/ChatGPT → Claude Code/claude.ai → Codex/ChatGPT. Se usaron pedidos ficticios; las respuestas fueron generadas por los proveedores reales. Se comprobó que el código creado por el primer agente apareció en las tres entregas y que el coordinador conservó literalmente la recomendación de Claude. Evidencia en `docs/real-team-result.md`. Esto sustituye la limitación anterior de proveedores pendientes de validación para GPT y Claude; Kimi sigue pendiente.

Los indicadores inferiores de la barra lateral consultan `codex login status` y `claude auth status` al abrir la app y entrar en Conexiones. Muestran sesión declarada por la herramienta oficial, no disponibilidad garantizada ni cuota restante. No almacenan tokens, correo ni identificadores de la cuenta. Las cuotas siguen sin integración.

## Herramientas, archivos, avatares y consumo — 7 de noviembre de 2026

En Crear equipo o Nuevo agente se puede activar **Búsqueda web y archivos** para GPT/Codex y Claude. Codex usa búsqueda web live y workspace-write; Claude usa Read/Write/Edit/Glob/Grep/WebSearch/WebFetch con restricted, sin Bash ni MCP adicionales. Los agentes comparten `data/runs/<id>/workspace`. Codex restringe la escritura con su sandbox, pero esto no implica aislamiento completo de lecturas del sistema. La navegación implementada es consulta/búsqueda de páginas; todavía no hay control visual de un navegador ni formularios autenticados.

Al asignar un objetivo se pueden adjuntar hasta cinco TXT/MD/CSV/JSON, con un total máximo de 50 KB. Los archivos y el objetivo se transmiten a los proveedores del equipo. En la conversación, **Ver archivos generados** permite abrir como texto o descargar los entregables (hasta 2 MB por descarga). Los archivos son compartidos y un agente puede actualizar lo escrito por otro; no hay versionado de entregables todavía.

Prueba real de herramientas completada en un espacio técnico separado: GPT consultó python.org/about y escribió fuentes.md; Claude leyó ese archivo, consultó la fuente y escribió revision.md. Diez pruebas automáticas comprueban motor, API, carpeta compartida y rechazo de rutas y enlaces fuera de ella.

Consumo real: `account/rateLimits/read` del app-server oficial Codex y `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` del SDK oficial de Claude, usando sus sesiones locales. Caché de cinco minutos; la interfaz muestra porcentaje usado, disponible y reinicio en Buenos Aires. No se leen tokens ni se intermedian las solicitudes de modelos en un servicio propio. La consulta de Claude es experimental y puede cambiar. Si falla, se muestra uso no disponible. Los indicadores tienen un panel al pasar el cursor o enfocar; también se ve en Conexiones. Esto sustituye la nota previa sobre cuotas sin integración.

Avatares iniciales: robot, cristal, circuito, búho, zorro, pulpo, lupa, brújula y pluma; combinables con colores y formas. La apariencia se guarda en el navegador actual.

## Navegador visual

Crear equipo / Nuevo agente incorpora **Navegador visual** para Codex y Claude. El servidor ejecuta Chrome mediante Playwright en un contexto separado por ejecución, sin importar cookies del navegador personal. Los agentes acceden mediante un servidor MCP local con una autorización temporal limitada a esa ejecución; la misma página continúa entre agentes.

Herramientas: abrir URL, inspeccionar texto y captura, hacer clic, completar campos, seleccionar opciones, pulsar teclas y desplazar. La conversación muestra la última captura y un registro de acciones. Las aperturas y acciones que cambian páginas externas esperan **Autorizar esta acción** o **Rechazar** en la interfaz. Las solicitudes caducan a los cinco minutos y se cancelan cuando termina el agente. Cada agente con navegador tiene un máximo de veinte minutos para su etapa.

Para probar: crear un equipo con navegador habilitado, asignarle trabajo y pulsar **Preparar prueba de formulario local**. Ese formulario no contacta servicios externos y sus acciones no requieren confirmación. El resultado debe mostrar `PRUEBA-OK-2026`. El segundo agente puede revisar la página sin repetir el envío.

Alcance inicial: una página por ejecución, elementos de la página principal; ventanas emergentes se cierran. No hay importación de sesiones, cargas de archivos en formularios ni gestión de contraseñas/CAPTCHA. No se ignoran errores TLS. La navegación usa HTTPS público y se rechazan destinos privados, salvo las dos rutas del formulario local. La comprobación DNS es una defensa de aplicación, no un aislamiento de red a nivel del sistema. No se expone ejecución arbitraria de JavaScript como herramienta del agente. Las capturas y el registro permanecen en memoria; cerrar el navegador o reiniciar el servidor los descarta. Los navegadores inactivos se cierran después de veinte minutos. Los resultados textuales sí se conservan en la base local.

Dependencias: `playwright` y `@modelcontextprotocol/sdk`; Chrome debe estar instalado. No se desactiva su sandbox. Las capturas se entregan al proveedor del agente como parte de su contexto. La interfaz y las aprobaciones siguen siendo locales en 127.0.0.1.

Verificación real desde la interfaz (7 de noviembre de 2026): GPT abrió el formulario local, completó nombre y descripción, seleccionó Soporte y envió; Claude inspeccionó esa misma página y confirmó los valores y `PRUEBA-OK-2026` sin repetir el envío. Otra ejecución de Claude abrió https://example.com después de autorizarlo en la interfaz y describió el contenido observado. Evidencias: `docs/visual-browser-proof.png`, `docs/browser-approval.png` y `docs/public-browser-proof.png`. Las doce pruebas automáticas pasan, incluidas cancelación de aprobaciones y bloqueo de destinos privados. Esta sección sustituye la limitación previa sobre ausencia de navegación visual; formularios autenticados siguen fuera de la prueba.

## Sesiones personales y permisos por equipo

En **Conexiones → Tu navegador y tus sesiones** se descarga la extensión local para Chrome/Edge/Brave (Chromium 120+). Descomprimir e instalar mediante **Extensiones → Modo desarrollador → Cargar descomprimida**. Generar el código temporal en el MVP y pegarlo en la extensión. Desde cada pestaña deseada, pulsar **Compartir esta pestaña HTTPS**. En **Equipos → Sitios permitidos**, elegir **Mis pestañas compartidas** y agregar los sitios exactos. El MVP debe estar en `http://127.0.0.1:4318`.

La extensión controla esas pestañas reales, con sus sesiones ya iniciadas, usando `chrome.debugger`. El permiso de depuración de Chrome es amplio: el límite por pestaña y sitio lo aplica nuestro código, no un permiso de Chrome por dominio. No se copian cookies, contraseñas ni perfiles. La extensión sólo publica al MVP los sitios de pestañas compartidas explícitamente. La vinculación usa un código aleatorio de un solo uso (5 minutos), un token ligado al identificador de extensión y almacenamiento de sesión; reiniciar el servidor o el navegador requiere reconectar. El permiso del equipo no comparte una pestaña por sí solo.

Cada acción personal sigue requiriendo aprobación, salvo inspección y desplazamiento. Se verifica el sitio antes de operar, después de capturar, al redirigir documentos y cuando la persona cambia la pestaña. Los subdominios se autorizan por separado. Un equipo reserva su pestaña mientras está en uso; otro no puede usarla simultáneamente. Dejar de compartir, desconectar la extensión o revocar desde el MVP impide acciones posteriores. Una acción ya enviada al sitio no puede deshacerse mediante revocación. La sesión compartida se libera al cerrar el navegador de la ejecución o tras 20 minutos sin uso; la pestaña personal no se cierra.

Límites: este primer conector no admite Firefox, el navegador integrado de Codex, ventanas emergentes, contraseñas, carga de archivos ni controles dentro de marcos. Los documentos de terceros se bloquean y algunas aplicaciones pueden necesitar permisos adicionales o no ser compatibles. El límite de sitios controla navegación e interacción; no es un cortafuegos para solicitudes de fondo, analítica o servicios usados por una aplicación autorizada. La persona debe evitar interactuar con la pestaña mientras la usa el equipo. Las sesiones personales se usan en objetivos directos del equipo; flujos y programaciones las rechazan por ahora para no mezclar permisos. Cambiar permisos requiere detener ejecuciones activas y no permite reanudar una ejecución con permisos anteriores.

Pruebas de política y enlace local automatizadas. La instalación de la extensión y la primera prueba en una cuenta personal requieren intervención de la persona; no se presentan como ya verificadas. Documentación oficial: https://developer.chrome.com/docs/extensions/reference/api/debugger y https://developer.chrome.com/docs/extensions/reference/api/permissions.

## Avatares aportados

48 opciones en cuatro colecciones: Formas, Trazo lápiz, Garabatos y Personajes (Lupa, Tinta, Datos, Bit, Rumbo, Búho, Zorro, Pulpo, Eco, Rey, Musa y Agenda). Las láminas originales se conservan sin modificar en `public/avatars`; CSS muestra cada dibujo individual. La elección se guarda por agente en la base local y en las copias de ejecución, y aparece en equipos y conversaciones. Las versiones 1x y 2x del set son el mismo catálogo: se usa la de mayor resolución.

## Chromium interno (sin extensión)

Disponible en **Conexiones → Abrir navegador interno**. Usa Chrome instalado, con motor Chromium, un perfil persistente separado en `data/internal-browser-profile` y una vista interactiva por capturas dentro del MVP. No importa sesiones de Firefox ni requiere su extensión. La persona abre una URL, pulsa sobre la captura y puede escribir mediante el control de entrada o enviar Tab/Enter. La vista se actualiza tras cada acción o con Actualizar vista; no es una pestaña nativa embebida ni un vídeo continuo.

Para equipos, seleccionar **Chromium interno** y sitios exactos en Sitios permitidos. Mientras un equipo lo usa, el control manual queda bloqueado; los equipos no pueden leer páginas fuera de su lista. El navegador es único y reserva su página para una ejecución. Las acciones de agentes siguen requiriendo autorización, excepto inspección y desplazamiento. La sesión se conserva al reiniciar. Los accesos manuales no se agregan a las conversaciones ni se envían a proveedores de IA. Las capturas de equipos autorizados sí se envían.

No hay importación de cookies, evasión de alertas TLS, ventanas emergentes ni garantía de compatibilidad de inicio de sesión: algunos sitios bloquean navegadores automatizados. No se ha comprobado todavía una sesión privada iniciada por la persona. Los sitios permitidos limitan navegación y herramientas, no solicitudes de fondo de las aplicaciones. Firefox no puede usar la extensión Chromium suministrada.

Verificación del navegador interno: ejecución real de dos agentes Claude desde la interfaz. Lupa abrió example.com, intentó una vez example.org y recibió «Este sitio no está autorizado para el equipo»; la URL permaneció en example.com. Datos inspeccionó la misma página. Evidencia: `docs/internal-sites-proof.png`. Las 19 pruebas automatizadas pasan, incluidas lectura/navegación fuera de lista y exclusión del control manual durante trabajo de agentes. Esto verifica páginas públicas y traspaso de sesión del navegador, no aún una cuenta privada.
