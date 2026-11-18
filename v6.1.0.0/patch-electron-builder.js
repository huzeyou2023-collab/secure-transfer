/**
 * 让 electron-builder 接受四位版本号（Windows 传统 a.b.c.d，本项目统一 4.2.0.0）。
 * npm install 后由 postinstall 自动执行；幂等，可重复运行。
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'out', 'util', 'normalizePackageData.js');

if (!fs.existsSync(target)) {
  console.error('[patch-electron-builder] 找不到 ' + target + '，请先执行 npm install');
  process.exit(1);
}

let src = fs.readFileSync(target, 'utf8');
const marker = 'secure-transfer-patch-four-part-version';

if (src.includes(marker)) {
  console.log('[patch-electron-builder] 已打过补丁，跳过');
  process.exit(0);
}

const needle = 'if (!semver.valid(data.version, loose)) {';
if (!src.includes(needle)) {
  console.error('[patch-electron-builder] 未找到目标代码，可能 electron-builder 版本不兼容');
  process.exit(1);
}

const insertion = needle + `
            // ${marker}: 允许四位版本号 a.b.c.d（保留原样，不再强制 semver 三段）
            if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(data.version)) {
                return true;
            }`;

src = src.replace(needle, insertion);
fs.writeFileSync(target, src, 'utf8');
console.log('[patch-electron-builder] 补丁已应用：允许四位版本号');
