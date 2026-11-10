# Tropa AI móvil: estado y separación del repositorio

**Actualización 9 de noviembre:** el cliente se separó en
[`Roberto-Yanes/tropa-mobile`](https://github.com/Roberto-Yanes/tropa-mobile),
repositorio privado con fuentes compartidas versionadas en `vendor/desktop/`.
El resto de este documento conserva la descripción y el plan anteriores a la
separación. Consultar el README del repositorio móvil para el procedimiento vigente.

Revisión del 9 de noviembre de 2026. Este documento describe el código presente en el espacio de trabajo, no implica que esté publicado ni probado en teléfonos reales. El dossier `docs/mobile/README.md` contiene una propuesta anterior y no debe confundirse con el estado actual.

## Componentes

- `mobile-app/`: aplicación Expo/React Native para Android e iOS. Está dentro del repositorio de Tropa Desktop y actualmente figura como directorio sin seguimiento en Git.
- `mobile/`: gateway y API para conectar el teléfono al motor de Desktop. Permanecen en el repositorio de Desktop.
- `protocol/`: cifrado y protocolo de comunicación; la app contiene una copia generada en `mobile-app/src/protocol/`.
- `relay/`: servicio intermedio WebSocket y envío de notificaciones Expo. Es un componente de servidor, no parte del ejecutable móvil.
- `public/app.js` y asociados: pantalla de teléfonos y vinculación en Desktop.

El teléfono es un cliente remoto: el motor, los archivos y las cuentas de IA se ejecutan en la computadora. Una computadora apagada no ejecuta tareas. Las comunicaciones entre cliente y Desktop se empaquetan cifradas; el relay también maneja datos operativos como identidad de conexión, presencia y token push.

## Funciones implementadas en código

Vinculación con QR o enlace y confirmación por código de seis dígitos; chat con agentes y equipos; consulta de tareas y flujos; inicio, cancelación y reanudación de tareas o flujos disponibles; aprobaciones; descarga de resultados; ajustes, desvinculación y modo de demostración. El cliente guarda la identidad en SecureStore. Su implementación principal está en `mobile-app/src/lib/tropa.tsx`, `storage.ts` y `src/app/`. El modo demo usa datos simulados y no demuestra la ejecución real.

`mobile/gateway.mjs` media el acceso al motor, guarda eventos para recuperación e incluye el origen móvil; `mobile/api.mjs` define las operaciones permitidas. `mobile/store.mjs` mantiene el estado del gateway. `relay/server.mjs` reenvía mensajes y llama al servicio de push de Expo con notificaciones genéricas. El relay no es un reemplazo del motor de escritorio.

## Trabajo de revisión y configuración

La implementación inicial existente de Claude se revisó y se corrigieron aspectos de empaquetado Desktop, reconexión, recuperación de eventos, selección de agentes y registro de push. La atribución detallada por archivo no puede establecerse con certeza solo a partir del árbol actual, que contiene cambios sin registrar.

Se creó el proyecto Expo `@ryanes/tropa`, se configuró el identificador `ar.com.galateasoftware.tropa` y se vinculó Firebase al proyecto Google Cloud existente `tropa-ai-514109`. `mobile-app/google-services.json` configura el cliente Android; no es la clave privada de la cuenta de servicio. Se creó una cuenta de servicio específica con rol de Firebase Cloud Messaging y se asignó su clave FCM v1 a Expo. Expo generó una credencial de firma Android para la configuración de prueba. La clave privada descargada debe mantenerse fuera de Git y de los archivos de la app.

## Verificaciones y pendientes

Se ejecutaron las pruebas de integración móvil locales (14 pruebas), TypeScript y exportación Expo para Android, iOS y web durante la revisión. La versión web se probó contra Desktop y relay locales. Estos resultados no equivalen a una prueba completa en Android o iOS físicos. La compilación Android de prueba se inició en Expo el 9 de noviembre; consultar su estado en Expo antes de afirmar que existe un APK instalable. La entrega real de push, el emparejamiento y las tareas desde un teléfono físico todavía deben verificarse.

Para iOS falta configurar firma y APNs con una cuenta de Apple Developer y verificar una compilación en un dispositivo compatible. La configuración actual indica `ios.supportsTablet: false`; no se debe presentar como compatibilidad verificada con iPad. Ninguna de estas verificaciones demuestra por sí misma que el relay público desplegado corresponda a esta revisión del código: verificar su versión por separado.

## Separación recomendada

Crear un repositorio independiente para el contenido de `mobile-app/`, conservando el mismo proyecto Expo y los identificadores Android/iOS. Mantener `mobile/` en Desktop y el relay en su repositorio o directorio de servidor hasta decidir su propio ciclo de publicación.

Antes de retirar la carpeta original:

1. Preservar todos los cambios actuales sin seguimiento y verificar la configuración de Expo, firma y Firebase; nunca añadir la clave privada FCM al repositorio.
2. Resolver las dependencias de directorios vecinos: `scripts/sync-protocol.mjs` lee `../protocol` y `scripts/sync-avatars.mjs` lee `../public`; `scripts/crop-avatars.py` también depende de recursos Desktop. Tras separar, estos comandos no funcionarán sin una fuente compartida versionada, una copia controlada o un mecanismo de sincronización explícito.
3. Versionar el contrato entre Desktop, móvil y relay y agregar pruebas de compatibilidad. Evitar actualizaciones independientes que cambien el cifrado o el formato sin coordinación.
4. Configurar los secretos y archivos requeridos por EAS para el repositorio nuevo, comprobar que no se suban claves privadas y ejecutar typecheck, pruebas, compilación Android e integración con Desktop.
5. Documentar la ubicación definitiva y solo entonces retirar la copia anterior, actualizar rutas, scripts y pruebas del repositorio Desktop y verificar que no se pierda trabajo sin registrar.

No se creó ni publicó un repositorio remoto móvil durante esta revisión. Los datos de Expo y Firebase se mantienen independientes de la ubicación del código, siempre que se conserven sus identificadores y acceso a las credenciales correspondientes.
