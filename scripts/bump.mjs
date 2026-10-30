// Увеличивает номер сборки: «0.2 (13)» → «0.2 (14)».
// Один файл version.json читают и десктоп (package.json, окно «О приложении»), и Android (build.gradle.kts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicVersion } from '../src/main/version.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vFile = path.join(root, 'version.json');
const v = JSON.parse(fs.readFileSync(vFile, 'utf8'));
if (!process.argv.includes('--sync')) {
  const prior = publicVersion(v).split('.').map(Number);
  v.build += 1;
  if (process.argv.includes('--patch')) v.displayVersion = v.name + '.' + prior[2] + '.' + ((prior[3] || 0) + 1);
  else delete v.displayVersion;
}
fs.writeFileSync(vFile, JSON.stringify(v, null, 2) + '\n');

// electron-builder требует semver, поэтому в package.json номер сборки идёт третьей цифрой: 0.2.14
const pFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pFile, 'utf8'));
pkg.version = `${v.name}.${v.build}`;
pkg.build.artifactName = v.displayVersion ? 'NyaoMusic-' + publicVersion(v) + '-build-' + v.name + '.' + v.build + '-${os}-${arch}.${ext}' : 'NyaoMusic-${version}-${os}-${arch}.${ext}';
fs.writeFileSync(pFile, JSON.stringify(pkg, null, 2) + '\n');
console.log('Nyao Music ' + publicVersion(v) + ' · build ' + v.build);
