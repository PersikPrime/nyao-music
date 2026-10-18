// Живые события между устройствами: Nyao Connect (пульт для другого устройства) и «Слушать вместе».
// Без WebSocket: устройство держит «длинный» запрос /events (до 25 секунд), сервер отвечает сразу, как только
// для него что-то появилось. Работает через Cloudflare и любые прокси. Всё хранится в памяти —
// после перезапуска сервера устройства просто переподключаются.
import crypto from 'node:crypto';

const KEEP = 60; // сколько последних событий помнить на устройство
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REACTIONS = ['🔥', '❤️', '😂', '😮', '👏', '🎶'];

export class Hub {
  constructor({ waitMs = 25_000, onlineMs = 70_000, memberMs = 90_000, hostMs = 5 * 60_000, now = () => Date.now() } = {}) {
    this.waitMs = waitMs;
    this.onlineMs = onlineMs;
    this.memberMs = memberMs;
    this.hostMs = hostMs;
    this.now = now;
    this.boxes = new Map(); // sid → { uid, seq, events, waiters, seen }
    this.rooms = new Map(); // code → комната
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }

  close() {
    clearInterval(this.timer);
    for (const b of this.boxes.values()) for (const w of b.waiters) w();
  }

  box(sid, uid) {
    let b = this.boxes.get(sid);
    if (!b) {
      b = { uid, seq: 0, events: [], waiters: new Set(), seen: 0 };
      this.boxes.set(sid, b);
    }
    if (uid != null) b.uid = uid;
    return b;
  }

  /** Событие одному устройству */
  push(sid, event) {
    const b = this.box(sid);
    b.seq++;
    // id и at — служебные: событие не может их подменить (иначе ломается курсор опроса)
    b.events.push({ ...event, id: b.seq, at: this.now() });
    if (b.events.length > KEEP) b.events.splice(0, b.events.length - KEEP);
    for (const w of b.waiters) w();
  }

  /** Событие всем устройствам пользователя, которые сейчас на связи (кроме except) */
  pushUser(uid, event, except = null) {
    for (const [sid, b] of this.boxes) if (b.uid === uid && sid !== except && this.isOnline(sid)) this.push(sid, event);
  }

  isOnline(sid) {
    const b = this.boxes.get(sid);
    return !!b && (b.waiters.size > 0 || this.now() - b.seen < this.onlineMs);
  }

  /**
   * Ждёт событий для устройства. cursor — id последнего полученного события.
   * → { cursor, events }. Если сервер перезапускался (cursor больше, чем есть), начинаем заново.
   */
  async wait(sid, uid, cursor = 0, ms = this.waitMs) {
    const b = this.box(sid, uid);
    b.seen = this.now();
    if (cursor > b.seq) cursor = 0;
    let fresh = b.events.filter((e) => e.id > cursor);
    if (!fresh.length && ms > 0) {
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          b.waiters.delete(done);
          resolve();
        };
        const t = setTimeout(done, ms);
        b.waiters.add(done);
      });
      fresh = b.events.filter((e) => e.id > cursor);
    }
    b.seen = this.now();
    this.touchMember(sid);
    return { cursor: b.seq, events: fresh };
  }

  // ---------- «Слушать вместе» ----------

  newCode() {
    for (;;) {
      const bytes = crypto.randomBytes(6);
      const code = [...bytes].map((x) => CODE_ABC[x % CODE_ABC.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  roomOf(sid) {
    for (const r of this.rooms.values()) if (r.hostSid === sid || r.members.has(sid)) return r;
    return null;
  }

  snapshot(r) {
    return {
      code: r.code,
      host: { name: r.host.name, picture: r.host.picture || null, device: r.host.device },
      members: [...r.members.values()].map((m) => ({ name: m.name, picture: m.picture || null })),
      state: r.state ? { ...r.state, position: this.positionNow(r.state) } : null
    };
  }

  /** Позиция «сейчас» с учётом того, сколько прошло с последнего обновления хоста */
  positionNow(st) {
    if (!st) return 0;
    const p = st.position + (st.playing ? (this.now() - st.at) / 1000 : 0);
    return st.track && st.track.duration ? Math.min(p, st.track.duration) : p;
  }

  broadcast(r, event, except = null) {
    if (r.hostSid !== except) this.push(r.hostSid, event);
    for (const sid of r.members.keys()) if (sid !== except) this.push(sid, event);
  }

  createRoom(sid, uid, host) {
    const cur = this.roomOf(sid);
    if (cur && cur.hostSid === sid) return this.snapshot(cur);
    if (cur) this.leaveRoom(cur.code, sid);
    const r = { code: this.newCode(), hostSid: sid, hostUid: uid, host, members: new Map(), state: null, createdAt: this.now(), hostSeen: this.now() };
    this.rooms.set(r.code, r);
    this.box(sid, uid);
    return this.snapshot(r);
  }

  joinRoom(code, sid, uid, member) {
    const r = this.rooms.get(String(code || '').toUpperCase());
    if (!r) return null;
    if (r.hostSid === sid) return this.snapshot(r);
    const other = this.roomOf(sid);
    if (other && other !== r) this.leaveRoom(other.code, sid);
    if (!r.members.has(sid) && r.members.size >= 30) throw Object.assign(new Error('В комнате уже 30 человек'), { status: 409 });
    const isNew = !r.members.has(sid);
    r.members.set(sid, { ...member, uid, seen: this.now() });
    this.box(sid, uid);
    if (isNew) this.broadcast(r, { type: 'room', room: this.snapshot(r), joined: member.name }, sid);
    return this.snapshot(r);
  }

  leaveRoom(code, sid) {
    const r = this.rooms.get(code);
    if (!r) return false;
    if (r.hostSid === sid) {
      this.rooms.delete(code);
      for (const m of r.members.keys()) this.push(m, { type: 'room-closed', code });
      return true;
    }
    const m = r.members.get(sid);
    if (!m) return false;
    r.members.delete(sid);
    this.broadcast(r, { type: 'room', room: this.snapshot(r), left: m.name });
    return true;
  }

  /** Хост сообщает, что играет; участники получают это сразу */
  setRoomState(code, sid, st) {
    const r = this.rooms.get(code);
    if (!r || r.hostSid !== sid) return null;
    r.state = { track: st.track || null, position: Math.max(0, Number(st.position) || 0), playing: !!st.playing, at: this.now() };
    r.hostSeen = this.now();
    this.broadcast(r, { type: 'room', room: this.snapshot(r) }, sid);
    return this.snapshot(r);
  }

  react(code, sid, emoji) {
    const r = this.rooms.get(code);
    if (!r || (r.hostSid !== sid && !r.members.has(sid))) return false;
    if (!REACTIONS.includes(emoji)) return false;
    const name = r.hostSid === sid ? r.host.name : r.members.get(sid).name;
    this.broadcast(r, { type: 'react', emoji, name });
    return true;
  }

  touchMember(sid) {
    for (const r of this.rooms.values()) {
      if (r.hostSid === sid) r.hostSeen = this.now();
      const m = r.members.get(sid);
      if (m) m.seen = this.now();
    }
  }

  /** Убираем пропавших: участник без связи 90 секунд — вышел; хост без связи 5 минут — комната закрыта */
  sweep() {
    const now = this.now();
    for (const r of [...this.rooms.values()]) {
      if (now - r.hostSeen > this.hostMs) {
        this.leaveRoom(r.code, r.hostSid);
        continue;
      }
      for (const [sid, m] of [...r.members]) if (now - m.seen > this.memberMs) this.leaveRoom(r.code, sid);
    }
    for (const [sid, b] of this.boxes) if (!b.waiters.size && now - b.seen > 3600_000 && !this.roomOf(sid)) this.boxes.delete(sid);
  }
}
