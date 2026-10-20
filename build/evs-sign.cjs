// macOS: VMP must precede Apple code signing. Windows is signed by windows.cjs
// AFTER electron-builder has finished editing/signing the executable.
const { execFileSync } = require('node:child_process');

function requireEvs() {
  if (process.env.NYAO_EVS_READY !== '1') {
    throw new Error('[evs] EVS authentication is required; refusing to package an unsigned Spotify player');
  }
}
function vmp(command, appOutDir) {
  requireEvs();
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  execFileSync(py, ['-m', 'castlabs_evs.vmp', '-n', command, appOutDir], { stdio: 'inherit' });
}
exports.vmp = vmp;
exports.default = async function evsSign({ electronPlatformName, appOutDir }) {
  if (!['win32', 'darwin'].includes(electronPlatformName)) return;
  requireEvs();
  if (electronPlatformName === 'win32') {
    if (process.env.NYAO_WINDOWS_STAGED_BUILD !== '1') {
      throw new Error('[evs] Use npm run dist: Windows requires VMP signing after executable editing');
    }
    return;
  }
  vmp('sign-pkg', appOutDir);
  vmp('verify-pkg', appOutDir);
};
