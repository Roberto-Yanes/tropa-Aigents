# Flujos de trabajo (mini n8n)

Estado al 8 de noviembre de 2026. Un flujo es una lista ordenada de pasos tipados que se ejecuta en una sola corrida (`run`) con `source.mode = 'flow'`.

## Tipos de paso

| Tipo | Qué hace | Campos guardados |
| --- | --- | --- |
| `agent` | Un agente hace la tarea del paso y devuelve texto libre. | `teamId`, `index`, `instruction`, `input` (`all` · `last` · `none`) |
| `team` | El agente `index` coordina y puede consultar a su equipo (mismo bucle que el chat directo, `Engine.collaborate`). | `teamId`, `index`, `instruction`, `input` |
| `condition` | Sigue, termina o salta a un paso posterior. Modos: `contains`, `not_contains` (sobre el resultado anterior) o `agent` (un agente responde `{"cumple":bool,"motivo":""}`). | `mode`, `value`, `onFalse` (`stop` · `goto`), `target`, y `teamId`/`index` si es `agent` |
| `approval` | Pone la corrida en `waiting` hasta `POST /api/runs/:id/approve` o `/reject`. | `message` |

Límites: 1 a 20 pasos y al menos uno de tipo `agent` o `team`. Los saltos solo van hacia adelante, así que no hay bucles.

## Reglas que importan

- **Permisos por paso.** Cada paso usa el `teamId` y el `browserAccess` reales de su equipo, así que Google y el navegador funcionan dentro de los flujos. `compileFlow` (en `flows.mjs`) hace una copia de los equipos al iniciar la corrida. Si después cambian los permisos de navegador personal, el paso falla con un mensaje claro.
- **Reanudar.** `resume()` sigue desde `source.cursor`. Un paso de equipo retoma su propia pila (`node.stack`). Puede repetir efectos externos del paso pendiente, igual que el resto del motor.
- **`waiting` no es `interrupted`.** Una pausa sobrevive al reinicio. `resume()` no la destraba: solo `approve` / `reject`.
- **Flujos viejos.** Los guardados como `teamIds` se muestran y ejecutan como un paso `agent` por cada agente, con el comportamiento de antes (`legacyNodes`). Al guardarlos desde el editor se convierten a `nodes`.
- **Rutinas.** Ahora se ejecutan como el equipo real (`team.id` del equipo), así que conservan sus permisos.
- **Programación.** Acepta `targetKind` (`routines` · `workflows`) y `targetId`; `routineId` sigue funcionando. Si el motor está ocupado, la programación se pospone en lugar de desactivarse. Si la corrida anterior espera aprobación, no se lanza otra.
- **Operaciones nuevas.** `POST /api/{routines|workflows|schedules}/:id/delete` y `/duplicate` (duplicar solo para rutinas y flujos). No se puede borrar algo que tiene programaciones.
- **Navegador.** Si una corrida cambia de modo de navegador entre pasos, se cierra la sesión anterior antes de abrir la nueva. El Chromium interno se libera cuando la corrida termina o queda en espera.

## Pruebas

`test/flows.test.mjs` cubre pasos de agente y de equipo, condiciones (texto y agente, terminar y saltar), aprobación con reinicio, reanudación, flujos viejos, duplicar, borrar, programar flujos, motor ocupado, permisos de rutinas, validaciones y cambio de modo de navegador.

## Pendiente

- Lanzar flujos desde WhatsApp y aprobar pasos `approval` desde WhatsApp.
- Pasos en paralelo y disparadores externos (correo nuevo, webhook).
- Prueba manual con proveedores reales (Codex, Claude) y navegador.
