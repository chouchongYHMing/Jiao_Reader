'use strict';

const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { packagePortable } = require('./package-portable.cjs');
const projectRoot = path.resolve(__dirname, '..');
const version = require('../package.json').version;

// Build the uninstaller without executing an unsigned bootstrap on the build host.
// This is electron-builder's own static NSIS reader (also used for macOS builds).
// No Windows application-control settings are changed. Keep the builder version pinned.
if (process.platform === 'win32') {
  const { WineVmManager } = require('app-builder-lib/out/vm/WineVm');
  const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const execWine = WineVmManager.prototype.execWine;
  const bootstrapPath = path.join(projectRoot, 'release', `Jiao_Reader-Setup-${version}.exe`);
  WineVmManager.prototype.execWine = function (request) {
    if (path.resolve(request.file).toLowerCase() === bootstrapPath.toLowerCase()
      && request.options?.env?.__COMPAT_LAYER === 'RunAsInvoker' && !request.appArgs?.length) {
      const uninstallerPath = path.join(path.dirname(bootstrapPath), `${path.basename(bootstrapPath, 'exe')}__uninstaller.exe`);
      return UninstallerReader.exec(bootstrapPath, uninstallerPath);
    }
    return execWine.call(this, request);
  };
}

async function main() {
  // Both distribution formats use exactly the same application bundle.
  // NSIS wraps it without rewriting its executable or application resources.
  const applicationDirectory = await packagePortable();
  if (process.argv.includes('--dir')) return;
  await build({
    projectDir: projectRoot,
    prepackaged: applicationDirectory,
    config: path.join(__dirname, '..', 'electron-builder.yml'),
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    publish: 'never'
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
