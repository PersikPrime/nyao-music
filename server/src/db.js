// База Postgres. Токены сервисов (Яндекс, YouTube, SoundCloud) сюда НЕ попадают никогда —
// только аккаунт Telegram, устройства, история прослушиваний и синхронизируемые настройки.
import pg from 'pg';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    tg_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    username TEXT,
    picture TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    device TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS plays (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id BIGINT,
    track_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    cover TEXT,
    duration INTEGER NOT NULL DEFAULT 0,
    listened INTEGER NOT NULL DEFAULT 0,
    skipped BOOLEAN NOT NULL DEFAULT false,
    played_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS plays_user_time ON plays (user_id, played_at)`,
  `CREATE TABLE IF NOT EXISTS state (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS now_playing (
    session_id BIGINT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // ---------- Мини-соцсеть: профили, друзья, приглашения, входящие ----------
  // ник храним и как ввели, и в нижнем регистре (уникальность без учёта регистра)
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nick TEXT NOT NULL,
    nick_lc TEXT UNIQUE NOT NULL,
    nick_set BOOLEAN NOT NULL DEFAULT false,
    bio TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'friends',
    show_now BOOLEAN NOT NULL DEFAULT true,
    show_stats BOOLEAN NOT NULL DEFAULT true,
    show_likes BOOLEAN NOT NULL DEFAULT false,
    invisible BOOLEAN NOT NULL DEFAULT false,
    status_track JSONB,
    pinned JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // пара хранится один раз: a < b. status: pending (заявка от requester) | friends
  `CREATE TABLE IF NOT EXISTS friendships (
    a BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    requester BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (a, b)
  )`,
  `CREATE TABLE IF NOT EXISTS blocks (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, blocked_id)
  )`,
  // приглашение по ссылке, QR или касанием телефонов: кто открыл — сразу в друзьях
  `CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  // входящие: присланные треки, приглашения в комнату, реакции, заявки
  `CREATE TABLE IF NOT EXISTS inbox (
    id BIGSERIAL PRIMARY KEY,
    to_user BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_user BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS inbox_to_time ON inbox (to_user, created_at)`,
  // 0.8.x: можно ли друзьям совпадение вкусов и «микс на двоих» с тобой
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS allow_duo BOOLEAN NOT NULL DEFAULT true`,
  // токены push (Firebase) на устройство — для уведомлений, когда приложение закрыто
  `CREATE TABLE IF NOT EXISTS push_tokens (
    session_id BIGINT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // ---------- Тексты песен (lyrics.withnyao.app): пишут пользователи, проверяют специалисты ----------
  `CREATE TABLE IF NOT EXISTS lyrics_tracks (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0,
    title_norm TEXT NOT NULL,
    artist_norm TEXT NOT NULL,
    published_version BIGINT,
    hidden BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS lyrics_tracks_norm ON lyrics_tracks (artist_norm, title_norm)`,
  // версии текста: pending (ждёт проверки) → published / returned (на доработку) / rejected
  `CREATE TABLE IF NOT EXISTS lyrics_versions (
    id BIGSERIAL PRIMARY KEY,
    track_id BIGINT NOT NULL REFERENCES lyrics_tracks(id) ON DELETE CASCADE,
    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    plain TEXT NOT NULL DEFAULT '',
    synced TEXT NOT NULL DEFAULT '',
    instrumental BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS lyrics_versions_status ON lyrics_versions (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS lyrics_versions_author ON lyrics_versions (author_id, created_at)`,
  // роли: specialist (проверяет), admin (назначает, разбирает жалобы)
  `CREATE TABLE IF NOT EXISTS lyrics_roles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // жалобы: copyright (правообладатель — трек скрывается сразу) и wrong (ошибка в тексте)
  `CREATE TABLE IF NOT EXISTS lyrics_reports (
    id BIGSERIAL PRIMARY KEY,
    track_id BIGINT NOT NULL REFERENCES lyrics_tracks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  )`,
  // трек из каталога Яндекса: точная привязка (одинаковые названия у разных записей не путаются) и обложка
  `ALTER TABLE lyrics_tracks ADD COLUMN IF NOT EXISTS ya_id TEXT`,
  `ALTER TABLE lyrics_tracks ADD COLUMN IF NOT EXISTS cover TEXT`,
  `CREATE INDEX IF NOT EXISTS lyrics_tracks_ya ON lyrics_tracks (ya_id)`,
  // структура песни: [{ from: номер строки текста, type: 'verse' | 'chorus' | … }] в JSON
  `ALTER TABLE lyrics_versions ADD COLUMN IF NOT EXISTS structure TEXT NOT NULL DEFAULT ''`,
  // ISRC — код записи, одинаковый во всех сервисах: точное совпадение без сравнения названий
  `ALTER TABLE lyrics_tracks ADD COLUMN IF NOT EXISTS isrc TEXT`,
  `CREATE INDEX IF NOT EXISTS lyrics_tracks_isrc ON lyrics_tracks (isrc)`,
  // жалобы: скрыл ли трек сам сервер и с какого адреса (хэш) — чтобы ограничить автоскрытие
  `ALTER TABLE lyrics_reports ADD COLUMN IF NOT EXISTS auto_hidden BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE lyrics_reports ADD COLUMN IF NOT EXISTS ip_hash TEXT NOT NULL DEFAULT ''`,
  // пословное время (Enhanced LRC: «[00:12.30] <00:12.30>слово <00:12.80>слово <00:13.40>»), строки — как в synced
  `ALTER TABLE lyrics_versions ADD COLUMN IF NOT EXISTS words TEXT NOT NULL DEFAULT ''`,
  // ---------- Nyao Automator: администрирование ----------
  // номер сборки клиента на сессии — для отбора «версия ниже N» и распределения версий
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS build INTEGER`,
  // журнал действий админов: кто, что, над кем, с какими параметрами (без секретов). Из клиента не меняется
  `CREATE TABLE IF NOT EXISTS admin_audit (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    admin_tg TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    params JSONB,
    result TEXT NOT NULL DEFAULT 'ok',
    ip TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS admin_audit_time ON admin_audit (at)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit (target_type, target_id)`,
  // блокировки: заблокированный не входит, его сессии завершаются
  `CREATE TABLE IF NOT EXISTS user_bans (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT '',
    by_user BIGINT REFERENCES users(id) ON DELETE SET NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // настройки сервера, которые меняются из Automator (минимальная сборка, префикс ISRC…)
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // история статуса (техработы, сбои) и расписание включения
  `CREATE TABLE IF NOT EXISTS status_history (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    by_user BIGINT REFERENCES users(id) ON DELETE SET NULL,
    data JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS status_schedule (
    id BIGSERIAL PRIMARY KEY,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    maintenance JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'planned',
    by_user BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // рассылки push: кому отправляли и что вышло
  `CREATE TABLE IF NOT EXISTS push_broadcasts (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    by_user BIGINT REFERENCES users(id) ON DELETE SET NULL,
    audience JSONB NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0
  )`,
  // LyricLabs: кому поручена проверка версии
  `ALTER TABLE lyrics_versions ADD COLUMN IF NOT EXISTS assignee_id BIGINT`,
  // ---------- Лейбл WithNyao Blue: ISRC и релизы ----------
  `CREATE TABLE IF NOT EXISTS label_releases (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    artists TEXT NOT NULL DEFAULT '',
    upc TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '',
    release_date TEXT NOT NULL DEFAULT '',
    p_line TEXT NOT NULL DEFAULT '',
    c_line TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'preparing',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS label_tracks (
    id BIGSERIAL PRIMARY KEY,
    release_id BIGINT NOT NULL REFERENCES label_releases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    artists TEXT NOT NULL DEFAULT '',
    isrc TEXT,
    duration INTEGER NOT NULL DEFAULT 0
  )`,
  // код уникален на уровне базы: два админа одновременно не получат один ISRC
  `CREATE TABLE IF NOT EXISTS label_isrc (
    code TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    track_title TEXT NOT NULL DEFAULT '',
    track_id BIGINT,
    by_user BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // профиль 0.100: цвет, форма аватара, баннер, ссылки на соцсети
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS color TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_shape TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS links JSONB`,
  // что проверить модератору в Automator (баннеры и ссылки показываются сразу, модерация — после)
  `CREATE TABLE IF NOT EXISTS profile_moderation (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by BIGINT,
    reason TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS profile_moderation_status ON profile_moderation (status, created_at)`
];

export async function migrate(pool) {
  for (const sql of SCHEMA) await pool.query(sql);
}

export function createPool(url) {
  return new pg.Pool({ connectionString: url, max: 10 });
}
