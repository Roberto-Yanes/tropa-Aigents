# Aplicación e instaladores nativos

Electron contiene la interfaz y arranca un proceso Node 24.22.1 incluido para el motor. Las credenciales permanecen en los programas oficiales instalados por la persona. Los recursos de la aplicación son de sólo lectura; bases de datos y perfiles están en la carpeta userData del usuario, fuera del paquete. Ningún instalador incluye data/, sesiones de navegador, conversaciones ni claves del desarrollador.

Linux: .deb y AppImage x64. Windows: NSIS .exe x64. macOS: .pkg experimental por arquitectura construido desde Linux; .dmg reproducible desde macOS usando electron-builder. No hay firma de desarrollador ni notarización en esta entrega. No se cambian protecciones de seguridad del sistema.

Al abrir, muestra una ventana propia (sin consola ni navegador externo). Si no hay Google Chrome instalado, descarga Chromium para el navegador de agentes. Los programas oficiales de IA y su inicio de sesión siguen siendo requisitos separados. La app escucha sólo en 127.0.0.1:4318; cerrar el MVP de desarrollo antes de abrir la aplicación instalada. Cerrar la ventana detiene el motor y cancela trabajos activos.

Compilación:

1. `npm ci --prefix desktop`
2. `python3 desktop/prepare.py linux x64` (o win32 x64 / darwin arm64 / darwin x64)
3. En desktop: `npx --no-install electron-builder --linux deb AppImage --x64 --publish never` (o --win nsis --x64 / --mac dmg --arm64).

Las órdenes son para desarrolladores; el usuario instala los binarios resultantes con doble clic. La carpeta release-native contiene los entregables. El flujo .github/workflows/installers.yml permite construirlos en los tres sistemas; no se ha subido ni ejecutado automáticamente.

El constructor .pkg usa formato XAR, un archivo BOM y un payload CPIO ODC; la comprobación estructural desde Linux no reemplaza probar instalación, Gatekeeper y arranque en macOS. Para distribución pública se debe regenerar y firmar/notarizar en macOS. No afirmar que está validado en Mac o Windows hasta probarlo allí.

Las dependencias del motor se copian explícitamente mediante after-pack.cjs, ya que el filtro de recursos de electron-builder excluye node_modules. La prueba smoke-backend.mjs exige que esas dependencias estén incluidas y debe ejecutarse desde un paquete extraído fuera del árbol de desarrollo.

Para generar el EXE desde Linux sin Wine: preparar win32/x64, ejecutar electron-builder --win --x64 --dir y compilar desktop/installer.nsi con makensis. El instalador gráfico incluye un desinstalador y conserva los datos de usuario.
