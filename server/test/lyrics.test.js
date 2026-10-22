import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { migrate } from '../src/db.js';
import { createApp, sha256 } from '../src/app.js';
import { Hub } from '../src/hub.js';
import { checkLyrics, norm, parseLrc } from '../src/lyrics.js';

async function setup(opts = {}) {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const hub = new Hub({ waitMs: 50 });
  const server = http.createServer(createApp({ db: pool, tg: { configured: false }, hub, log: () => {}, minBuild: 70, ...opts }));
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
  const user = async (name, username) => {
    n++;
    const { rows } = await pool.query('INSERT INTO users (tg_id, name, username) VALUES ($1, $2, $3) RETURNING id', [`10${n}`, name, username || null]);
    const token = `token-u${n}-${"x".repeat(24)}`;
    await pool.query('INSERT INTO sessions (user_id, token_hash, device, platform) VALUES ($1, $2, $3, $4)', [rows[0].id, sha256(token), 'Сайт', 'web']);
    return { id: String(rows[0].id), tgId: `10${n}`, token };
  };
  return { call, user, close: () => { server.close(); hub.close(); } };
}

const LRC = '[00:10.00] Первая строка\n[00:14.50] Вторая строка\n\n[00:20.2] Третья';

test('тексты: автопроверка и разбор LRC', () => {
  assert.equal(norm('Песня (feat. Кто-то) — Ёлка!'), 'песня елка');
  assert.deepEqual(parseLrc('[ar:Кино]\n[01:02.5] а').map((l) => l.at), [62500]);
  const c = checkLyrics({ synced: LRC, duration: 180 });
  assert.equal(c.plain, 'Первая строка\nВторая строка\nТретья', 'обычный текст берётся из синхронизации');
  assert.match(c.synced, /^\[00:10\.00\] Первая строка\n\[00:14\.50\] Вторая строка\n\[00:20\.20\] Третья$/);
  assert.throws(() => checkLyrics({ synced: '[00:20.00] б\n[00:10.00] а' }), /раньше предыдущей/);
  assert.throws(() => checkLyrics({ synced: '[05:00.00] а', duration: 120 }), /позже конца/);
  assert.throws(() => checkLyrics({ synced: 'без времени' }), /Строка 1/);
  assert.throws(() => checkLyrics({ plain: 'смотри https://spam.example' }), /Ссылки/);
  assert.throws(() => checkLyrics({ plain: '   ' }), /Пустой/);
  assert.deepEqual(checkLyrics({ instrumental: true, plain: 'что угодно' }), { plain: '', synced: '', instrumental: true, structure: [] });
  // текст с куплетами + синхронизация: строки должны совпасть, разбивка на куплеты сохраняется
  const both = checkLyrics({ plain: 'Первая строка\nВторая строка\n\nТретья', synced: LRC });
  assert.equal(both.plain, 'Первая строка\nВторая строка\n\nТретья');
  assert.throws(() => checkLyrics({ plain: 'Первая строка\nДругая\nТретья', synced: LRC }), /расходятся в строке 2/);
  // структура: по номерам строк текста, по порядку, известные части
  assert.deepEqual(checkLyrics({ plain: 'а\nб\n\nв', structure: [{ from: 0, type: 'verse' }, { from: 2, type: 'chorus' }] }).structure, [{ from: 0, type: 'verse' }, { from: 2, type: 'chorus' }]);
  assert.throws(() => checkLyrics({ plain: 'а\nб', structure: [{ from: 5, type: 'verse' }] }), /строку, которой нет/);
  assert.throws(() => checkLyrics({ plain: 'а\nб', structure: [{ from: 1, type: 'verse' }, { from: 0, type: 'chorus' }] }), /не по порядку/);
  assert.throws(() => checkLyrics({ plain: 'а', structure: [{ from: 0, type: 'solo' }] }), /Неизвестная/);
  assert.equal(checkLyrics({ plain: 'а\n\n\n\nб' }).plain, 'а\n\nб');
});

test('тексты: отправка → проверка специалистом → публикация (формат LRCLIB)', async () => {
  const t = await setup();
  try {
    const owner = await t.user('Takko', 'takko'); // первый аккаунт сервера — админ, пока LYRICS_ADMINS пуст
    const author = await t.user('Автор', 'author');
    const spec = await t.user('Спец', 'spec');
    assert.equal((await t.call('GET', '/api/me', { token: owner.token })).json.role, 'admin');
    assert.equal((await t.call('GET', '/api/me', { token: author.token })).json.role, null);

    assert.equal((await t.call('POST', '/api/submit', { body: { track: { title: 'Песня', artist: 'Группа' }, plain: 'а' } })).status, 401);
    assert.equal((await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Песня', artist: 'Группа' }, plain: 'а' } })).status, 400, 'без длительности нельзя');
    const bad = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Песня', artist: 'Группа', duration: 180 }, synced: '[00:20.00] б\n[00:10.00] а' } });
    assert.equal(bad.status, 422);
    const sub = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Песня', artist: 'Группа', album: 'Альбом', duration: 180 }, synced: LRC } });
    assert.equal(sub.status, 200);
    assert.equal(sub.json.status, 'pending');
    // повторная отправка до проверки заменяет черновик, а не плодит второй
    const again = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'песня', artist: 'ГРУППА', duration: 181 }, synced: LRC + '\n[00:30.00] Четвёртая' } });
    assert.equal(again.json.id, sub.json.id);
    assert.equal(again.json.trackId, sub.json.trackId, 'тот же трек: название без регистра, длительность ±2 с');

    // до проверки — нет в публичном API (ошибка как у LRCLIB)
    const miss = await t.call('GET', '/api/get?artist_name=Группа&track_name=Песня&duration=180');
    assert.equal(miss.status, 404);
    assert.equal(miss.json.name, 'TrackNotFound');

    assert.equal((await t.call('GET', '/api/review', { token: author.token })).status, 403);
    assert.equal((await t.call('POST', '/api/admin/roles', { token: author.token, body: { user: 'spec', role: 'specialist' } })).status, 403);
    assert.equal((await t.call('POST', '/api/admin/roles', { token: owner.token, body: { user: '@spec', role: 'specialist' } })).status, 200);
    assert.equal((await t.call('POST', '/api/admin/roles', { token: owner.token, body: { user: 'nobody', role: 'specialist' } })).status, 404);

    const q = (await t.call('GET', '/api/review', { token: spec.token })).json.items;
    assert.equal(q.length, 1);
    assert.equal(q[0].edit, false);
    assert.equal((await t.call('POST', `/api/review/${q[0].id}`, { token: spec.token, body: { action: 'return' } })).status, 400, 'вернуть — только с комментарием');
    assert.equal((await t.call('POST', `/api/review/${q[0].id}`, { token: spec.token, body: { action: 'accept' } })).json.status, 'published');
    assert.equal((await t.call('POST', `/api/review/${q[0].id}`, { token: spec.token, body: { action: 'accept' } })).status, 409);

    const got = await t.call('GET', '/api/get?artist_name=группа&track_name=ПЕСНЯ&duration=179');
    assert.equal(got.status, 200);
    assert.equal(got.json.trackName, 'Песня');
    assert.equal(got.json.albumName, 'Альбом');
    assert.match(got.json.syncedLyrics, /\[00:30\.00\] Четвёртая$/);
    assert.equal(got.json.plainLyrics.split('\n').length, 4);
    assert.deepEqual(got.json.sections, []);
    // правка только структуры — тоже правка
    const st = await t.call('POST', '/api/submit', { token: author.token, body: { trackId: got.json.id, synced: got.json.syncedLyrics, structure: [{ from: 0, type: 'verse' }, { from: 2, type: 'chorus' }] } });
    assert.equal(st.status, 200);
    await t.call('POST', `/api/review/${st.json.id}`, { token: spec.token, body: { action: 'accept' } });
    assert.deepEqual((await t.call('GET', `/api/get/${got.json.id}`)).json.sections, [{ from: 0, type: 'verse' }, { from: 2, type: 'chorus' }]);
    assert.equal((await t.call('GET', `/api/track/${got.json.id}`)).json.published.structure[1].type, 'chorus');
    assert.equal((await t.call('GET', '/api/get?artist_name=Группа&track_name=Песня&duration=200')).status, 404, 'другая длительность — другая версия трека');
    assert.equal((await t.call('GET', `/api/get/${got.json.id}`)).json.id, got.json.id);
    assert.equal((await t.call('GET', '/api/search?q=груп пес')).json.length, 1);
    assert.equal((await t.call('GET', '/api/stats')).json.tracks, 1);

    // правка: пока не проверена, в API старая версия; своя правка специалиста — только чужими руками
    const edit = await t.call('POST', '/api/submit', { token: spec.token, body: { trackId: got.json.id, plain: 'Совсем другой текст' } });
    assert.equal(edit.status, 200);
    assert.equal((await t.call('POST', '/api/submit', { token: spec.token, body: { trackId: got.json.id, synced: got.json.syncedLyrics, structure: [{ from: 0, type: 'verse' }, { from: 2, type: 'chorus' }] } })).status, 409, 'без изменений — нечего проверять');
    assert.match((await t.call('GET', `/api/get/${got.json.id}`)).json.syncedLyrics, /Четвёртая/);
    assert.equal((await t.call('POST', `/api/review/${edit.json.id}`, { token: spec.token, body: { action: 'accept' } })).status, 403);
    const ret = await t.call('POST', `/api/review/${edit.json.id}`, { token: owner.token, body: { action: 'return', note: 'Верни синхронизацию' } });
    assert.equal(ret.json.status, 'returned');
    const mine = (await t.call('GET', '/api/me', { token: spec.token })).json.submissions;
    assert.equal(mine[0].status, 'returned');
    assert.equal(mine[0].note, 'Верни синхронизацию');
    assert.equal((await t.call('GET', `/api/version/${edit.json.id}`, { token: author.token })).status, 403, 'чужой черновик не открыть');

    // жалоба правообладателя: трек скрывается сразу, админ может вернуть
    assert.equal((await t.call('POST', '/api/report', { body: { trackId: got.json.id, kind: 'copyright', details: 'Это моё' } })).status, 400);
    const rep = await t.call('POST', '/api/report', { body: { trackId: got.json.id, kind: 'copyright', name: 'Издатель', contact: 'legal@example.com', details: 'Это наш текст' } });
    assert.equal(rep.json.hidden, true);
    assert.equal((await t.call('GET', `/api/get/${got.json.id}`)).status, 404);
    assert.equal((await t.call('GET', `/api/track/${got.json.id}`)).json.hidden, true);
    assert.equal((await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Песня', artist: 'Группа', duration: 180 }, plain: 'снова' } })).status, 451);
    const reports = (await t.call('GET', '/api/admin/reports', { token: owner.token })).json.items;
    assert.equal(reports.length, 1);
    assert.equal((await t.call('GET', '/api/admin/reports', { token: spec.token })).status, 403);
    await t.call('POST', `/api/admin/reports/${reports[0].id}`, { token: owner.token, body: { action: 'restore' } });
    assert.equal((await t.call('GET', `/api/get/${got.json.id}`)).status, 200);
  } finally {
    t.close();
  }
});

test('тексты: LYRICS_ADMINS, сайт на своём домене, без проверки сборки', async () => {
  const t = await setup({ lyricsAdmins: ['102'], lyricsHosts: ['127.0.0.1'] });
  try {
    const a = await t.user('Первый');
    const b = await t.user('Второй'); // tg 102
    assert.equal((await t.call('GET', '/api/me', { token: a.token })).json.role, null);
    assert.equal((await t.call('GET', '/api/me', { token: b.token })).json.role, 'admin');
    // сайт: любой адрес без /api и /auth — одна страница
    const page = await t.call('GET', '/t/5');
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Nyao LyricLabs<\/title>/);
    assert.equal((await t.call('GET', '/api/stats')).json.tracks, 0);
  } finally {
    t.close();
  }
});

test('тексты: каталог Яндекса — метаданные оттуда, одинаковые названия не путаются', async () => {
  const cat = {
    tracks: {
      111: { yaId: '111', title: 'Звезда', artist: 'Группа', album: 'Первый', duration: 200, cover: 'https://img/1' },
      222: { yaId: '222', title: 'Звезда', artist: 'Группа', album: 'Концерт', duration: 201, cover: 'https://img/2' }
    },
    async search() { return Object.values(this.tracks); },
    async track(id) { return this.tracks[id] || null; }
  };
  const t = await setup({ yaCatalog: cat });
  try {
    const owner = await t.user('Takko');
    const author = await t.user('Автор');
    // метаданные из запроса игнорируются — берутся из каталога
    const a = await t.call('POST', '/api/submit', { token: author.token, body: { track: { yaId: '111', title: 'Подделка', duration: 5 }, plain: 'Студийный текст' } });
    assert.equal(a.status, 200);
    const b = await t.call('POST', '/api/submit', { token: author.token, body: { track: { yaId: '222' }, plain: 'Концертный текст' } });
    assert.notEqual(b.json.trackId, a.json.trackId, 'та же мета, но другой трек Яндекса — отдельная запись');
    assert.equal((await t.call('POST', '/api/submit', { token: author.token, body: { track: { yaId: '999' }, plain: 'x' } })).status, 404);
    for (const v of [a, b]) await t.call('POST', `/api/review/${v.json.id}`, { token: owner.token, body: { action: 'accept' } });
    const tr = (await t.call('GET', `/api/track/${a.json.trackId}`)).json;
    assert.equal(tr.title, 'Звезда');
    assert.equal(tr.cover, 'https://img/1');
    assert.equal(tr.yaId, '111');
    const g = await t.call('GET', '/api/get?artist_name=Группа&track_name=Звезда&duration=201&ya_id=222');
    assert.equal(g.json.plainLyrics, 'Концертный текст', 'по ya_id — точная запись');
    const g2 = await t.call('GET', '/api/get?artist_name=Группа&track_name=Звезда&duration=200');
    assert.equal(g2.status, 200, 'без ya_id (Spotify, LRCLIB-клиенты) — по названию и длительности');
    // в каталоге видно, у каких треков текст уже есть
    cat.tracks[333] = { yaId: '333', title: 'Новая', artist: 'Группа', album: '', duration: 150, cover: null };
    const items = (await t.call('GET', '/api/catalog?q=группа')).json.items;
    assert.equal(items.find((x) => x.yaId === '111').lyrics.published, true);
    assert.equal(items.find((x) => x.yaId === '333').lyrics, null);
    assert.equal((await t.call('GET', '/api/catalog/track/333')).json.title, 'Новая');
  } finally {
    t.close();
  }
});

test('тексты: трек по ссылке Яндекс Музыки или Spotify', async () => {
  const cat = {
    tracks: { 555: { yaId: '555', title: 'Луна', artist: 'Группа', album: 'А', duration: 190, cover: null }, 556: { yaId: '556', title: 'Луна (Live)', artist: 'Группа', album: 'Б', duration: 260, cover: null } },
    async search() { return Object.values(this.tracks); },
    async track(id) { return this.tracks[id] || null; },
    async spotifyTrack(id) { return id === '4uLU6hMCjMI75M1A2tKUQC' ? { title: 'Луна', artist: 'Группа', album: '', duration: 191, cover: 'https://i.scdn.co/x' } : id === '0000000000000000000000' ? { title: 'Нет в Яндексе', artist: 'Кто-то', album: '', duration: 100, cover: null } : null; }
  };
  const t = await setup({ yaCatalog: cat });
  try {
    const link = (u) => t.call('GET', `/api/catalog/link?url=${encodeURIComponent(u)}`);
    const ya = await link('https://music.yandex.ru/album/123/track/555?utm=1');
    assert.equal(ya.json.source, 'ya');
    assert.equal(ya.json.items[0].yaId, '555');
    assert.equal((await link('https://music.yandex.com/track/556')).json.items[0].title, 'Луна (Live)');
    const sp = await link('https://open.spotify.com/intl-ru/track/4uLU6hMCjMI75M1A2tKUQC?si=abc');
    assert.equal(sp.json.source, 'sp');
    assert.deepEqual(sp.json.items.map((x) => x.yaId), ['555'], 'тот же трек в Яндексе: название и длительность, live не подходит');
    const miss = await link('spotify:track:0000000000000000000000');
    assert.equal(miss.json.items.length, 0);
    assert.equal(miss.json.fallback.title, 'Нет в Яндексе');
    assert.equal((await link('https://example.com/x')).status, 400);
  } finally {
    t.close();
  }
});

test('каталог: метаданные со страницы Spotify', async () => {
  const { YaCatalog } = await import('../src/catalog-ya.js');
  const page = (head) => async () => new Response(`<html><head>${head}</head></html>`, { status: 200 });
  const a = new YaCatalog({ fetch: page('<title>Bara Bada Bastu - song and lyrics by KAJ | Spotify</title><meta property="og:title" content="Bara Bada Bastu"/><meta property="og:description" content="Listen to Bara Bada Bastu on Spotify. Song · KAJ · 2025"/><meta name="music:duration" content="166"/><meta property="og:image" content="https://i.scdn.co/image/x"/>') });
  assert.deepEqual(await a.spotifyTrack('x1'), { title: 'Bara Bada Bastu', artist: 'KAJ', album: '', duration: 166, cover: 'https://i.scdn.co/image/x' });
  const b = new YaCatalog({ fetch: page('<meta property="og:title" content="Луна"><meta property="og:description" content="Группа · Song · 2020">') });
  assert.equal((await b.spotifyTrack('x2')).artist, 'Группа');
  const c = new YaCatalog({ fetch: async () => new Response('', { status: 403 }) });
  await assert.rejects(c.spotifyTrack('x3'), /403/);
});

test('тексты: исполнитель — хотя бы один общий; админ правит данные трека', async () => {
  const { sameArtist, artistSet } = await import('../src/lyrics.js');
  assert.deepEqual(artistSet('DJ Frolov, Дмитрий Фролов feat. Кто-то'), ['dj frolov', 'дмитрий фролов', 'кто то']);
  assert.equal(sameArtist('DJ Frolov, Дмитрий Фролов', 'DJ Frolov'), true);
  assert.equal(sameArtist('DJ Frolov', 'DJ Frolov & MC X'), true);
  assert.equal(sameArtist('DJ Frolov', 'DJ Smash'), false);
  const t = await setup();
  try {
    const owner = await t.user('Takko');
    const author = await t.user('Автор');
    const sub = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Вивальди как быть', artist: 'DJ Frolov, Дмитрий Фролов', duration: 51 }, plain: 'Строка' } });
    await t.call('POST', `/api/review/${sub.json.id}`, { token: owner.token, body: { action: 'accept' } });
    // Spotify и другие сервисы знают только «DJ Frolov»
    const g = await t.call('GET', `/api/get?track_name=${encodeURIComponent('Вивальди как быть')}&artist_name=DJ%20Frolov&duration=51`);
    assert.equal(g.status, 200);
    assert.equal((await t.call('GET', `/api/get?track_name=${encodeURIComponent('Вивальди как быть')}&artist_name=DJ%20Smash&duration=51`)).status, 404);
    // админ правит данные
    assert.equal((await t.call('POST', `/api/admin/track/${sub.json.trackId}`, { token: author.token, body: { artist: 'X' } })).status, 403);
    const ed = await t.call('POST', `/api/admin/track/${sub.json.trackId}`, { token: owner.token, body: { title: 'Вивальди, как быть', artist: 'DJ Frolov', album: 'Сингл', duration: 52 } });
    assert.equal(ed.status, 200);
    const tr = (await t.call('GET', `/api/track/${sub.json.trackId}`)).json;
    assert.equal(tr.artist, 'DJ Frolov');
    assert.equal(tr.duration, 52);
    assert.equal((await t.call('GET', `/api/get?track_name=${encodeURIComponent('Вивальди как быть')}&artist_name=DJ%20Frolov&duration=52`)).status, 200, 'нормализация пересчитана');
    assert.equal((await t.call('POST', `/api/admin/track/${sub.json.trackId}`, { token: owner.token, body: { yaId: 'abc' } })).status, 400);
  } finally {
    t.close();
  }
});

test('тексты: ISRC — точное совпадение записи в любом сервисе', async () => {
  const { normIsrc } = await import('../src/lyrics.js');
  assert.equal(normIsrc('us-rc1-76-07839'), 'USRC17607839');
  assert.equal(normIsrc('abc'), null);
  const cat = { async search() { return []; }, async track() { return null; }, async isrcFor({ title }) { return title === 'Без ISRC' ? 'GBAYE0601498' : null; } };
  const t = await setup({ yaCatalog: cat });
  try {
    const owner = await t.user('Takko');
    const a = await t.call('POST', '/api/submit', { token: owner.token, body: { track: { title: 'Песня', artist: 'Группа', duration: 200, isrc: 'USRC17607839' }, plain: 'Текст' } });
    assert.equal(a.status, 200);
    assert.equal((await t.call('POST', '/api/submit', { token: owner.token, body: { track: { title: 'X', artist: 'Y', duration: 10, isrc: 'плохой' }, plain: 'a' } })).status, 400);
    await t.call('POST', `/api/review/${a.json.id}`, { token: owner.token, body: { action: 'accept' } });
    // в другом сервисе трек называется иначе — но ISRC тот же
    const g = await t.call('GET', '/api/get?track_name=Song&artist_name=Band&isrc=USRC17607839');
    assert.equal(g.status, 200);
    assert.equal(g.json.isrc, 'USRC17607839');
    // ISRC нового трека подтягивается сам (в фоне)
    const b = await t.call('POST', '/api/submit', { token: owner.token, body: { track: { title: 'Без ISRC', artist: 'Кто-то', duration: 100 }, plain: 'Текст' } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await t.call('GET', `/api/track/${b.json.trackId}`)).json.isrc, 'GBAYE0601498');
    // админ правит ISRC
    assert.equal((await t.call('POST', `/api/admin/track/${b.json.trackId}`, { token: owner.token, body: { isrc: 'gb-aye-06-01499' } })).status, 200);
    assert.equal((await t.call('GET', `/api/track/${b.json.trackId}`)).json.isrc, 'GBAYE0601499');
  } finally {
    t.close();
  }
});

test('каталог: ISRC через Deezer', async () => {
  const { YaCatalog } = await import('../src/catalog-ya.js');
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('/search')) return Response.json({ data: [{ id: 1, title: 'Луна (Remix)', duration: 190 }, { id: 2, title: 'Луна', duration: 191 }] });
    return Response.json({ id: 2, isrc: 'ruabc2400001' });
  };
  const c = new YaCatalog({ fetch });
  assert.equal(await c.isrcFor({ title: 'Луна', artist: 'Группа, Другой', duration: 190 }), 'RUABC2400001');
  assert.match(decodeURIComponent(calls[0]).replace(/\+/g, " "), /artist:"Группа" track:"Луна"/);
});

test('тексты: ссылка Spotify через song.link сразу находит трек Яндекса', async () => {
  const cat = {
    async search() { return []; },
    async track(id) { return id === '777' ? { yaId: '777', title: 'Вивальди как быть', artist: 'DJ Frolov, Дмитрий Фролов', album: '', duration: 51, cover: null } : null; },
    async songLink(url) { return url.endsWith('/abcdefghij1234567890ab') ? { yaId: '777', title: 'Вивальди как быть', artist: 'DJ Frolov', cover: null } : null; },
    async spotifyTrack() { throw new Error('403'); }
  };
  const t = await setup({ yaCatalog: cat });
  try {
    const r = await t.call('GET', `/api/catalog/link?url=${encodeURIComponent('https://open.spotify.com/track/abcdefghij1234567890ab')}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.items[0].yaId, '777');
    // ни song.link, ни страница Spotify не ответили — понятная ошибка
    assert.equal((await t.call('GET', `/api/catalog/link?url=${encodeURIComponent('https://open.spotify.com/track/zzzzzzzzzz1234567890ab')}`)).status, 502);
  } finally {
    t.close();
  }
});
