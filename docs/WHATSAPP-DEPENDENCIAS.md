# Dependencias del canal WhatsApp

Revisión del lockfile el 8 de noviembre de 2026. El canal no oficial aún necesita pruebas reales y revisión antes de distribuir instaladores.

- `baileys@7.0.0-rc14` declara MIT y es una versión candidata, no una versión estable.
- `libsignal@6.0.0` es una dependencia directa obligatoria de Baileys y declara GPL-3.0. La compatibilidad y las obligaciones de distribución del conjunto con el código Apache-2.0 requieren revisión antes de publicar binarios.
- `whatsapp-rust-bridge@0.5.4` declara MIT y utiliza WebAssembly; debe comprobarse en cada plataforma empaquetada.
- `qrcode@1.5.4` y `pino@9.14.0` se fijaron como dependencias directas. Consultar sus licencias y las de sus transitivas en `package-lock.json` y en los archivos de cada paquete antes de distribuir.
- El lockfile contiene dependencias opcionales de `sharp` y `@img/sharp-libvips` con licencias LGPL-3.0-or-later y combinaciones de licencias. También contiene dependencias de Claude con licencias propias. No asumir que el proyecto completo se distribuye únicamente bajo MIT o Apache-2.0.
- No se encontraron dependencias resueltas desde URLs Git en el lockfile revisado. Eso no garantiza que instalaciones futuras o distintas plataformas no agreguen requisitos.

La prueba de importación `import('baileys')` pasó en el entorno Linux de desarrollo. Eso no equivale a probar conexión con WhatsApp, distribución de licencias ni instalación en Linux, Windows o macOS.
