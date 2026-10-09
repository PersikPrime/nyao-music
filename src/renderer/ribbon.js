// «Лента» Моей волны: две связки линий (жёлтая — Яндекс, красная — YouTube Music),
// которые сплетаются в одну. Рисуется на canvas и медленно течёт; при воспроизведении — быстрее.

function ss(a, b, x) {
  x = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const live = new Set();

export class Ribbon {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!this.ctx) return; // нет canvas — просто без анимации
    this.lines = opts.lines || 18;
    this.cy = opts.cy ?? 0.5; // центр по высоте, доля
    this.amp = opts.amp ?? 1; // размах относительно высоты
    this.width = opts.width || 1.3;
    this.accent = opts.accent || '#C6B8FF';
    this.alpha = opts.alpha ?? 1;
    this.t = Math.random() * 10;
    this.speed = 0.25;
    this.last = 0;
    this.size = { w: 0, h: 0 };
    live.add(this);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  static setPlaying(playing) {
    live.forEach((r) => (r.speed = playing ? 0.9 : 0.25));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (r.width === this.size.w && r.height === this.size.h) return;
    this.size = { w: r.width, h: r.height };
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = (stops) => {
      const lg = this.ctx.createLinearGradient(0, 0, r.width, 0);
      stops.forEach(([o, c]) => lg.addColorStop(o, c));
      return lg;
    };
    this.grad = [
      g([[0, '#FFD60A'], [0.52, this.accent], [1, 'rgba(198,184,255,0.06)']]),
      g([[0, 'rgba(198,184,255,0.06)'], [0.48, this.accent], [1, '#FF453A']])
    ];
  }

  draw() {
    this.resize();
    const { w: W, h: H } = this.size;
    if (!W || !H) return;
    const ctx = this.ctx;
    const A = H * this.amp;
    const cy = H * this.cy;
    const t = this.t;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = this.width;
    const steps = Math.max(40, Math.round(W / 16));
    for (let b = 0; b < 2; b++) {
      ctx.strokeStyle = this.grad[b];
      for (let i = 0; i < this.lines; i++) {
        const tt = i / (this.lines - 1) - 0.5;
        ctx.globalAlpha = this.alpha * (0.25 + 0.65 * (1 - Math.abs(tt) * 1.6));
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const shared = 0.12 * A * Math.sin(u * Math.PI * 2.3 + 0.5 + t * 0.35);
          const thick = 0.15 * A * (0.55 + 0.45 * Math.sin(u * Math.PI * 3 + 1.1 + b * 0.8 + t * 0.22));
          const twist = tt * thick * Math.cos(u * Math.PI * 2.2 + b * 1.6 + tt * 0.6 + t * 0.5);
          const off = b === 0 ? -0.27 * A * (1 - ss(0.02, 0.55, u)) : 0.27 * A * (1 - ss(0.02, 0.55, 1 - u));
          const y = cy + shared + twist + off;
          if (k) ctx.lineTo(u * W, y);
          else ctx.moveTo(0, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  loop(now) {
    if (!this.canvas.isConnected) {
      live.delete(this);
      return;
    }
    // ~30 кадров в секунду и только когда окно видно
    if (!document.hidden && now - this.last > 33) {
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      if (!reduceMotion) this.t += dt * this.speed;
      this.draw();
      if (reduceMotion) return; // один статичный кадр
    }
    requestAnimationFrame(this.loop);
  }
}
