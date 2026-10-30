// Build the bundled worker on the host OS. macOS CI also builds Apple Silicon.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : null;
if (!os) throw new Error('Native release builds require macOS or Windows');
const targets = os === 'mac' ? [['x64', 'x86_64-apple-darwin'], ['arm64', 'aarch64-apple-darwin']] : [['x64', 'x86_64-pc-windows-msvc']];
const manifest = 'native/librespot/Cargo.toml';
if (!fs.existsSync('native/librespot/Cargo.lock')) execFileSync('cargo', ['generate-lockfile', '--manifest-path', manifest], { stdio: 'inherit' });
for (const [arch, target] of targets) {
  execFileSync('rustup', ['target', 'add', target], { stdio: 'inherit' });
  execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest, '--target', target], { stdio: 'inherit' });
  const dir = path.join('native-bin', os + '-' + arch);
  fs.mkdirSync(dir, { recursive: true });
  const name = 'nyao-librespot' + (os === 'win' ? '.exe' : '');
  fs.copyFileSync(path.join('native/librespot/target', target, 'release', name), path.join(dir, name));
  fs.copyFileSync('native/librespot/LICENSE.librespot', path.join(dir, 'LICENSE.librespot'));
}
