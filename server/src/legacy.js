// Вход Nyao Legacy (Android 4.x) по коду — без браузера и Telegram на старом устройстве.
//
// 1. Legacy создаёт пару ключей и шлёт открытый ключ: POST /legacy/pair → { id, secret, code }.
// 2. В основном Nyao вводят код: GET /legacy/pair/code/:code (открытый ключ устройства), затем
//    POST /legacy/pair/code/:code с пакетом, зашифрованным ключом устройства (токены Яндекса/YouTube).
//    Сервер расшифровать пакет не может; заводит устройству сессию Nyao того, кто подтвердил.
// 3. Legacy опрашивает GET /legacy/pair/:id?secret=… и один раз получает сессию и пакет.
// Всё живёт в памяти 10 минут; после выдачи — удаляется.
import crypto from 'node:crypto';

export const PAIR_TTL = 10 * 60 * 1000;
// без похожих символов (0/O, 1/I/L)
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const KEY_RE = /^[A-Za-z0-9+/]{200,1200}={0,2}$/; // SPKI RSA-2048..4096 в base64
const PAYLOAD_MAX = 64 * 1024;

export function newCode() {
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** «k7q 4md» / «K7Q-4MD» → «K7Q4MD» */
export function normCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function legacyRoutes({ HttpError, readJson, clip, limiter, createSession }) {
  const pairs = new Map(); // id → { secret, code, publicKey, device, at, status, token, user, payload }
  const byCode = new Map(); // code → id
  const startLimit = limiter(10);
  const pollLimit = limiter(120);
  const codeLimit = limiter(20);

  const gc = setInterval(() => {
    const now = Date.now();
    for (const [id, p] of pairs) if (now - p.at > PAIR_TTL) drop(id);
  }, 60_000);
  gc.unref();

  function drop(id) {
    const p = pairs.get(id);
    if (p) byCode.delete(p.code);
    pairs.delete(id);
  }

  function live(code) {
    const id = byCode.get(normCode(code));
    const p = id && pairs.get(id);
    if (!p || Date.now() - p.at > PAIR_TTL) throw new HttpError(404, 'Код не найден или устарел — на устройстве нажми «Новый код»');
    return { id, p };
  }

  return [
    ['POST', /^\/legacy\/pair$/, async ({ req, ip }) => {
      startLimit(ip);
      const body = await readJson(req);
      const publicKey = String(body.publicKey || '').replace(/\s+/g, '');
      if (!KEY_RE.test(publicKey)) throw new HttpError(400, 'Нужен открытый ключ устройства');
      try {
        const k = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
        if (k.asymmetricKeyType !== 'rsa' || k.asymmetricKeyDetails.modulusLength < 2048) throw new Error('weak');
      } catch {
        throw new HttpError(400, 'Открытый ключ не разобрать (нужен RSA от 2048 бит)');
      }
      let code;
      do code = newCode(); while (byCode.has(code));
      const id = crypto.randomBytes(18).toString('base64url');
      const secret = crypto.randomBytes(24).toString('base64url');
      pairs.set(id, { secret, code, publicKey, device: clip(body.device, 64) || 'Устройство на Android 4', at: Date.now(), status: 'pending' });
      byCode.set(code, id);
      return { id, secret, code, expiresIn: PAIR_TTL / 1000 };
    }],

    ['GET', /^\/legacy\/pair\/code\/([A-Za-z0-9-]{4,12})$/, async ({ m, s }) => {
      codeLimit(s.uid);
      const { p } = live(m[1]);
      if (p.status !== 'pending') throw new HttpError(409, 'Это устройство уже подключено');
      return { device: p.device, publicKey: p.publicKey, expiresIn: Math.max(0, Math.round((PAIR_TTL - (Date.now() - p.at)) / 1000)) };
    }, true],

    ['POST', /^\/legacy\/pair\/code\/([A-Za-z0-9-]{4,12})$/, async ({ req, m, s }) => {
      codeLimit(s.uid);
      const { p } = live(m[1]);
      if (p.status !== 'pending') throw new HttpError(409, 'Это устройство уже подключено');
      const body = await readJson(req);
      const payload = String(body.payload || '');
      if (!payload || payload.length > PAYLOAD_MAX || !/^[A-Za-z0-9+/=._-]+$/.test(payload)) throw new HttpError(400, 'Нужен зашифрованный пакет');
      const token = await createSession(s.uid, p.device, 'legacy');
      Object.assign(p, { status: 'done', token, user: s.user, payload });
      return { ok: true, device: p.device };
    }, true],

    ['GET', /^\/legacy\/pair\/([A-Za-z0-9_-]{16,64})$/, async ({ m, url, ip }) => {
      pollLimit(ip);
      const p = pairs.get(m[1]);
      const secret = url.searchParams.get('secret') || '';
      if (!p || Date.now() - p.at > PAIR_TTL) throw new HttpError(410, 'Код устарел — нажми «Новый код»');
      const a = Buffer.from(secret);
      const b = Buffer.from(p.secret);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Не тот секрет');
      if (p.status !== 'done') return { status: 'pending', code: p.code };
      drop(m[1]);
      return { status: 'done', token: p.token, user: p.user, payload: p.payload };
    }]
  ];
}
