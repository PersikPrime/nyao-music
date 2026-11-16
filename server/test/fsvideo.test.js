// Видео в полном экране: Автоматор заводит ролик и грузит файл, плеер находит его по названию трека из любого сервиса.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoKey, sniffVideo } from '../src/fsvideo.js';
import { setupAdmin } from './helpers-admin.js';

test('fsvideo: ключ одинаковый для «- Radio Edit», «(Radio Edit)» и кириллицы/латиницы', () => {
  assert.equal(videoKey('Dschinghis Khan', "Moskau '99 - Radio Edit"), videoKey('Dschinghis Khan', "Moskau '99 (Radio Edit)"));
  assert.equal(videoKey('Кино', 'Группа крови'), videoKey('Kino', 'Группа крови'));
  assert.notEqual(videoKey('Кино', 'Группа крови'), videoKey('Кино', 'Кукушка'));
  assert.equal(sniffVideo(Buffer.from('000000186674797069736f6d0000', 'hex')), 'mp4');
  assert.equal(sniffVideo(Buffer.from('1a45dfa3010000000000001f', 'hex')), 'webm');
  assert.equal(sniffVideo(Buffer.from('<html><body>nope')), null);
});

test('fsvideo: права, загрузка, поиск плеером, перемотка, удаление', async () => {
  const { server, call, raw, login } = await setupAdmin({ admins: '777:owner,555:viewer' });
  try {
    const owner = await login(777);
    const viewer = await login(555);
    // смотреть может viewer, менять — нет
    assert.equal((await call('GET', '/admin/fsvideos', { token: viewer.token })).status, 200);
    assert.equal((await call('POST', '/admin/fsvideos', { token: viewer.token, body: { artist: 'A', title: 'B' } })).status, 403);
    const made = await call('POST', '/admin/fsvideos', { token: owner.token, body: { artist: 'Dschinghis Khan', title: "Moskau '99 (Radio Edit)", startMs: 72000, endMs: 130000, offsetMs: 4000, channels: ['nightly'] } });
    assert.equal(made.status, 200, made.text);
    const id = made.json.id;
    // без файла плеер ролика не видит
    assert.equal((await call('GET', `/media/fsvideo?artist=Dschinghis%20Khan&title=${encodeURIComponent("Moskau '99 - Radio Edit")}&channel=nightly`)).json.video, null);
    // не видео — отказ
    assert.equal((await raw('PUT', `/admin/fsvideos/${id}/file`, Buffer.from('<html>not a video</html>'), owner.token)).status, 415);
    const mp4 = Buffer.concat([Buffer.from('000000186674797069736f6d00000200', 'hex'), Buffer.alloc(5000, 7)]);
    const up = await raw('PUT', `/admin/fsvideos/${id}/file?w=1920&h=1080&ms=58000`, mp4, owner.token);
    assert.equal(up.status, 200, up.text);
    assert.equal(up.json.file.mime, 'video/mp4');
    assert.equal(up.json.file.size, mp4.length);
    // плеер Red находит по другому написанию; стабильная — нет (ролик только для Red)
    const found = await call('GET', `/media/fsvideo?artist=Dschinghis%20Khan&title=${encodeURIComponent("Moskau '99 - Radio Edit")}&channel=nightly`);
    assert.equal(found.json.video.startMs, 72000);
    assert.equal(found.json.video.offsetMs, 4000);
    assert.equal((await call('GET', `/media/fsvideo?artist=Dschinghis%20Khan&title=${encodeURIComponent("Moskau '99")}&channel=stable`)).json.video, null);
    // файл с перемоткой
    const p = new URL(found.json.video.url, 'http://x').pathname;
    const part = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { headers: { Range: 'bytes=4-7' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.from(await part.arrayBuffer()).toString('latin1'), 'ftyp');
    // показ посчитан, выключенный ролик не отдаётся
    const list = await call('GET', '/admin/fsvideos', { token: owner.token });
    assert.equal(list.json.items[0].views, 1);
    await call('PUT', `/admin/fsvideos/${id}`, { token: owner.token, body: { ...made.json, enabled: false } });
    assert.equal((await call('GET', `/media/fsvideo?artist=Dschinghis%20Khan&title=${encodeURIComponent("Moskau '99")}&channel=nightly`)).json.video, null);
    // конец раньше начала — ошибка
    assert.equal((await call('PUT', `/admin/fsvideos/${id}`, { token: owner.token, body: { artist: 'A', title: 'B', startMs: 5000, endMs: 1000 } })).status, 400);
    assert.equal((await call('DELETE', `/admin/fsvideos/${id}`, { token: owner.token })).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${p}`)).status, 404);
    // всё записано в журнал
    const audit = await call('GET', '/admin/audit?limit=50', { token: owner.token });
    const acts = (audit.json.items || audit.json.rows || []).map((x) => x.action);
    for (const a of ['fsvideo.create', 'fsvideo.file', 'fsvideo.edit', 'fsvideo.delete']) assert.ok(acts.includes(a), a);
  } finally {
    server.close();
  }
});
