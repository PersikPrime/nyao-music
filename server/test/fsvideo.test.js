// Видео в полном экране: Автоматор заводит ролик и грузит файл, плеер находит его по названию трека из любого сервиса.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoKey, sniffVideo, videoArtists, videoTitleKey, sameTrack } from '../src/fsvideo.js';
import { setupAdmin } from './helpers-admin.js';

test('fsvideo: ключ одинаковый для «- Radio Edit», «(Radio Edit)» и кириллицы/латиницы', () => {
  assert.equal(videoKey('Dschinghis Khan', "Moskau '99 - Radio Edit"), videoKey('Dschinghis Khan', "Moskau '99 (Radio Edit)"));
  assert.equal(videoKey('Кино', 'Группа крови'), videoKey('Kino', 'Группа крови'));
  assert.notEqual(videoKey('Кино', 'Группа крови'), videoKey('Кино', 'Кукушка'));
  assert.equal(sniffVideo(Buffer.from('000000186674797069736f6d0000', 'hex')), 'mp4');
  assert.equal(sniffVideo(Buffer.from('1a45dfa3010000000000001f', 'hex')), 'webm');
  assert.equal(sniffVideo(Buffer.from('<html><body>nope')), null);
});

test('fsvideo: соавторы в любом порядке и написании', () => {
  const t = (artist, title) => ({ titleKey: videoTitleKey(title), artists: videoArtists(artist, title) });
  const admin = t('rusino, Hatsune Miku', 'Looping the Rooms');
  for (const [a, ti] of [['rusino', 'Looping the Rooms'], ['Hatsune Miku, rusino', 'Looping the Rooms'], ['rusino & Hatsune Miku', 'Looping the Rooms'], ['rusino feat. Hatsune Miku', 'Looping the Rooms'], ['Hatsune Miku', 'Looping the Rooms (feat. rusino)'], ['rusino x 初音ミク', 'Looping The Rooms']]) {
    assert.ok(sameTrack(t(a, ti), admin), `${a} — ${ti}`);
  }
  assert.ok(!sameTrack(t('Other Artist', 'Looping the Rooms'), admin), 'тот же титул, другой исполнитель');
  assert.ok(!sameTrack(t('rusino', 'Other Song'), admin));
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

test('fsvideo: сервер пережимает ролик — без звука, меньше, оригинал удаляется', { skip: !(await import('node:child_process')).spawnSync('ffmpeg', ['-version']).stdout?.length && 'нет ffmpeg' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsv-'));
  const src = path.join(tmp, 'clip.mp4');
  // «тяжёлый» исходник: шумная картинка с высоким битрейтом и звуком
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M', '-c:a', 'aac', '-shortest', src]);
  const { server, call, raw, login } = await setupAdmin({ admins: '777:owner' });
  try {
    const owner = await login(777);
    const made = await call('POST', '/admin/fsvideos', { token: owner.token, body: { artist: 'Rick Astley', title: 'Never Gonna Give You Up', mode: 'whole' } });
    const buf = fs.readFileSync(src);
    const up = await raw('PUT', `/admin/fsvideos/${made.json.id}/file?w=1280&h=720&ms=4000`, buf, owner.token);
    assert.equal(up.status, 200, up.text);
    assert.equal(up.json.proc, 'processing');
    let v;
    for (let i = 0; i < 120; i++) {
      v = (await call('GET', '/admin/fsvideos', { token: owner.token })).json.items[0];
      if (v.proc !== 'processing') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(v.proc, 'done', v.proc);
    assert.equal(v.origSize, buf.length);
    assert.ok(v.file.size < buf.length / 2, `${buf.length} → ${v.file.size}`);
    assert.equal(v.file.width, 1280);
    const pub = await call('GET', '/media/fsvideo?artist=Rick%20Astley&title=Never%20Gonna%20Give%20You%20Up&channel=nightly');
    const file = await fetch(`http://127.0.0.1:${server.address().port}${new URL(pub.json.video.url, 'http://x').pathname}`);
    const out = path.join(tmp, 'out.mp4');
    fs.writeFileSync(out, Buffer.from(await file.arrayBuffer()));
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).toString().trim();
    assert.equal(streams, 'video', 'звуковой дорожки нет');
  } finally {
    server.close();
  }
});
