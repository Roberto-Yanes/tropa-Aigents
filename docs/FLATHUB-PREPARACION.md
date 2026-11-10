# Tropa AI: preparación para Flathub

Revisión del 9 de noviembre de 2026 sobre el checkout Desktop en
`/media/ryanes/Proyectos/Rober/tropa-desktop`, commit base `f25e278` y
cambios locales de la versión 0.2.4. Este documento es una auditoría y una
guía de trabajo, no un manifiesto Flatpak ni una presentación a Flathub.

## Política de IA: tarea humana obligatoria

La política de Flathub consultada indica que los manifiestos de Flathub no
pueden contener material generado o asistido por IA y que los agentes no
pueden abrir ni automatizar la presentación, generar sus mensajes de commit,
descripciones ni respuestas de revisión. La persona que publique debe preparar
ese material y efectuar el envío. También debe declarar el código,
documentación, empaquetado u otro material generado con IA que conozca o tenga
motivos razonables para considerar incluido, con partes y alcance aproximado.
La declaración no garantiza la aceptación.

Fuente: https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy
Esta auditoría y el código escrito por asistentes en Tropa son material
asistido por IA; no se ha determinado aún su alcance completo. La declaración
final debe basarse en una revisión humana del historial y del proyecto; no
inventar porcentajes ni presentar como humano material generado.

## Estado verificado

| Componente | Evidencia y estado |
| --- | --- |
| Fuentes Desktop | Repo `Roberto-Yanes/tropa-Aigents`; el checkout tiene cambios locales 0.2.4 sin commit. El APK móvil está en repo separado. |
| Motor | Electron arranca un Node incluido, que ejecuta el servidor local. `engine.mjs` usa `node:sqlite` y requiere una versión Node compatible. |
| Ejecutables del usuario | `native-command.mjs` busca Codex, Claude, Kimi y Gemini en PATH, `~/.local/bin`, `~/.kimi-code/bin` y NVM; `providers.mjs` los ejecuta como procesos. Su acceso desde Flatpak no está implementado ni probado. |
| Sesiones existentes | Las herramientas oficiales conservan sus credenciales. No se ha demostrado que sean accesibles de forma segura desde el entorno aislado. |
| Navegador | `desktop/main.cjs` intenta detectar Chrome y, si no existe, ejecutar `playwright install chromium` al iniciar. Hay que definir una distribución y actualización compatibles con las reglas de Flathub y probarla en el aislamiento; no asumir que el Chrome del host será visible. |
| Datos | Desktop usa la ruta histórica `~/.config/Agentes Comunidad` mediante `app.setPath('userData', ...)`. En un Flatpak el entorno y almacenamiento cambian: hace falta un plan explícito de migración, con copia y sin sobreescribir datos. |
| Metadatos Debian | `desktop/org.comunidad.agentes.metainfo.xml` pasa `appstreamcli validate --no-net` y existe un PNG de 512×512. Eso no demuestra que cumpla los requisitos completos de Flathub. |
| Entorno local | Flatpak 1.18.1 y fuente Flathub presentes; `flatpak-builder` no está instalado. No se ha compilado ni probado un Flatpak de Tropa. |
| Idioma | La interfaz actual es mayormente española. Flathub exige localización completa en inglés con calidad adecuada, sujeta a las excepciones que documenta; no hay traducción humana verificada. |
| Licencias | Existe `docs/LICENCIAS-DEPENDENCIAS.md`, que señala `libsignal` GPL-3.0 y paquetes Anthropic con condiciones particulares. Revisar archivos de licencia, redistribución y compatibilidad de la distribución completa antes de publicarla; ese inventario no es una aprobación legal. |

## Bloqueos y decisiones técnicas

1. **Integraciones con aplicaciones del host.** Validar una arquitectura para
   detectar y usar las cuentas de los proveedores sin leer credenciales de
   manera indiscriminada. Evaluar portales y, solo cuando resulte aplicable,
   mecanismos de acceso al host sujetos a revisión de Flathub. No conceder
   acceso global al host o al home como solución predeterminada. Las acciones
   del agente deben seguir respetando las autorizaciones actuales.
2. **Navegador y archivos.** Probar una distribución mantenible de Chromium,
   sandbox anidado, permisos para sesiones de usuario, aperturas de enlaces,
   descargas y acceso a carpetas usando portales donde correspondan. Aclarar
   qué funciones dependen de apps externas y qué funciona sin ellas.
3. **Compilación reproducible.** `desktop/prepare.py` ejecuta `npm ci` y
   descarga un archivo Node cuando no está en caché. La construcción actual de
   Electron usa binarios y herramientas externas. Flathub no permite red
   durante la construcción y exige fuentes declaradas; su política exige
   compilar desde código fuente con las excepciones aplicables a criterio de
   sus revisores. Investigar dependencias de Electron, Node y npm y alternativas
   compatibles antes de elegir el empaquetado.
4. **Identidad y permisos.** Elegir un ID de aplicación bajo un dominio que
   controle el propietario de Tropa y verificarlo con los requisitos vigentes.
   El ID Debian `org.comunidad.agentes` y su archivo desktop son históricos;
   pasar la validación genérica no demuestra control del dominio ni adecuación
   a Flathub. Listar justificaciones por permiso y usar el menor alcance viable.
5. **Datos y actualización.** Diseñar migración de SQLite, ajustes y vínculos
   sin filtrar secretos ni cambiar archivos activos; probar rollback y
   convivencia entre Debian y Flatpak. Decidir cómo se mostrarán las
   actualizaciones de la tienda sin duplicar el flujo de instaladores.
6. **Ficha pública.** Revisar nombre, marca y titularidad del ícono; preparar
   capturas reales sin datos personales, descripción precisa, versión estable,
   licencias y documentación. Añadir localización inglesa revisada por una
   persona o consultar una excepción aplicable.

## Pruebas necesarias antes de declarar disponibilidad

- Construcción local reproducible y validación de dependencias para las
  arquitecturas elegidas; comprobar licencias y ejecutables incluidos.
- Arranque, cierre, actualización y migración de datos en una instalación
  limpia y en una máquina con Tropa Debian existente.
- Detección real y sesión de Codex, Claude y Kimi; Ollama/LM Studio; abrir
  páginas y formularios; selección de archivos; rechazo de sitios no
  autorizados; acciones sujetas a aprobación.
- Emparejamiento Android y ejecución con Desktop real; verificar también
  desconexión, revocación y notificaciones. iOS y sus credenciales no quedan
  validados por una publicación de Linux.
- Revisar permisos y logs, ausencia de credenciales en el paquete y material
  de soporte, accesibilidad e instalación mediante COSMIC Store.

Ninguna de estas pruebas se ha marcado como aprobada para Flatpak. La
validación del Debian 0.2.4 y la prueba de teléfono previa son evidencias
separadas, no sustituyen la prueba de una instalación Flatpak.

## Referencias oficiales

- Requisitos y política de IA: https://docs.flathub.org/docs/for-app-authors/requirements
- Presentación y revisión: https://docs.flathub.org/docs/for-app-authors/submission
- Ficha AppStream: https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines
- Permisos y validación: https://docs.flathub.org/docs/for-app-authors/linter
- Tienda y fuentes de Pop!_OS: https://support.system76.com/support/managing-apps
