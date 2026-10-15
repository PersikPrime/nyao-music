import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, login } from './helpers.js';
import { Hub } from '../src/hub.js';
import { summarize, periodRange, mainArtist } from '../src/stats.js';

const tr = (i, extra = {}) => ({ id: `ya:${i}`, source: 'ya', srcId: String(i), title: 'T' + i, artist: 'A', duration: 200, ...extra });

test('Connect: устройства, команды и «сейчас играет» в реальном времени', async () => {
  const { server, call } = await setup();
  try {
    const pc = await login(call, 'ПК');
    const phone = await login(call, 'Телефон');
    const P = { token: pc.token };
    const F = { token: phone.token };
    // телефон пока не слушает события — не в сети
    let devs = (await call('GET', '/connect/devices', P)).json.devices;
    const phoneDev = devs.find((d) => d.device === 'Телефон');
    assert.equal(phoneDev.online, false);
    assert.equal((await call('POST', `/connect/${phoneDev.deviceId}/cmd`, { ...P, body: { cmd: 'toggle' } })).status, 409);
    // телефон подключается
    const first = await call('GET', '/events?wait=0', F);
    assert.deepEqual(first.json.events, []);
    devs = (await call('GET', '/connect/devices', P)).json.devices;
    assert.equal(devs.find((d) => d.device === 'Телефон').online, true);
    // ждущий запрос телефона получает команду, как только ПК её отправил
    const waiting = call('GET', `/events?cursor=${first.json.cursor}`, F);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await call('POST', `/connect/${phoneDev.deviceId}/cmd`, { ...P, body: { cmd: 'playTracks', args: { tracks: [tr(1), { bad: 1 }, tr(2)], index: 1, position: 12 } } })).status, 200);
    const got = await waiting;
    assert.equal(got.json.events.length, 1);
    const ev = got.json.events[0];
    assert.equal(ev.type, 'cmd');
    assert.equal(ev.cmd, 'playTracks');
    assert.equal(ev.args.tracks.length, 2, 'мусор отброшен');
    assert.equal(ev.args.index, 1);
    assert.equal(ev.from.device, 'ПК');
    assert.equal((await call('POST', `/connect/${phoneDev.deviceId}/cmd`, { ...P, body: { cmd: 'rm -rf' } })).status, 400);
    // ПК слушает события, телефон обновляет «сейчас играет» — ПК узнаёт сразу
    const pcFirst = await call('GET', '/events?wait=0', P);
    const pcWait = call('GET', `/events?cursor=${pcFirst.json.cursor}`, P);
    await new Promise((r) => setTimeout(r, 50));
    await call('PUT', '/now', { ...F, body: { track: tr(2), position: 12, playing: true, volume: 0.5 } });
    const now = (await pcWait).json.events[0];
    assert.equal(now.type, 'now');
    assert.equal(now.track.id, 'ya:2');
    assert.equal(now.volume, 0.5);
    assert.equal(now.device, 'Телефон');
    // чужое устройство недоступно
    assert.equal((await call('POST', '/connect/99999/cmd', { ...P, body: { cmd: 'toggle' } })).status, 404);
  } finally {
    server.close();
  }
});

test('Слушать вместе: комната, участники, состояние, реакции', async () => {
  const { server, call } = await setup();
  try {
    const host = { token: (await login(call, 'ПК')).token };
    const guest = { token: (await login(call, 'Телефон')).token };
    const created = (await call('POST', '/rooms', host)).json.room;
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(created.isHost, true);
    assert.equal(created.host.name, 'Takko');
    assert.equal((await call('POST', '/rooms', host)).json.room.code, created.code, 'повторно — та же комната');
    assert.equal((await call('POST', '/rooms/ZZZZZZ/join', guest)).status, 404);
    const hostCur = (await call('GET', '/events?wait=0', host)).json.cursor;
    const joined = (await call('POST', `/rooms/${created.code.toLowerCase()}/join`, guest)).json.room;
    assert.equal(joined.isHost, false);
    assert.equal(joined.members.length, 1);
    const hostEv = (await call('GET', `/events?cursor=${hostCur}&wait=0`, host)).json.events;
    assert.equal(hostEv[0].joined, 'Takko');
    // только хост меняет состояние
    assert.equal((await call('PUT', `/rooms/${created.code}/state`, { ...guest, body: { track: tr(5), playing: true } })).status, 403);
    const gCur = (await call('GET', '/events?wait=0', guest)).json.cursor;
    await call('PUT', `/rooms/${created.code}/state`, { ...host, body: { track: tr(5), position: 30, playing: true } });
    const gEv = (await call('GET', `/events?cursor=${gCur}&wait=0`, guest)).json.events;
    assert.equal(gEv[0].room.state.track.id, 'ya:5');
    assert.ok(gEv[0].room.state.position >= 30);
    assert.equal((await call('GET', '/rooms/current', guest)).json.room.code, created.code);
    assert.equal((await call('POST', `/rooms/${created.code}/react`, { ...guest, body: { emoji: '🔥' } })).status, 200);
    assert.equal((await call('POST', `/rooms/${created.code}/react`, { ...guest, body: { emoji: '<script>' } })).status, 400);
    // хост ушёл — комната закрыта
    const g2 = (await call('GET', `/events?wait=0`, guest)).json.cursor;
    await call('POST', `/rooms/${created.code}/leave`, host);
    const closed = (await call('GET', `/events?cursor=${g2}&wait=0`, guest)).json.events;
    assert.equal(closed.at(-1).type, 'room-closed');
    assert.equal((await call('GET', '/rooms/current', guest)).json.room, null);
    assert.match((await call('GET', `/join/${created.code}`)).text, new RegExp(created.code));
  } finally {
    server.close();
  }
});

test('Хаб: пропавшие участники и хост убираются, позиция идёт сама', () => {
  let t = 1_000_000;
  const hub = new Hub({ now: () => t });
  try {
    const room = hub.createRoom(1, 1, { name: 'H' });
    hub.joinRoom(room.code, 2, 2, { name: 'G' });
    hub.setRoomState(room.code, 1, { track: tr(1), position: 10, playing: true });
    t += 5000;
    assert.equal(hub.snapshot(hub.rooms.get(room.code)).state.position, 15);
    t += 100_000;
    hub.touchMember(1);
    hub.sweep();
    assert.equal(hub.rooms.get(room.code).members.size, 0, 'гость без связи 90 с — вышел');
    t += 6 * 60_000;
    hub.sweep();
    assert.equal(hub.rooms.size, 0, 'хост без связи 5 минут — комната закрыта');
  } finally {
    hub.close();
  }
});

test('Итоги: минуты, топы, серия дней, часы с учётом пояса', () => {
  const d = (s) => new Date(s);
  const rows = [
    { track_id: 'ya:1', source: 'ya', title: 'One', artist: 'Alpha, Beta', cover: 'c1', duration: 200, listened: 200, skipped: false, played_at: d('2026-10-01T20:00:00Z') },
    { track_id: 'ya:1', source: 'ya', title: 'One', artist: 'Alpha, Beta', cover: null, duration: 200, listened: 500, skipped: false, played_at: d('2026-10-02T20:00:00Z') },
    { track_id: 'yt:2', source: 'yt', title: 'Two', artist: 'Alpha feat. Gamma', cover: null, duration: 120, listened: 120, skipped: false, played_at: d('2026-10-03T08:00:00Z') },
    { track_id: 'sc:3', source: 'sc', title: 'Skip', artist: 'Delta', cover: null, duration: 180, listened: 5, skipped: true, played_at: d('2026-10-05T08:00:00Z') }
  ];
  const s = summarize(rows, { tz: 240 });
  assert.equal(s.plays, 3);
  assert.equal(s.skips, 1);
  assert.equal(s.minutes, Math.round((200 + 200 + 120) / 60), 'прослушанное не больше длины трека');
  assert.equal(s.topTracks[0].trackId, 'ya:1');
  assert.equal(s.topTracks[0].plays, 2);
  assert.equal(s.topTracks[0].cover, 'c1');
  assert.equal(s.topArtists[0].name, 'Alpha');
  assert.equal(s.topArtists[0].tracks, 2);
  assert.equal(s.longestStreak, 2, 'в поясе +4 это 2 и 3 октября');
  assert.equal(s.topHour, 0, '20:00 UTC — это полночь в Баку');
  assert.equal(s.first.title, 'One');
  assert.equal(mainArtist('A x B'), 'A');
  assert.equal(mainArtist('Simon & Garfunkel'), 'Simon & Garfunkel');
  const r = periodRange('month', { now: Date.parse('2026-10-15T10:00:00Z'), tz: 240 });
  assert.equal(new Date(r.from).toISOString(), '2026-09-30T20:00:00.000Z');
  const y = periodRange('year', { now: Date.parse('2026-10-15T10:00:00Z'), tz: 0, year: 2025 });
  assert.equal(new Date(y.to).toISOString(), '2026-01-01T00:00:00.000Z');
});

test('Итоги через API', async () => {
  const { server, call } = await setup();
  try {
    const a = { token: (await login(call, 'ПК')).token };
    await call('POST', '/history', { ...a, body: { plays: [{ trackId: 'ya:1', source: 'ya', title: 'One', artist: 'Alpha', duration: 180, listened: 180, playedAt: Date.now() - 1000 }] } });
    const r = (await call('GET', '/stats?period=month&tz=240', a)).json;
    assert.equal(r.period, 'month');
    assert.equal(r.plays, 1);
    assert.equal(r.minutes, 3);
    assert.equal(r.topArtists[0].name, 'Alpha');
  } finally {
    server.close();
  }
});
