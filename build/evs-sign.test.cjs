const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(env = { NYAO_EVS_READY: '1' }, failAt = -1) {
  const calls = [];
  const proc = { env, platform: 'win32', execPath: 'node' };
  const child = { execFileSync(exe, args, opts) {
    calls.push({ exe, args, opts });
    if (calls.length === failAt) throw new Error('simulated signing failure');
  } };
  const load = (file, extra = {}) => {
    const module = { exports: {} };
    const req = Object.assign((name) => {
      if (name === 'node:child_process') return child;
      if (name === 'node:path') return path;
      if (name in extra) return extra[name];
      throw new Error('Unexpected import: ' + name);
    }, { resolve: () => 'electron-builder/cli.js' });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
      require: req, exports: module.exports, module, process: proc, __dirname
    });
    return module.exports;
  };
  const hook = load('evs-sign.cjs');
  const windows = load('windows.cjs', { './evs-sign.cjs': hook });
  return { calls, hook, windows };
}
test('Windows: finalize EXE, sign, verify, package, verify', () => {
  const h = harness();
  h.windows.buildWindows();
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls[0].args.includes('--dir'));
  assert.equal(h.calls[1].args[3], 'sign-pkg');
  assert.equal(h.calls[2].args[3], 'verify-pkg');
  assert.ok(h.calls[3].args.includes('--prepackaged'));
  assert.equal(h.calls[4].args[3], 'verify-pkg');
  assert.equal(h.calls[0].opts.env.NYAO_WINDOWS_STAGED_BUILD, '1');
});
test('No EVS credentials: fail before building', () => {
  const h = harness({});
  assert.throws(() => h.windows.buildWindows(), /Authenticate/);
  assert.equal(h.calls.length, 0);
});
test('Failed VMP signature: do not produce installers', () => {
  const h = harness({ NYAO_EVS_READY: '1' }, 2);
  assert.throws(() => h.windows.buildWindows(), /simulated/);
  assert.equal(h.calls.length, 2);
});
test('Failed VMP verification: do not produce installers', () => {
  const h = harness({ NYAO_EVS_READY: '1' }, 3);
  assert.throws(() => h.windows.buildWindows(), /simulated/);
  assert.equal(h.calls.length, 3);
});
test('macOS keeps VMP in afterPack, before Apple signing', async () => {
  const h = harness();
  await h.hook.default({ electronPlatformName: 'darwin', appOutDir: 'app' });
  assert.equal(h.calls[0].args[3], 'sign-pkg');
  assert.equal(h.calls[1].args[3], 'verify-pkg');
});
test('Windows afterPack does not sign prematurely', async () => {
  const h = harness({ NYAO_EVS_READY: '1', NYAO_WINDOWS_STAGED_BUILD: '1' });
  await h.hook.default({ electronPlatformName: 'win32', appOutDir: 'app' });
  assert.equal(h.calls.length, 0);
});
test('Direct Windows packaging is rejected', async () => {
  const h = harness();
  await assert.rejects(h.hook.default({ electronPlatformName: 'win32', appOutDir: 'app' }), /npm run dist/);
});
