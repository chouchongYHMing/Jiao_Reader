'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');

async function packagePortable() {
  const { packager } = await import('@electron/packager');
  const projectRoot = path.resolve(__dirname, '..');
  const readmeFiles = ['README.md', 'README.en.md', 'README.ca.md', 'README.es.md'];
  const rootFiles = new Set(['main.cjs', 'preload.cjs', 'ollama.cjs', 'reading-store.cjs', 'package.json', 'LICENSE', ...readmeFiles]);
  const output = await packager({
    dir: projectRoot,
    name: 'Jiao_Reader',
    platform: 'win32',
    arch: 'x64',
    out: path.join(projectRoot, 'dist'),
    icon: path.join(__dirname, 'icon.ico'),
    overwrite: true,
    asar: true,
    prune: true,
    // App code uses Electron and Node built-ins only. Include its runtime
    // modules and PDF.js assets; omit build tools, local PDFs and test output.
    ignore: candidate => {
      const relative = candidate.replaceAll('\\', '/').replace(/^\/+/, '');
      if (!relative) return false;
      const isApp = relative === 'app' || relative.startsWith('app/');
      const isDocumentation = relative === 'docs' || /^docs\/[^/]+\.md$/.test(relative);
      return !isApp && !isDocumentation && !rootFiles.has(relative);
    }
  });
  for (const directory of output) {
    // Keep user-facing documentation accessible outside the application archive.
    await fs.copyFile(path.join(projectRoot, 'LICENSE'), path.join(directory, 'LICENSE.jiao-reader.txt'));
    for (const readme of readmeFiles) {
      await fs.copyFile(path.join(projectRoot, readme), path.join(directory, readme));
    }
    await fs.cp(path.join(projectRoot, 'docs'), path.join(directory, 'docs'), {
      recursive: true,
      filter: source => source === path.join(projectRoot, 'docs') || source.endsWith('.md')
    });
    console.log(directory);
  }
  return output[0];
}

module.exports = { packagePortable };

if (require.main === module) {
  packagePortable().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
