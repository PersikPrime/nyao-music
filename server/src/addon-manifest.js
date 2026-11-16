// Дополнения Nyao Music: манифест и права. Чистые функции — без Electron, их проверяют тесты.
//
// Дополнение — папка с manifest.json и одним файлом JS. Работает в песочнице (см. host.js) и получает
// только то, что перечислило в permissions и что разрешил человек. Права на входы в сервисы не существует.

export const API_VERSION = 1;

/** Все права, которые можно попросить. net — «уходит в сеть», остальное остаётся на устройстве */
export const PERMISSIONS = {
  track: { title: 'Что играет', hint: 'трек, исполнитель, обложка, позиция' },
  control: { title: 'Управление плеером', hint: 'пауза, дальше, громкость, лайк' },
  lyrics: { title: 'Текст песни', hint: 'строки с таймингом' },
  history: { title: 'История прослушиваний', hint: 'только с этого компьютера' },
  'ui.trackMenu': { title: 'Пункт в меню трека', hint: 'своя строка в меню «⋯»' },
  'ui.toast': { title: 'Уведомления', hint: 'короткие сообщения с подписью дополнения' },
  page: { title: 'Локальный адрес', hint: '127.0.0.1 — с других устройств не видно' },
};

const ID = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

/** Право → { key, net, title, hint } или null, если такого права нет */
export function describePermission(p) {
  const s = String(p || '');
  if (s.startsWith('net:')) {
    const host = s.slice(4).toLowerCase();
    return HOST.test(host) ? { key: `net:${host}`, net: true, title: host, hint: 'сюда дополнение может отправлять данные' } : null;
  }
  return PERMISSIONS[s] ? { key: s, net: false, ...PERMISSIONS[s] } : null;
}

/**
 * Проверка манифеста. Возвращает { ok, manifest } или { ok: false, error } — текст ошибки для человека.
 * Неизвестное право — ошибка, а не предупреждение: иначе дополнение, написанное под новую версию, молча работало бы криво.
 */
export function validateManifest(raw) {
  const m = raw && typeof raw === 'object' ? raw : null;
  if (!m) return { ok: false, error: 'manifest.json не читается' };
  const id = String(m.id || '');
  if (!ID.test(id) || id.length > 64) return { ok: false, error: 'id должен быть вида «автор.название» латиницей' };
  const name = String(m.name || '').trim();
  if (!name || name.length > 40) return { ok: false, error: 'нужно название (name) до 40 символов' };
  const version = String(m.version || '');
  if (!/^\d+(\.\d+){0,2}$/.test(version)) return { ok: false, error: 'версия (version) — числа через точку, например 1.0.0' };
  const api = Number(m.nyao);
  if (!Number.isInteger(api) || api < 1) return { ok: false, error: 'нужна версия API: "nyao": 1' };
  if (api > API_VERSION) return { ok: false, error: `дополнению нужна более новая Nyao Music (API ${api}, здесь ${API_VERSION})` };
  const native = m.native ? String(m.native) : '';
  const main = String(m.main || (native ? '' : 'addon.js'));
  if (!native && !FILE.test(main)) return { ok: false, error: 'main — имя файла внутри папки дополнения' };
  const perms = [];
  for (const p of Array.isArray(m.permissions) ? m.permissions : []) {
    const d = describePermission(p);
    if (!d) return { ok: false, error: `неизвестное право «${String(p).slice(0, 60)}»` };
    if (!perms.includes(d.key)) perms.push(d.key);
  }
  if (perms.length > 24) return { ok: false, error: 'слишком много прав' };
  const settings = [];
  for (const s of Array.isArray(m.settings) ? m.settings.slice(0, 12) : []) {
    const key = String((s && s.key) || '');
    if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(key)) return { ok: false, error: 'settings: key — латиницей, с маленькой буквы' };
    const type = s.type === 'toggle' ? 'toggle' : 'select';
    const options = type === 'select' ? (Array.isArray(s.options) ? s.options : []).slice(0, 8).map((o) => ({ value: String(o.value), label: String(o.label || o.value).slice(0, 30) })) : [];
    if (type === 'select' && options.length < 2) return { ok: false, error: `settings.${key}: нужно хотя бы два варианта` };
    settings.push({ key, type, label: String(s.label || key).slice(0, 60), options, default: type === 'toggle' ? !!s.default : options.some((o) => o.value === String(s.default)) ? String(s.default) : options[0].value });
  }
  const page = m.page ? String(m.page) : '';
  if (page && !FILE.test(page)) return { ok: false, error: 'page — путь к папке со страницей внутри дополнения' };
  if (page && !perms.includes('page')) return { ok: false, error: 'для page нужно право «page»' };
  return {
    ok: true,
    manifest: { id, name, version, api, main, native, permissions: perms, settings, page, author: String(m.author || '').slice(0, 40), description: String(m.description || '').slice(0, 200), icon: /^[a-z]{2,16}$/.test(m.icon || '') ? m.icon : 'puzzle', color: /^#[0-9a-fA-F]{6}$/.test(m.color || '') ? m.color : '#C6B8FF' },
  };
}

/** Права, которых ещё не разрешали (новая версия попросила больше) */
export function missingGrants(permissions, grants) {
  const have = new Set(grants || []);
  return (permissions || []).filter((p) => !have.has(p));
}

/** Можно ли дополнению с такими правами сходить по адресу: только https и только к перечисленным доменам (без поддоменов) */
export function netAllowed(permissions, url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return (permissions || []).includes(`net:${u.hostname.toLowerCase()}`);
}

/** Значения настроек дополнения: сохранённые поверх умолчаний, чужие ключи и значения не из списка отбрасываются */
export function settingValues(manifest, saved) {
  const out = {};
  for (const s of manifest.settings || []) {
    const v = saved ? saved[s.key] : undefined;
    out[s.key] = s.type === 'toggle' ? (typeof v === 'boolean' ? v : s.default) : s.options.some((o) => o.value === v) ? v : s.default;
  }
  return out;
}

/** Не чаще n раз за окно: уведомления, сеть */
export function rateLimiter(n, windowMs, now = Date.now) {
  const hits = [];
  return () => {
    const t = now();
    while (hits.length && t - hits[0] > windowMs) hits.shift();
    if (hits.length >= n) return false;
    hits.push(t);
    return true;
  };
}
