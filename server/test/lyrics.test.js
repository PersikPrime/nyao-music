import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { migrate } from '../src/db.js';
import { createApp, sha256 } from '../src/app.js';
import { Hub } from '../src/hub.js';
import { checkLyrics, checkWords, norm, parseLrc, parseWords, toTtml } from '../src/lyrics.js';

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
  assert.deepEqual(checkLyrics({ instrumental: true, plain: 'что угодно' }), { plain: '', synced: '', instrumental: true, structure: [], words: '' });
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

test('тексты: TTML и импорт релиза DDEX', async () => {
  const { toTtml } = await import('../src/lyrics.js');
  const xml = toTtml({ title: 'Песня & Co', artist: 'Группа', duration: 30, plain: 'Раз\nДва\n\nТри', synced: '[00:01.00] Раз\n[00:02.50] Два\n[00:10.00] Три', structure: [{ from: 0, type: 'verse' }, { from: 2, type: 'chorus' }] });
  assert.match(xml, /<ttm:title>Песня &amp; Co<\/ttm:title>/);
  assert.match(xml, /<div itunes:songPart="Verse">/);
  assert.match(xml, /<p begin="00:00:02.500" end="00:00:10.000">Два<\/p>/);
  assert.match(xml, /itunes:songPart="Chorus">\n\s+<p begin="00:00:10.000" end="00:00:30.000">Три<\/p>/);
  // пауза в LRC (пустая метка) — конец строки перед проигрышем
  const pause = toTtml({ title: 'x', artist: 'y', plain: 'Раз\nДва', synced: '[00:10.00] Раз\n[00:15.00]\n[00:45.00] Два' });
  assert.match(pause, /<p begin="00:00:10.000" end="00:00:15.000">Раз<\/p>/);
  assert.equal(toTtml({ title: 'x', artist: 'y', plain: 'a', synced: '' }), null, 'без синхронизации TTML не собрать');

  const t = await setup();
  try {
    const owner = await t.user('Takko');
    const author = await t.user('Автор');
    const sub = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Песня', artist: 'Группа', duration: 30 }, plain: 'Раз\nДва\n\nТри', synced: '[00:01.00] Раз\n[00:02.50] Два\n[00:10.00] Три', structure: [{ from: 2, type: 'chorus' }] } });
    await t.call('POST', `/api/review/${sub.json.id}`, { token: owner.token, body: { action: 'accept' } });
    const r = await t.call('GET', `/api/get/${sub.json.trackId}/ttml`);
    assert.equal(r.status, 200);
    assert.match(r.text, /^<\?xml/);
    assert.match(r.text, /itunes:songPart="Chorus"/);

    // импорт релиза
    const rel = { release: { title: 'Дебютный EP', upc: '0123456789012' }, tracks: [
      { title: 'Первый', artist: 'Лейбл Бэнд', duration: 180, isrc: 'RU-A12-26-00001' },
      { title: 'Второй', artist: 'Лейбл Бэнд', duration: 200, isrc: 'RUA122600002' },
      { title: 'Без кода', artist: 'Лейбл Бэнд', duration: 100 }
    ] };
    assert.equal((await t.call('POST', '/api/admin/import-release', { token: author.token, body: rel })).status, 403);
    const imp = (await t.call('POST', '/api/admin/import-release', { token: owner.token, body: rel })).json.items;
    assert.deepEqual(imp.map((x) => x.status), ['created', 'created', 'error']);
    const tr = (await t.call('GET', `/api/track/${imp[0].id}`)).json;
    assert.equal(tr.isrc, 'RUA122600001');
    assert.equal(tr.album, 'Дебютный EP');
    assert.equal(tr.published, null);
    assert.deepEqual((await t.call('POST', '/api/admin/import-release', { token: owner.token, body: rel })).json.items.map((x) => x.status), ['exists', 'exists', 'error'], 'повторный импорт ничего не дублирует');
    // мусор в списке треков не роняет импорт, а длинный «ISRC» обрезается в ответе
    const junk = (await t.call('POST', '/api/admin/import-release', { token: owner.token, body: { tracks: [null, 1, { title: 'x', isrc: 'Z'.repeat(5000) }] } })).json.items;
    assert.deepEqual(junk.map((x) => x.status), ['error', 'error', 'error']);
    assert.ok(junk[2].isrc.length <= 20);
    assert.equal((await t.call('POST', '/api/admin/import-release', { token: owner.token, body: { tracks: Array.from({ length: 201 }, () => ({})) } })).status, 413);
    // трек уже заведён без ISRC — импорт привязывает код к нему, а не создаёт второй
    const manual = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Третий', artist: 'Лейбл Бэнд, Гость', duration: 150 }, plain: 'Текст третьего' } });
    const linked = (await t.call('POST', '/api/admin/import-release', { token: owner.token, body: { tracks: [{ title: 'Третий', artist: 'Лейбл Бэнд', duration: 151, isrc: 'RUA122600003' }] } })).json.items[0];
    assert.equal(linked.status, 'exists');
    assert.equal(linked.id, manual.json.trackId);
    assert.equal((await t.call('GET', `/api/track/${manual.json.trackId}`)).json.isrc, 'RUA122600003');
    // текст к импортированному треку — обычной отправкой; находится по ISRC
    const s2 = await t.call('POST', '/api/submit', { token: author.token, body: { trackId: imp[0].id, plain: 'Текст первого' } });
    await t.call('POST', `/api/review/${s2.json.id}`, { token: owner.token, body: { action: 'accept' } });
    assert.equal((await t.call('GET', '/api/get?track_name=First&artist_name=Label%20Band&isrc=RUA122600001')).json.plainLyrics, 'Текст первого');
  } finally {
    t.close();
  }
});

test('LRC: сжатые строки с несколькими метками и имя файла для скачивания', async () => {
  const { parseLrc } = await import('../src/lyrics.js');
  const { contentDisposition } = await import('../src/app.js');
  assert.deepEqual(parseLrc('[00:10.00][00:30.00] Припев\n[00:20.00] Куплет').map((l) => [l.at, l.text]), [[10000, 'Припев'], [20000, 'Куплет'], [30000, 'Припев']]);
  const cd = contentDisposition("Don't Stop (Live) — Фролов.ttml");
  assert.match(cd, /^attachment; filename="Don't Stop \(Live\)  .ttml"|^attachment; filename="[^"]+"; filename\*=UTF-8''/);
  assert.match(cd, /filename\*=UTF-8''Don%27t%20Stop%20%28Live%29/);
  assert.doesNotMatch(cd.split("UTF-8''")[1], /['()!*]/);
});

test('жалобы правообладателя: автоскрытие с лимитом, возвращённый админом трек сам не скрывается', async () => {
  const t = await setup();
  try {
    const owner = await t.user('Takko');
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const s = await t.call('POST', '/api/submit', { token: owner.token, body: { track: { title: `Трек ${i}`, artist: 'Группа', duration: 100 + i }, plain: 'Текст' } });
      await t.call('POST', `/api/review/${s.json.id}`, { token: owner.token, body: { action: 'accept' } });
      ids.push(s.json.trackId);
    }
    const report = (id) => t.call('POST', '/api/report', { body: { trackId: id, kind: 'copyright', name: 'X', contact: 'x@x', details: 'моё' } });
    const hidden = [];
    for (const id of ids.slice(0, 4)) hidden.push((await report(id)).json.hidden);
    assert.deepEqual(hidden, [true, true, true, false], 'с одного адреса — не больше 3 автоскрытий в сутки');
    assert.equal((await t.call('GET', `/api/get/${ids[3]}`)).status, 200, 'четвёртый трек остался, жалоба ждёт админа');
    // админ вернул трек — повторная жалоба его сама уже не скрывает
    const rep = (await t.call('GET', '/api/admin/reports', { token: owner.token })).json.items.find((r) => r.track.id === ids[0]);
    await t.call('POST', `/api/admin/reports/${rep.id}`, { token: owner.token, body: { action: 'restore' } });
    assert.equal((await t.call('GET', `/api/get/${ids[0]}`)).status, 200);
  } finally {
    t.close();
  }
});

test('пословное время: разбор, проверка, TTML', () => {
  const synced = '[00:10.00] Первая строка\n[00:14.50] Вторая\n[00:18.00]\n[00:20.20] Третья тут';
  const words = '[00:10.00] <00:10.00>Первая <00:10.60>строка <00:11.90>\n[00:14.50] Вторая\n[00:18.00]\n[00:20.20] <00:20.20>Третья <00:20.9>тут';
  const p = parseWords(words);
  assert.equal(p.length, 4);
  assert.deepEqual(p[0].words, [{ at: 10000, text: 'Первая' }, { at: 10600, text: 'строка' }]);
  assert.equal(p[0].end, 11900);
  assert.equal(p[1].words, null, 'строка без угловых меток — слова не размечены');
  // чистый вид: время слов до сотых, неразмеченные строки как в synced
  assert.equal(checkWords(words, synced, 60), '[00:10.00] <00:10.00>Первая <00:10.60>строка <00:11.90>\n[00:14.50] Вторая\n[00:18.00]\n[00:20.20] <00:20.20>Третья <00:20.90>тут');
  assert.equal(checkWords('[00:10.00] Первая строка\n[00:14.50] Вторая\n[00:18.00]\n[00:20.20] Третья тут', synced), '', 'ни одного размеченного слова — пусто');
  assert.equal(checkWords('', synced), '');
  assert.throws(() => checkWords(words, ''), /без синхронизации строк/);
  assert.throws(() => checkWords('[00:10.00] <00:10.00>Первая', synced), /строк/);
  assert.throws(() => checkWords(words.replace('Вторая\n', 'Другая\n'), synced), /строка 2/);
  assert.throws(() => checkWords(words.replace('[00:14.50] Вторая', '[00:14.40] Вторая'), synced), /время строки/);
  assert.throws(() => checkWords(words.replace('<00:10.60>строка', '<00:09.00>строка'), synced), /раньше предыдущего|вне своей строки/);
  assert.throws(() => checkWords(words.replace('<00:20.9>тут', '<00:59.00>тут'), synced, 30), /вне своей строки/);
  assert.throws(() => checkWords('[00:10.00] Первая <00:10.60>строка\n[00:14.50] Вторая\n[00:18.00]\n[00:20.20] Третья тут', synced), /нет времени/);
  // в автопроверке: инструментал — без слов, слова без синхронизации — ошибка
  assert.equal(checkLyrics({ synced, words, duration: 60 }).words.split('\n').length, 4);
  assert.throws(() => checkLyrics({ plain: 'а', words: '[00:01.00] <00:01.00>а' }), /без синхронизации/);
  // TTML: размеченные строки — по словам, остальные — целиком
  const xml = toTtml({ title: 't', artist: 'a', duration: 60, plain: 'Первая строка\nВторая\nТретья тут', synced, words: checkWords(words, synced, 60) });
  assert.match(xml, /itunes:timing="Word"/);
  assert.match(xml, /<p begin="00:00:10.000" end="00:00:14.500"><span begin="00:00:10.000" end="00:00:10.600">Первая<\/span> <span begin="00:00:10.600" end="00:00:11.900">строка<\/span><\/p>/);
  assert.match(xml, /<p begin="00:00:14.500" end="00:00:18.000">Вторая<\/p>/);
  assert.match(xml, /<span begin="00:00:20.900" end="00:01:00.000">тут<\/span>/);
  assert.match(toTtml({ title: 't', artist: 'a', plain: 'Первая строка\nВторая\nТретья тут', synced }), /itunes:timing="Line"/);
});

test('пословное время: отправка, проверка, API', async () => {
  const t = await setup();
  try {
    const owner = await t.user('Takko');
    const author = await t.user('Автор');
    const synced = '[00:01.00] Раз два\n[00:05.00] Три';
    const words = '[00:01.00] <00:01.00>Раз <00:01.80>два\n[00:05.00] Три';
    const bad = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Слова', artist: 'Группа', duration: 30 }, synced, words: words.replace('<00:01.80>', '<00:00.10>') } });
    assert.equal(bad.status, 422);
    const sub = await t.call('POST', '/api/submit', { token: author.token, body: { track: { title: 'Слова', artist: 'Группа', duration: 30 }, synced, words } });
    assert.equal(sub.status, 200);
    const item = await t.call('GET', `/api/review/${sub.json.id}`, { token: owner.token });
    assert.equal(item.json.words, words);
    assert.equal((await t.call('GET', '/api/review', { token: owner.token })).json.items[0].words, true);
    await t.call('POST', `/api/review/${sub.json.id}`, { token: owner.token, body: { action: 'accept' } });
    const got = await t.call('GET', `/api/get/${sub.json.trackId}`);
    assert.equal(got.json.wordSyncedLyrics, words);
    assert.equal(got.json.syncedLyrics, synced, 'обычный LRC без угловых меток — клиенты LRCLIB не ломаются');
    assert.equal((await t.call('GET', `/api/track/${sub.json.trackId}`)).json.published.words, words);
    assert.match((await t.call('GET', `/api/get/${sub.json.trackId}/ttml`)).text, /<span begin="00:00:01.000" end="00:00:01.800">Раз<\/span>/);
    // правка только пословного времени — тоже правка; тот же текст — 409
    assert.equal((await t.call('POST', '/api/submit', { token: author.token, body: { trackId: sub.json.trackId, synced, words } })).status, 409);
    assert.equal((await t.call('POST', '/api/submit', { token: author.token, body: { trackId: sub.json.trackId, synced, words: words.replace('01.80', '01.90') } })).status, 200);
  } finally {
    t.close();
  }
});
