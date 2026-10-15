// Эквалайзер: 10 полос через Web Audio (BiquadFilter) поверх <audio>.
// Цепочка включается только когда эквалайзер впервые включают — до этого звук идёт как раньше, без Web Audio.

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS = [
  ['flat', 'Ровно', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['bass', 'Бас', [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]],
  ['vocal', 'Вокал', [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1]],
  ['treble', 'Высокие', [0, 0, 0, 0, 0, 1, 2, 4, 5, 6]],
  ['rock', 'Рок', [4, 3, 2, 0, -1, -1, 1, 2, 3, 4]],
  ['electronic', 'Электроника', [5, 4, 1, 0, -2, 1, 0, 2, 4, 5]],
  ['acoustic', 'Акустика', [3, 2, 1, 1, 2, 2, 2, 3, 2, 1]],
  ['night', 'Тихо ночью', [-4, -3, -2, 0, 1, 2, 2, 1, -1, -3]]
];

export const EQ_DEFAULT = { on: false, preset: 'flat', gains: EQ_PRESETS[0][2].slice() };

export function bandLabel(hz) {
  return hz >= 1000 ? `${hz / 1000}к` : String(hz);
}

/** Приводит сохранённые настройки к правильному виду */
export function normalizeEq(eq) {
  const g = Array.isArray(eq && eq.gains) && eq.gains.length === EQ_BANDS.length ? eq.gains : EQ_DEFAULT.gains;
  return {
    on: !!(eq && eq.on),
    preset: (eq && eq.preset) || 'flat',
    gains: g.map((x) => Math.max(-12, Math.min(12, Number(x) || 0)))
  };
}

export class Equalizer {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.filters = [];
    this.pre = null;
    audio.addEventListener('play', () => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    });
  }

  get supported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  /** Строит цепочку: <audio> → предусилитель → 10 фильтров → выход */
  build() {
    if (this.ctx || !this.supported) return !!this.ctx;
    const a = this.audio;
    // поток nyao:// — другой «источник» для страницы: без crossOrigin Web Audio отдаст тишину
    const reload = !!a.currentSrc && a.crossOrigin !== 'anonymous';
    const pos = a.currentTime;
    const wasPlaying = !a.paused;
    a.crossOrigin = 'anonymous';
    if (reload) {
      const src = a.src;
      a.src = src;
      a.addEventListener('loadedmetadata', () => {
        try {
          a.currentTime = pos;
        } catch {
          // перемотка не удалась — играем с начала
        }
        if (wasPlaying) a.play().catch(() => {});
      }, { once: true });
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaElementSource(a);
    this.pre = this.ctx.createGain();
    this.filters = EQ_BANDS.map((hz, i) => {
      const f = this.ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = hz;
      f.Q.value = 1.1;
      f.gain.value = 0;
      return f;
    });
    let node = source.connect(this.pre);
    for (const f of this.filters) node = node.connect(f);
    node.connect(this.ctx.destination);
    return true;
  }

  apply(eq) {
    const e = normalizeEq(eq);
    if (!e.on && !this.ctx) return; // ни разу не включали — Web Audio не трогаем
    if (!this.build()) return;
    const gains = e.on ? e.gains : e.gains.map(() => 0);
    const t = this.ctx.currentTime;
    gains.forEach((g, i) => this.filters[i].gain.setTargetAtTime(g, t, 0.02));
    // подъём полос может перегрузить звук — немного убавляем общую громкость
    const peak = Math.max(0, ...gains);
    this.pre.gain.setTargetAtTime(Math.pow(10, (-peak * 0.6) / 20), t, 0.02);
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
}
