import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { migrate } from '../src/db.js';
import { createApp, sha256 } from '../src/app.js';
import { Hub } from '../src/hub.js';
import { nickProblem } from '../src/social.js';

// Несколько пользователей сразу: заводим их прямо в базе (вход через Telegram проверяет api.test.js)
async function setup(opts = {}) {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const sent = [];
  const push = { send: async (token, msg) => { sent.push({ token, msg }); return true; } };
  const hub = new Hub({ waitMs: 50 });
  const tg = { configured: false };
  const server = http.createServer(createApp({ db: pool, tg, hub, push, publicUrl: 'https://api.test', log: () => {}, ...opts }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
  let n = 0;
  const user = async (name) => {
    n++;
    const { rows } = await pool.query('INSERT INTO users (tg_id, name) VALUES ($1, $2) RETURNING id', [`tg${n}`, name]);
    const token = `token-${name}-${'x'.repeat(24)}`;
    const s = await pool.query('INSERT INTO sessions (user_id, token_hash, device, platform) VALUES ($1, $2, $3, $4) RETURNING id', [rows[0].id, sha256(token), 'Pixel', 'android']);
    return { id: String(rows[0].id), sid: Number(s.rows[0].id), token };
  };
  return { server, call, user, sent, hub, close: () => { server.close(); hub.close(); } };
}

test('проверка ника', () => {
  assert.equal(nickProblem('ab'), 'Ник — минимум 3 символа');
  assert.match(nickProblem('кот'), /латиница/);
  assert.match(nickProblem('.takko'), /Точка/);
  assert.match(nickProblem('admin'), /занят/);
  assert.match(nickProblem('user_abc123'), /занят/);
  assert.equal(nickProblem('Takko.dev'), null);
  assert.equal(nickProblem('@persik_prime'), null);
});

test('профиль: ник user_xxxxxx по умолчанию, смена ника, занятый ник', async () => {
  const t = await setup();
  try {
    const a = await t.user('Takko');
    const b = await t.user('Persik');
    const p = (await t.call('GET', '/profile', { token: a.token })).json;
    assert.match(p.nick, /^user_[a-z0-9]{6}$/);
    assert.equal(p.nickSet, false);
    assert.equal(p.visibility, 'friends', 'по умолчанию — только друзья');

    const set = await t.call('PUT', '/profile', { token: a.token, body: { nick: 'Takko', bio: '  люблю   волну ' } });
    assert.equal(set.status, 200);
    assert.equal(set.json.nick, 'Takko');
    assert.equal(set.json.nickSet, true);
    assert.equal(set.json.bio, 'люблю волну');

    assert.equal((await t.call('GET', '/nick/check?nick=takko', { token: b.token })).json.ok, false, 'регистр не важен');
    assert.equal((await t.call('GET', '/nick/check?nick=takko', { token: a.token })).json.ok, true, 'свой ник — можно');
    assert.equal((await t.call('PUT', '/profile', { token: b.token, body: { nick: 'TAKKO' } })).status, 409);
    assert.equal((await t.call('PUT', '/profile', { token: b.token, body: { nick: 'x' } })).status, 400);
    assert.equal((await t.call('PUT', '/profile', { token: b.token, body: { visibility: 'всем' } })).status, 400);
  } finally {
    t.close();
  }
});

test('друзья: заявка, принятие, видимость профиля и «сейчас играет»', async () => {
  const t = await setup();
  try {
    const a = await t.user('Takko');
    const b = await t.user('Persik');
    await t.call('PUT', '/profile', { token: a.token, body: { nick: 'takko' } });
    await t.call('PUT', '/profile', { token: b.token, body: { nick: 'persik' } });
    await t.call('PUT', '/push/token', { token: b.token, body: { token: 'fcm-b', platform: 'android' } });

    // поиск по началу ника; «только друзья» в поиске видны
    const found = (await t.call('GET', '/users/search?q=pers', { token: a.token })).json.users;
    assert.equal(found.length, 1);
    assert.equal(found[0].relation, 'none');

    // профиль закрыт, пока не друзья
    const closed = (await t.call('GET', '/users/persik', { token: a.token })).json;
    assert.equal(closed.private, true);
    assert.equal(closed.bio, undefined);

    assert.equal((await t.call('POST', '/friends/request', { token: a.token, body: { nick: '@Persik' } })).json.relation, 'outgoing');
    // push ушёл, потому что телефон Persik не на связи
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].token, 'fcm-b');
    assert.match(t.sent[0].msg.title, /Заявка/);

    const fb = (await t.call('GET', '/friends', { token: b.token })).json;
    assert.equal(fb.incoming.length, 1);
    assert.equal(fb.incoming[0].nick, 'takko');
    assert.equal((await t.call('GET', '/friends', { token: a.token })).json.outgoing.length, 1);

    assert.equal((await t.call('POST', `/friends/${a.id}/accept`, { token: b.token })).json.relation, 'friends');
    // Takko что-то слушает — Persik видит это в списке друзей и в профиле
    await t.call('PUT', '/now', { token: a.token, body: { track: { id: 'ya:1', source: 'ya', srcId: '1', title: 'Пачка сигарет', artist: 'Кино', duration: 270 }, position: 10, playing: true } });
    const friends = (await t.call('GET', '/friends', { token: b.token })).json.friends;
    assert.equal(friends.length, 1);
    assert.equal(friends[0].now.track.title, 'Пачка сигарет');
    const open = (await t.call('GET', '/users/takko', { token: b.token })).json;
    assert.equal(open.private, false);
    assert.equal(open.friends, 1);
    assert.equal(open.now.track.artist, 'Кино');

    // невидимка — трек больше не виден
    await t.call('PUT', '/profile', { token: a.token, body: { invisible: true } });
    assert.equal((await t.call('GET', '/friends', { token: b.token })).json.friends[0].now, null);

    // удалить из друзей
    await t.call('DELETE', `/friends/${a.id}`, { token: b.token });
    assert.equal((await t.call('GET', '/friends', { token: a.token })).json.friends.length, 0);
  } finally {
    t.close();
  }
});

test('встречная заявка сразу делает друзьями; блокировка прячет пользователя', async () => {
  const t = await setup();
  try {
    const a = await t.user('A');
    const b = await t.user('B');
    const c = await t.user('C');
    await t.call('PUT', '/profile', { token: a.token, body: { nick: 'aaa' } });
    await t.call('PUT', '/profile', { token: b.token, body: { nick: 'bbb' } });
    await t.call('PUT', '/profile', { token: c.token, body: { nick: 'ccc', visibility: 'nobody' } });
    await t.call('POST', '/friends/request', { token: a.token, body: { nick: 'bbb' } });
    assert.equal((await t.call('POST', '/friends/request', { token: b.token, body: { nick: 'aaa' } })).json.relation, 'friends');

    // «никто» не находится по началу ника, только по точному
    assert.equal((await t.call('GET', '/users/search?q=cc', { token: a.token })).json.users.length, 0);
    assert.equal((await t.call('GET', '/users/search?q=ccc', { token: a.token })).json.users.length, 1);

    // B блокирует A: дружба исчезает, A больше не видит B
    await t.call('POST', `/blocks/${a.id}`, { token: b.token });
    assert.equal((await t.call('GET', '/users/bbb', { token: a.token })).status, 404);
    assert.equal((await t.call('GET', '/users/search?q=bbb', { token: a.token })).json.users.length, 0);
    assert.equal((await t.call('POST', '/friends/request', { token: a.token, body: { nick: 'bbb' } })).status, 404);
    assert.equal((await t.call('GET', '/blocks', { token: b.token })).json.users[0].nick, 'aaa');
  } finally {
    t.close();
  }
});

test('приглашение по ссылке / QR / касанию: открыл — и вы друзья', async () => {
  const t = await setup();
  try {
    const a = await t.user('Takko');
    const b = await t.user('Friend');
    await t.call('PUT', '/profile', { token: a.token, body: { nick: 'takko' } });
    const inv = (await t.call('POST', '/invites', { token: a.token })).json;
    assert.match(inv.url, /^https:\/\/api\.test\/add\/[a-z0-9]{10}$/);
    assert.equal((await t.call('POST', '/invites', { token: a.token })).json.code, inv.code, 'та же ссылка, пока свежая');

    const web = await t.call('GET', `/add/${inv.code}`);
    assert.match(web.text, /Takko зовёт в Nyao Music/);
    assert.match((await t.call('GET', '/add/zzzzzzzzzz')).text, /устарело/);

    const used = (await t.call('POST', `/invites/${inv.code}/use`, { token: b.token })).json;
    assert.equal(used.relation, 'friends');
    assert.equal(used.user.nick, 'takko');
    assert.equal((await t.call('GET', '/friends', { token: a.token })).json.friends.length, 1);
    assert.equal((await t.call('POST', `/invites/${inv.code}/use`, { token: a.token })).json.relation, 'self');
  } finally {
    t.close();
  }
});

test('трек другу, приглашение в комнату, реакция и входящие', async () => {
  const t = await setup();
  try {
    const a = await t.user('Takko');
    const b = await t.user('Persik');
    const stranger = await t.user('Stranger');
    const inv = (await t.call('POST', '/invites', { token: a.token })).json;
    await t.call('POST', `/invites/${inv.code}/use`, { token: b.token });

    const track = { id: 'yt:abc', source: 'yt', srcId: 'abc', title: 'Song', artist: 'Band', duration: 200 };
    assert.equal((await t.call('POST', '/share', { token: stranger.token, body: { to: b.id, track } })).status, 403, 'только друзьям');
    assert.equal((await t.call('POST', '/share', { token: a.token, body: { to: b.id, track, emoji: '🔥' } })).status, 200);

    // приглашение в комнату — нужна своя комната
    assert.equal((await t.call('POST', `/friends/${b.id}/invite`, { token: a.token })).status, 409);
    const room = (await t.call('POST', '/rooms', { token: a.token })).json.room;
    assert.equal((await t.call('POST', `/friends/${b.id}/invite`, { token: a.token })).status, 200);
    assert.equal((await t.call('POST', `/friends/${a.id}/react`, { token: b.token, body: { emoji: '❤️', track } })).status, 200);
    assert.equal((await t.call('POST', `/friends/${a.id}/react`, { token: b.token, body: { emoji: '💩' } })).status, 400);

    const box = (await t.call('GET', '/inbox', { token: b.token })).json;
    assert.equal(box.unread, 2);
    assert.equal(box.items[0].kind, 'room');
    assert.equal(box.items[0].code, room.code);
    assert.equal(box.items[1].kind, 'track');
    assert.equal(box.items[1].emoji, '🔥');
    assert.equal(box.items[1].from.name, 'Takko');
    await t.call('POST', '/inbox/read', { token: b.token, body: { all: true } });
    assert.equal((await t.call('GET', '/inbox', { token: b.token })).json.unread, 0);

    // живое событие приходит, если устройство на связи
    const live = await t.call('GET', '/events?wait=0', { token: a.token });
    assert.ok(Array.isArray(live.json.events));
    const ev = (await t.call('GET', `/events?cursor=${live.json.cursor}&wait=0`, { token: a.token })).json;
    assert.ok(ev.events.length === 0 || ev.events.every((e) => e.type));
  } finally {
    t.close();
  }
});

test('совпадение вкусов, микс на двоих и значки', async () => {
  const t = await setup();
  try {
    const a = await t.user('Takko');
    const b = await t.user('Persik');
    const inv = (await t.call('POST', '/invites', { token: a.token })).json;
    await t.call('POST', `/invites/${inv.code}/use`, { token: b.token });
    const plays = (prefix, artists) => artists.flatMap((ar, i) => Array.from({ length: 6 }, (_, k) => ({ trackId: `ya:${prefix}${i}${k % 3}`, source: 'ya', title: `${ar} ${k % 3}`, artist: ar, listened: 3000, playedAt: Date.now() - (i * 6 + k) * 60_000 })));
    await t.call('POST', '/history', { token: a.token, body: { plays: plays('a', ['Кино', 'Сплин', 'Земфира', 'Ария']) } });
    await t.call('POST', '/history', { token: b.token, body: { plays: [...plays('a', ['Кино']), ...plays('b', ['Сплин', 'Би-2', 'Ленинград'])] } });
    const mt = (await t.call('GET', `/friends/${b.id}/match`, { token: a.token })).json;
    assert.ok(mt.percent > 0 && mt.percent <= 100);
    assert.ok(mt.commonArtists.includes('Кино') && mt.commonArtists.includes('Сплин'));
    assert.equal(mt.enough, true);
    const mix = (await t.call('GET', `/friends/${b.id}/mix`, { token: a.token })).json;
    assert.match(mix.title, /Persik/);
    assert.ok(mix.tracks.length >= 10);
    assert.ok(mix.tracks.slice(0, 5).some((x) => x.id.startsWith('ya:a0')), 'общие треки в начале');
    // каждый раз по-новому
    const firsts = new Set();
    for (let i = 0; i < 8; i++) firsts.add((await t.call('GET', `/friends/${b.id}/mix`, { token: a.token })).json.tracks.slice(0, 3).map((x) => x.id).join());
    assert.ok(firsts.size > 1, 'начало микса меняется');
    // друг закрыл микс — нельзя ни микс, ни совпадение
    await t.call('PUT', '/profile', { token: b.token, body: { allowDuo: false } });
    assert.equal((await t.call('GET', `/users/${b.id}`, { token: a.token })).json.duo, false);
    assert.equal((await t.call('GET', `/friends/${b.id}/mix`, { token: a.token })).status, 403);
    assert.equal((await t.call('GET', `/friends/${b.id}/match`, { token: a.token })).status, 403);
    assert.equal((await t.call('GET', '/profile', { token: b.token })).json.allowDuo, false);
    await t.call('PUT', '/profile', { token: b.token, body: { allowDuo: true } });
    assert.equal(new Set(mix.tracks.map((x) => x.id)).size, mix.tracks.length, 'без повторов');
    assert.equal(mix.tracks[0].srcId, mix.tracks[0].id.slice(3));
    const prof = (await t.call('GET', `/users/${a.id}`, { token: b.token })).json;
    assert.ok(prof.badges.some((x) => x.id === 'h10'), 'больше 10 часов');
    const stranger = await t.user('X');
    assert.equal((await t.call('GET', `/friends/${a.id}/match`, { token: stranger.token })).status, 403);
  } finally {
    t.close();
  }
});

test('проверка кода: id событий, «никто» по id, ники из цифр, спам заявками, невидимка, предпросмотр приглашения', async () => {
  const t = await setup();
  try {
    const a = await t.user('Takko');
    const b = await t.user('Persik');
    const c = await t.user('Hidden');
    await t.call('PUT', '/profile', { token: a.token, body: { nick: 'takko' } });
    await t.call('PUT', '/profile', { token: c.token, body: { nick: 'hidden', visibility: 'nobody' } });

    // ник из одних цифр и «search» — нельзя (спутаются с id и с поиском)
    assert.equal((await t.call('PUT', '/profile', { token: b.token, body: { nick: '12345' } })).status, 400);
    assert.equal((await t.call('PUT', '/profile', { token: b.token, body: { nick: 'search' } })).status, 400);

    // «никто» не открывается по id, только по точному нику
    assert.equal((await t.call('GET', `/users/${c.id}`, { token: a.token })).status, 404);
    assert.equal((await t.call('GET', '/users/hidden', { token: a.token })).json.private, true);

    // предпросмотр приглашения ничего не меняет
    const inv = (await t.call('POST', '/invites', { token: a.token })).json;
    const pv = (await t.call('GET', `/invites/${inv.code}`, { token: b.token })).json;
    assert.equal(pv.user.nick, 'takko');
    assert.equal(pv.relation, 'none');
    assert.equal((await t.call('GET', '/friends', { token: a.token })).json.friends.length, 0);

    // id живых событий — свои, inbox-id не подменяет курсор
    await t.call('POST', `/invites/${inv.code}/use`, { token: b.token });
    const first = await t.call('GET', '/events?wait=0', { token: b.token });
    await t.call('POST', '/share', { token: a.token, body: { to: b.id, track: { id: 'ya:1', source: 'ya', srcId: '1', title: 'T', artist: 'A' } } });
    const ev = (await t.call('GET', `/events?cursor=${first.json.cursor}&wait=0`, { token: b.token })).json;
    const tr = ev.events.find((e) => e.kind === 'track');
    assert.ok(tr && tr.inboxId, 'у события есть inboxId');
    assert.equal(tr.id, ev.cursor, 'id события — номер в очереди устройства');
    const again = (await t.call('GET', `/events?cursor=${ev.cursor}&wait=0`, { token: b.token })).json;
    assert.equal(again.events.length, 0, 'то же событие второй раз не приходит');

    // заявка → отмена → заявка: одно уведомление
    t.sent.length = 0;
    await t.call('PUT', '/push/token', { token: c.token, body: { token: 'fcm-c' } });
    for (let i = 0; i < 5; i++) {
      await t.call('POST', '/friends/request', { token: a.token, body: { nick: 'hidden' } });
      await t.call('DELETE', `/friends/${c.id}`, { token: a.token });
    }
    assert.equal(t.sent.filter((x) => x.token === 'fcm-c').length, 1, 'push один раз');

    // невидимка прячет статистику и значки
    await t.call('POST', '/history', { token: a.token, body: { plays: [{ trackId: 'ya:9', source: 'ya', title: 'X', artist: 'Y', listened: 40000, playedAt: Date.now() }] } });
    assert.ok((await t.call('GET', `/users/${a.id}`, { token: b.token })).json.stats);
    await t.call('PUT', '/profile', { token: a.token, body: { invisible: true } });
    const hid = (await t.call('GET', `/users/${a.id}`, { token: b.token })).json;
    assert.equal(hid.stats, null);
    assert.deepEqual(hid.badges, []);
    assert.ok((await t.call('GET', `/users/${a.id}`, { token: a.token })).json.stats, 'себе — видно');
  } finally {
    t.close();
  }
});

test('ссылки «Поделиться» на сайте: приглашение, комната, профиль, трек, App Links', async () => {
  const cert = Array.from({ length: 32 }, () => 'AB').join(':');
  const t = await setup({ webUrl: 'https://music.test', webHosts: ['music.test'], androidCerts: [cert], mirror: { latest: () => ({ tag_name: 'v0.8.75', assets: [{ name: 'NyaoMusic-0.8-75.apk', browser_download_url: 'https://api.test/dl/v0.8.75/NyaoMusic-0.8-75.apk' }] }), file: () => null } });
  try {
    const a = await t.user('Takko');
    await t.call('PUT', '/profile', { token: a.token, body: { nick: 'Takko' } });
    const inv = (await t.call('POST', '/invites', { token: a.token })).json;
    assert.match(inv.url, /^https:\/\/music\.test\/share\/add\/[a-z0-9]{10}$/, 'приглашение — ссылка на сайт');
    const add = await t.call('GET', `/share/add/${inv.code}`);
    assert.match(add.text, /зовёт в Nyao Music/);
    assert.match(add.text, new RegExp(`nyao://add/${inv.code}`));
    assert.match(add.text, /NyaoMusic-0\.8-75\.apk/, 'есть ссылка на скачивание');
    assert.match((await t.call('GET', `/add/${inv.code}`)).text, /зовёт/, 'старый адрес работает');

    const room = await t.call('GET', '/share/room/abc123');
    assert.match(room.text, /nyao:\/\/join\/ABC123/);
    assert.match((await t.call('GET', '/join/ABC123')).text, /nyao:\/\/join\/ABC123/, 'старый адрес комнаты');

    const prof = await t.call('GET', '/share/u/TAKKO');
    assert.match(prof.text, /@Takko/);
    assert.ok(!/Takko · @/.test(prof.text), 'имя скрыто, пока профиль не открыт всем');
    assert.match(prof.text, /nyao:\/\/u\/Takko/);
    assert.match((await t.call('GET', '/share/u/nobody_here')).text, /не найден/);

    const tr = await t.call('GET', '/share/track/ya:123?t=' + encodeURIComponent('Песня <b>') + '&a=Кто&d=180');
    assert.match(tr.text, /Песня &lt;b&gt;/, 'данные из ссылки экранируются');
    assert.match(tr.text, /nyao:\/\/track\/ya:123\?t=/);
    assert.equal((await t.call('GET', '/share/track/evil:1')).status, 404);

    const links = (await t.call('GET', '/.well-known/assetlinks.json')).json;
    assert.equal(links[0].target.package_name, 'org.nyao.music');
    assert.deepEqual(links[0].target.sha256_cert_fingerprints, [cert]);
  } finally {
    t.close();
  }
});
