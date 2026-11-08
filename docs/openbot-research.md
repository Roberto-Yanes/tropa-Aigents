# Cuentas y coordinación en OpenBot

Investigación: 7 de noviembre de 2026. Estas notas describen documentación upstream consultada; no certifican funcionamiento ni autorización de cada integración. El MVP es implementación original, sin reutilizar código actual de OpenBot.

## Hallazgo principal

El camino basado en suscripciones utiliza los runtimes oficiales de agentes, no automatiza las ventanas de ChatGPT, Claude Desktop o Kimi Desktop ni convierte sesiones de navegador en API keys. OpenBot también soporta API y modelos locales; esa parte queda fuera de este incremento por preferencia del usuario.

| Proveedor | OpenBot | MVP actual |
|---|---|---|
| ChatGPT / Codex | Proceso Codex App Server y autenticación propia de Codex | CLI oficial `codex exec`, sesión existente |
| Claude | Cliente sobre Claude Agent SDK; login gestionado por sus herramientas | Programa oficial `claude -p`, autenticación nativa; sin login propio |
| Kimi | `kimi acp`; login separado mediante `kimi login` o dispositivo | CLI oficial `kimi --prompt --plan`; ACP pendiente |
| Otros | Adaptadores ACP y proveedores adicionales | Contrato extensible; no implementados aún |

OpenBot separa el estado de la app de las sesiones de cada proveedor. Una interfaz de proveedor unifica eventos y turnos; conserva las diferencias de autenticación y capacidades. Expone herramientas internas para enviar mensajes entre agentes, recordar información y entregar resultados. El programador registra ejecuciones antes de avanzar disparadores para recuperarlas después de reinicios.

## Consecuencias para nuestro producto

- Una cuenta de chat no asegura acceso al runtime de agentes: hay que comprobar producto, plan y login oficial.
- Mostrar “instalado” por separado de “autenticado” y “probado”. El MVP solo detecta instalación.
- No almacenar credenciales de los proveedores en nuestra base ni incrustarlas en prompts.
- Mantener una cuenta por proveedor en este MVP; múltiples identidades aisladas requieren diseño adicional.
- Respetar límites nativos. No rotar cuentas para evadir cuotas y no prometer uso ilimitado.
- Una app comunitaria libre no convierte las suscripciones o binarios de terceros en software libre.
- La autenticación de Claude para productos terceros requiere revisión específica. La documentación permite al usuario autenticarse en el binario sin modificar bajo condiciones, pero restringe ofrecer un login claude.ai propio o intermediar tokens. No damos por aprobado un flujo porque OpenBot lo implemente.

## Fuentes primarias

- https://raw.githubusercontent.com/nightly-labs/openbot/main/docs/architecture/providers.md
- https://raw.githubusercontent.com/nightly-labs/openbot/main/docs/architecture/integrations.md
- https://raw.githubusercontent.com/nightly-labs/openbot/main/docs/architecture/agents.md
- https://learn.chatgpt.com/docs/app-server
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/legal-and-compliance
- https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command
- https://github.com/nightly-labs/openbot/blob/v0.1.11/LICENSE

Opciones de ejecución comprobadas adicionalmente con `codex exec --help`, `claude --help` y `kimi --help` instalados en este equipo. Ninguna llamada a modelos reales fue realizada para esta validación.
