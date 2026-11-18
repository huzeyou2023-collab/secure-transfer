const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Linux 交叉打包时用 64 位 rcedit（wine64 可运行），替代 electron-builder 默认的 32 位 rcedit
exports.default = async function afterPack(context) {
  if (process.platform !== 'linux' || context.electronPlatformName !== 'win32') return;

  const exeName = fs.readdirSync(context.appOutDir).find((n) => n.endsWith('.exe') && !n.includes('Uninstall'));
  const exe = path.join(context.appOutDir, exeName);
  const cache = path.join(process.env.HOME || '', '.cache', 'electron-builder');
  let rcedit = null;
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (n === 'rcedit-x64.exe') return p;
      if (fs.statSync(p).isDirectory()) {
        const r = walk(p);
        if (r) return r;
      }
    }
    return null;
  };
  for (const base of ['/runtime/cache/user/electron-builder', cache]) {
    if (fs.existsSync(base)) {
      rcedit = walk(base);
      if (rcedit) break;
    }
  }
  if (!rcedit) throw new Error('找不到 rcedit-x64.exe，请先运行一次 electron-builder 下载 winCodeSign');

  const iconArg = path.join(context.packager.projectDir, 'resources', 'icon.ico');
  const toZ = (p) => 'Z:' + p.replace(/\//g, '\\');
  const args = [
    rcedit, toZ(exe),
    '--set-version-string', 'FileDescription', '安全传输',
    '--set-version-string', 'ProductName', '安全传输',
    '--set-version-string', 'LegalCopyright', 'Copyright © 2026 安全传输',
    '--set-file-version', context.packager.appInfo.version,
    '--set-product-version', context.packager.appInfo.version + '.0',
    '--set-version-string', 'InternalName', 'SecureTransfer',
    '--set-version-string', 'OriginalFilename', 'SecureTransfer.exe',
  ];
  if (fs.existsSync(iconArg)) args.push('--set-icon', toZ(iconArg));
  execFileSync('wine64', args, { stdio: 'inherit', env: { ...process.env, WINEDEBUG: '-all' } });
};
