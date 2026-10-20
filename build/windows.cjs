// Build the final EXE first, VMP-sign it, then wrap the unchanged package in NSIS/ZIP.
// afterSign is not used: electron-builder may skip it without an Authenticode certificate.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { vmp } = require('./evs-sign.cjs');

function buildWindows() {
  if (process.env.NYAO_EVS_READY !== '1') throw new Error('Authenticate with castlabs EVS before building');
  const cli = require.resolve('electron-builder/cli.js');
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'dist', 'win-unpacked');
  const run = (args) => execFileSync(process.execPath, [cli, ...args], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, NYAO_WINDOWS_STAGED_BUILD: '1' }
  });
  run(['--win', '--x64', '--dir', '--publish', 'never']);
  vmp('sign-pkg', output);
  vmp('verify-pkg', output);
  run(['--win', 'nsis', 'zip', '--x64', '--prepackaged', output, '--publish', 'never']);
  // Fail the job before upload if packaging ever mutates the signed executable.
  vmp('verify-pkg', output);
}
exports.buildWindows = buildWindows;
if (require.main === module) buildWindows();
