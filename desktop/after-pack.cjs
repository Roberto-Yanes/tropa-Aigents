const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  await fs.cp(path.join(__dirname, 'stage', 'backend', 'node_modules'), path.join(resources, 'backend', 'node_modules'), {recursive: true});
  if (context.electronPlatformName === 'win32') {
    await require('./windows-icon.cjs')(path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe'),path.join(__dirname,'icons','tropa-ai.ico'));
  }
};
