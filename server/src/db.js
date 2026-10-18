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
  )`
];

export async function migrate(pool) {
  for (const sql of SCHEMA) await pool.query(sql);
}

export function createPool(url) {
  return new pg.Pool({ connectionString: url, max: 10 });
}
