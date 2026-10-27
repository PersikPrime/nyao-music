// Пакет горячего обновления ПК (см. src/main/hot.js) для релиза.
//   node scripts/hot-bundle.mjs --compat   — только src/main/compat.json (перед сборкой установщика)
//   node scripts/hot-bundle.mjs            — compat.json + dist/NyaoMusic-<версия>-app-<compat>.nui и .nui.sig
// Закрытый ключ — в переменной NYAO_HOT_KEY (GitHub Secret). Без ключа пакет не собирается (код выхода 0, предупреждение).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compatOf, makeBundle, signBundle, verifyBundle, readBundle } from '../src/main/hot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const compat = compatOf(pkg, root);
fs.writeFileSync(path.join(root, 'src', 'main', 'compat.json'), JSON.stringify({ compat }) + '\n');
console.log(`compat ${compat}`);
if (process.argv.includes('--compat')) process.exit(0);

const key = (process.env.NYAO_HOT_KEY || '').trim();
if (!key) {
  console.log('::warning::Нет секрета NYAO_HOT_KEY — пакет быстрого обновления не собран');
  process.exit(0);
}
const pubFile = path.join(root, 'src', 'main', 'hot-key.pem');
if (!fs.existsSync(pubFile)) {
  console.log('::warning::Нет src/main/hot-key.pem — приложение не сможет проверить пакет, не собираю');
  process.exit(0);
}
const pub = fs.readFileSync(pubFile, 'utf8');
const derived = crypto.createPublicKey(crypto.createPrivateKey(key)).export({ type: 'spki', format: 'pem' });
if (derived.trim() !== pub.trim()) {
  console.error('::error::NYAO_HOT_KEY не подходит к src/main/hot-key.pem');
  process.exit(1);
}
const { buf, meta } = makeBundle(root);
const sig = signBundle(buf, key);
if (!verifyBundle(buf, sig, pub)) throw new Error('подпись не проверилась');
readBundle(buf);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const name = `NyaoMusic-${meta.name}.${meta.build}-app-${meta.compat}.nui`;
fs.writeFileSync(path.join(root, 'dist', name), buf);
fs.writeFileSync(path.join(root, 'dist', `${name}.sig`), sig + '\n');
console.log(`${name}: ${meta.count} файлов, ${(buf.length / 1024).toFixed(0)} КБ`);
