// Подпись VMP (castlabs EVS) после упаковки, до подписи macOS.
// Electron от castlabs несёт Widevine; без VMP-подписи на Windows и macOS сервисы с защитой
// (в том числе Spotify Web Playback SDK) обычно отказываются играть.
// Учётка EVS — в секретах GitHub (NYAO_EVS_ACCOUNT / NYAO_EVS_PASSWD), CI заранее выполняет вход.
// Без входа подпись пропускается: сборка соберётся, но Spotify на ней, скорее всего, не заиграет.
const { execFileSync } = require('node:child_process');

exports.default = async function evsSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'win32' && electronPlatformName !== 'darwin') return;
  if (!process.env.NYAO_EVS_READY) {
    console.warn('[evs] вход в castlabs EVS не выполнен — VMP-подпись пропущена');
    return;
  }
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  console.log(`[evs] VMP-подпись ${appOutDir}`);
  execFileSync(py, ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', appOutDir], { stdio: 'inherit' });
  execFileSync(py, ['-m', 'castlabs_evs.vmp', '-n', 'verify-pkg', appOutDir], { stdio: 'inherit' });
};
