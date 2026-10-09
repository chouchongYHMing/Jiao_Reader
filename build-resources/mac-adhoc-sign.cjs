'use strict';

// Apple Silicon refuses to run unsigned code. Without an Apple Developer ID the
// bundle is ad-hoc signed after packaging so it launches on the build machine
// (and elsewhere after the user approves it in Privacy & Security).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') throw new Error('Mac 包的签名需要在 macOS 上完成（codesign）。');
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
