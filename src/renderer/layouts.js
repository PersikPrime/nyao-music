// Вид приложения: «Плеер» (по умолчанию — своя музыка на первом плане) или «Моя волна» (как в 0.4).
// Карточки выбора с мини-превью используются в настройках, в приветствии и в окне выбора после обновления.

export const LAYOUTS = [
  ['player', 'Плеер', 'Твоя музыка на первом плане: недавнее, лайки, плейлисты. Волна — одна из плиток.'],
  ['wave', 'Моя волна', 'Как в 0.4: запуск сразу на волне, большая лента, «не нравится» в плеере.']
];

function wavePath(i, n) {
  const tt = i / (n - 1) - 0.5;
  let d = '';
  for (let k = 0; k <= 30; k++) {
    const u = k / 30;
    const y = 50 + 16 * Math.sin(u * Math.PI * 2 + 0.6) + tt * 20 * Math.cos(u * Math.PI * 2.3 + 1);
    d += `${k ? 'L' : 'M'}${(u * 200).toFixed(1)} ${y.toFixed(1)}`;
  }
  return `<path d="${d}" fill="none" stroke="url(#lw)" stroke-width="1.2" opacity="${(0.25 + 0.6 * (1 - Math.abs(tt) * 1.6)).toFixed(2)}"/>`;
}

function preview(id) {
  if (id === 'wave') {
    return `<span class="lp lp-wave"><svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="lw" x1="0" x2="1"><stop offset="0" stop-color="#FFD60A"/><stop offset=".5" stop-color="#C6B8FF"/><stop offset="1" stop-color="#FF4433"/></linearGradient></defs>${Array.from({ length: 8 }, (_, i) => wavePath(i, 8)).join('')}</svg><b>Моя волна</b></span>`;
  }
  const tile = (c) => `<i style="background:${c}"></i>`;
  return `<span class="lp lp-player"><span class="lp-h"></span><span class="lp-grid">${['#2A2208', '#2A1408', '#141220', '#2A0E0C', '#141220', '#2A2208', '#2A0E0C', '#141220'].map(tile).join('')}</span><span class="lp-row">${'<i></i>'.repeat(6)}</span></span>`;
}

/** Карточки выбора. attr — data-атрибут кнопок (data-action="set-layout" или data-ob="layout") */
export function layoutChoiceHtml(selected, attr) {
  return `<div class="layout-choice" role="radiogroup" aria-label="Вид приложения">${LAYOUTS.map(([id, title, sub]) => `
    <button role="radio" aria-checked="${selected === id}" class="layout-card ${selected === id ? 'on' : ''}" ${attr} data-v="${id}">
      ${preview(id)}
      <span class="lc-meta"><span class="lc-radio"><span></span></span><span class="lc-text"><b>${title}${id === 'player' ? ' <em>по умолчанию</em>' : ''}</b><span>${sub}</span></span></span>
    </button>`).join('')}</div>`;
}
