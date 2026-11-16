// Каталог дополнений: Автоматор загружает папку дополнения, модератор публикует, отмечает «проверено Nyao» или отзывает.
// Приложение берёт список, скачивает пакет и сверяет sha256; отозванные дополнения у себя выключает и удаляет.
// Пакет — JSON { files: { "путь": base64 } } с manifest.json внутри; манифест проверяется теми же правилами, что в приложении
// (addon-manifest.js — копия src/main/addons/manifest.js, совпадение проверяет тест приложения).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from './addon-manifest.js';

export const MAX_ADDON = 384 * 1024;
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const EXT = /\.(js|json|css|svg|png|html|txt|md)$/i;
const STATUSES = ['pending', 'published', 'revoked'];
const CHANNELS = ['nightly', 'dev', 'stable'];
const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Разобрать и проверить пакет. → { manifest, files: Map(path → Buffer), canonical, sha256, size } */
export function readBundle(bundle, HttpError) {
  const raw = bundle && typeof bundle === 'object' && bundle.files && typeof bundle.files === 'object' ? bundle.files : null;
  if (!raw) throw new HttpError(400, 'Нет файлов дополнения');
  const files = new Map();
  let size = 0;
  for (const [p, b64] of Object.entries(raw)) {
    if (!FILE.test(p) || p.length > 120 || !EXT.test(p)) throw new HttpError(400, `Недопустимое имя файла: ${String(p).slice(0, 80)}`);
    const buf = Buffer.from(String(b64 || ''), 'base64');
    size += buf.length;
    if (size > MAX_ADDON) throw new HttpError(413, `Дополнение больше ${Math.round(MAX_ADDON / 1024)} КБ`);
    files.set(p, buf);
  }
  if (files.size > 40) throw new HttpError(400, 'Слишком много файлов (больше 40)');
  if (!files.has('manifest.json')) throw new HttpError(400, 'В корне нет manifest.json');
  let parsed;
  try {
    parsed = JSON.parse(files.get('manifest.json').toString('utf8'));
  } catch {
    throw new HttpError(400, 'manifest.json — не JSON');
  }
  const v = validateManifest(parsed);
  if (!v.ok) throw new HttpError(400, `Манифест: ${v.error}`);
  const m = v.manifest;
  if (m.native || m.id.startsWith('nyao.')) throw new HttpError(400, 'id «nyao.…» и native — только для встроенных дополнений');
  if (!files.has(m.main)) throw new HttpError(400, `Нет главного файла ${m.main}`);
  const sorted = [...files.keys()].sort();
  const canonical = JSON.stringify({ files: Object.fromEntries(sorted.map((p) => [p, files.get(p).toString('base64')])) });
  const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
  return { manifest: m, files, canonical, sha256, size };
}

function rowOut(r) {
  return {
    id: r.id,
    name: r.name,
    author: r.author,
    version: r.version,
    description: r.description,
    permissions: csv(r.permissions),
    status: r.status,
    verified: !!r.verified,
    channels: csv(r.channels),
    note: r.note || '',
    sha256: r.sha256,
    size: Number(r.size) || 0,
    installs: Number(r.installs) || 0,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime()
  };
}

export function addonStore(dataDir) {
  const dir = path.join(dataDir, 'addons');
  return {
    file: (sha) => (/^[0-9a-f]{64}$/.test(sha) ? path.join(dir, `${sha}.json`) : null),
    write(sha, body) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${sha}.json`), body);
    },
    remove(sha) {
      const p = this.file(sha);
      if (p) fs.rmSync(p, { force: true });
    }
  };
}

export function addonsAdminRoutes({ q, HttpError, readJson, clip, guard, dataDir = '/data' }) {
  const store = addonStore(dataDir);
  return [
    ['GET', /^\/admin\/addons$/, guard('addons.read', async () => {
      const { rows } = await q('SELECT * FROM addons_catalog ORDER BY updated_at DESC');
      return { items: rows.map(rowOut), maxBytes: MAX_ADDON };
    }), true],

    // новая версия (или новое дополнение) всегда идёт на проверку — даже если прошлая была опубликована
    ['POST', /^\/admin\/addons$/, guard('addons.write', async ({ req, s, a }) => {
      const b = await readJson(req);
      const pkg = readBundle(b.bundle, HttpError);
      const m = pkg.manifest;
      const { rows: old } = await q('SELECT sha256 FROM addons_catalog WHERE id = $1', [m.id]);
      store.write(pkg.sha256, pkg.canonical);
      const { rows } = await q(
        `INSERT INTO addons_catalog (id, name, author, version, description, permissions, status, verified, sha256, size, by_user)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', false, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET name = $2, author = $3, version = $4, description = $5, permissions = $6, status = 'pending', verified = false, sha256 = $7, size = $8, by_user = $9, updated_at = now()
         RETURNING *`,
        [m.id, m.name, m.author, m.version, m.description, m.permissions.join(','), pkg.sha256, pkg.size, s.uid]
      );
      if (old.length && old[0].sha256 !== pkg.sha256) store.remove(old[0].sha256);
      await a.audit('addon.upload', { type: 'addon', id: m.id, params: { version: m.version, sha256: pkg.sha256, permissions: m.permissions } });
      return rowOut(rows[0]);
    }, { write: true }), true],

    ['PUT', /^\/admin\/addons\/([a-z0-9.-]+)$/, guard('addons.write', async ({ m: mm, req, a }) => {
      const b = await readJson(req);
      const { rows: cur } = await q('SELECT * FROM addons_catalog WHERE id = $1', [mm[1]]);
      if (!cur.length) throw new HttpError(404, 'Нет такого дополнения');
      const status = STATUSES.includes(b.status) ? b.status : cur[0].status;
      const verified = status === 'published' ? !!b.verified : false;
      const channels = (Array.isArray(b.channels) ? b.channels : csv(cur[0].channels)).filter((c) => CHANNELS.includes(c));
      const note = clip(String(b.note ?? cur[0].note ?? '').trim(), 300);
      if (status === 'revoked' && !note) throw new HttpError(400, 'Напиши причину отзыва — её увидят пользователи');
      const { rows } = await q(
        'UPDATE addons_catalog SET status = $2, verified = $3, channels = $4, note = $5, updated_at = now() WHERE id = $1 RETURNING *',
        [mm[1], status, verified, (channels.length ? channels : ['nightly']).join(','), note]
      );
      await a.audit(status === cur[0].status ? 'addon.edit' : `addon.${status}`, { type: 'addon', id: mm[1], params: { status, verified, channels, version: cur[0].version } });
      return rowOut(rows[0]);
    }, { write: true }), true],

    ['DELETE', /^\/admin\/addons\/([a-z0-9.-]+)$/, guard('addons.write', async ({ m: mm, a }) => {
      const { rows } = await q('DELETE FROM addons_catalog WHERE id = $1 RETURNING sha256, version', [mm[1]]);
      if (!rows.length) throw new HttpError(404, 'Нет такого дополнения');
      store.remove(rows[0].sha256);
      await a.audit('addon.delete', { type: 'addon', id: mm[1], params: { version: rows[0].version } });
      return { ok: true };
    }, { write: true }), true],

    // пакет для просмотра кода модератором
    ['GET', /^\/admin\/addons\/([a-z0-9.-]+)\/bundle$/, guard('addons.read', async ({ m: mm }) => {
      const { rows } = await q('SELECT sha256 FROM addons_catalog WHERE id = $1', [mm[1]]);
      const p = rows.length && store.file(rows[0].sha256);
      if (!p || !fs.existsSync(p)) throw new HttpError(404, 'Пакета нет');
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }), true]
  ];
}

export function addonsPublicRoutes({ q, HttpError, dataDir = '/data' }) {
  const store = addonStore(dataDir);
  const channelOf = (url) => (CHANNELS.includes(url.searchParams.get('channel')) ? url.searchParams.get('channel') : 'stable');
  return [
    ['GET', /^\/addons\/catalog$/, async ({ url }) => {
      const channel = channelOf(url);
      const { rows } = await q("SELECT * FROM addons_catalog WHERE status IN ('published', 'revoked') ORDER BY verified DESC, installs DESC, name");
      const items = rows.filter((r) => r.status === 'published' && csv(r.channels).includes(channel)).map((r) => {
        const o = rowOut(r);
        return { id: o.id, name: o.name, author: o.author, version: o.version, description: o.description, permissions: o.permissions, verified: o.verified, sha256: o.sha256, size: o.size, installs: o.installs, updatedAt: o.updatedAt };
      });
      const revoked = rows.filter((r) => r.status === 'revoked').map((r) => ({ id: r.id, reason: r.note || '' }));
      return { items, revoked };
    }],
    ['GET', /^\/addons\/bundle\/([a-z0-9.-]+)$/, async ({ m, url }) => {
      const { rows } = await q("SELECT * FROM addons_catalog WHERE id = $1 AND status = 'published'", [m[1]]);
      if (!rows.length || !csv(rows[0].channels).includes(channelOf(url))) throw new HttpError(404, 'Нет такого дополнения в каталоге');
      const p = store.file(rows[0].sha256);
      if (!p || !fs.existsSync(p)) throw new HttpError(404, 'Пакета нет');
      q('UPDATE addons_catalog SET installs = installs + 1 WHERE id = $1', [m[1]]).catch(() => {});
      return { __raw: { type: 'application/json; charset=utf-8', body: fs.readFileSync(p), cache: 'no-store' } };
    }]
  ];
}
