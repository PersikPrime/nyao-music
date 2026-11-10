// Страница оверлея: слушает поток данных от дополнения и рисует плашку. Работает в браузере OBS.
const $ = (id) => document.getElementById(id);
const np = $('np');
let cur = null;
let shownId = null;

// та же «печенька», что у обложек в Nyao Music
(function cookie(n, amp) {
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const t = (2 * Math.PI * i) / 120;
    const r = 50 * (1 - amp) + 50 * amp * Math.cos(n * t);
    pts.push(`${(50 + r * Math.sin(t)).toFixed(2)}% ${(50 - r * Math.cos(t)).toFixed(2)}%`);
  }
  document.querySelector('.art').style.clipPath = `polygon(${pts.join(',')})`;
})(10, 0.05);

function fill() {
  $('title').textContent = cur.track.title;
  $('artist').textContent = cur.track.artist;
  if (cur.track.cover) $('cover').src = cur.track.cover; else $('cover').removeAttribute('src');
}

function render(d) {
  cur = d;
  const visible = !!(d && d.track && (d.playing || !d.hidePaused));
  if (!visible) { np.classList.remove('on'); return; }
  np.hidden = false;
  np.className = `np ${d.style || 'card'} ${d.side || 'bl'} ${d.playing ? '' : 'paused'} ${np.classList.contains('swap') ? 'swap' : ''}`;
  $('bar').style.display = d.progress && !d.live && d.duration ? '' : 'none';
  if (shownId === null) { fill(); shownId = d.track.id; }
  else if (d.track.id !== shownId) {
    // новый трек: обложка «перекатывается», подписи меняются
    shownId = d.track.id;
    np.classList.add('swap');
    setTimeout(() => { if (cur && cur.track) fill(); np.classList.remove('swap'); }, 380);
  }
  requestAnimationFrame(() => np.classList.add('on'));
}

function tick() {
  if (cur && cur.track && cur.duration) {
    const pos = cur.position + (cur.playing ? (Date.now() - cur.at) / 1000 : 0);
    $('fill').style.width = `${Math.max(0, Math.min(1, pos / cur.duration)) * 100}%`;
  }
  requestAnimationFrame(tick);
}
tick();

function connect() {
  const es = new EventSource('__events');
  es.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch { /* пропускаем битое */ } };
  es.onerror = () => { es.close(); np.classList.remove('on'); setTimeout(connect, 2000); }; // Nyao Music закрыт — прячемся и ждём
}
connect();
