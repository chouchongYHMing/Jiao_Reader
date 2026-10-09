'use strict';

// macOS (Apple Silicon only) build: Jiao_Reader-<version>-arm64.dmg and .zip in release/.
// Must run on a Mac. Use --dir to produce only release/mac-arm64/Jiao_Reader.app.
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');

const projectRoot = path.resolve(__dirname, '..');

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS 安装包需要在 Mac 上构建。');
  const targets = process.argv.includes('--dir') ? ['dir'] : ['dmg', 'zip'];
  await build({
    projectDir: projectRoot,
    config: path.join(projectRoot, 'electron-builder.yml'),
    targets: Platform.MAC.createTarget(targets, Arch.arm64),
    publish: 'never'
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
