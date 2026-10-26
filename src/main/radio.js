// Радио по треку: бесконечная подборка «похожего» от одной песни.
// Яндекс — своя станция track:ID, YouTube Music — радио трека, SoundCloud — «похожие», VK — треки того же исполнителя.
import { mainArtist } from './lastfm.js';

export class Radio {
  constructor({ ya, yt, sc, vk, isDown = () => false }) {
    Object.assign(this, { ya, yt, sc, vk, isDown });
    this.seed = null;
    this.seen = new Set();
  }

  async fetchFor(track, first, queueIds) {
    const id = track.srcId;
    switch (track.source) {
      case 'ya':
        return first ? this.ya.radioStart(id) : this.ya.radioMore(queueIds);
      case 'yt':
        return this.yt.radio(id);
      case 'sc':
        return this.sc.related(id);
      case 'vk':
        return this.vk.search(mainArtist(track.artist));
      default:
        return [];
    }
  }

  /** Новый запуск: первым идёт сам трек, за ним похожее */
  async start(track) {
    if (this.isDown(track.source)) throw new Error('Этот сервис сейчас не отвечает — радио по треку недоступно');
    this.seed = track;
    this.seen = new Set([track.id]);
    this.played = [track];
    const list = await this.fetchFor(track, true, []);
    return [track, ...this.take(list)];
  }

  /** Ещё треков: для YouTube и SoundCloud берём «похожее» на случайный трек этого радио, чтобы подборка не замыкалась */
  async more(queueIds = []) {
    if (!this.seed) return [];
    const same = (queueIds || []).filter((id) => id.startsWith(this.seed.source + ':'));
    let seedTrack = this.seed;
    if (this.seed.source === 'yt' || this.seed.source === 'sc') {
      const pool = this.played.filter((t) => t.source === this.seed.source);
      seedTrack = pool[Math.floor(Math.random() * pool.length)] || this.seed;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const list = this.take(await this.fetchFor(seedTrack, false, same));
      if (list.length) return list;
      seedTrack = this.played[Math.floor(Math.random() * this.played.length)] || this.seed;
    }
    return [];
  }

  async feedback(type, track, played = 0) {
    if (!this.seed || !track) return;
    if (type === 'dislike') this.seen.add(track.id);
    if (this.seed.source === 'ya' && track.source === 'ya') await this.ya.radioFeedback(type, track, played);
  }

  take(list) {
    const out = [];
    for (const t of list || []) {
      if (!t || this.seen.has(t.id) || t.available === false) continue;
      this.seen.add(t.id);
      out.push(t);
    }
    this.played.push(...out);
    return out;
  }
}
