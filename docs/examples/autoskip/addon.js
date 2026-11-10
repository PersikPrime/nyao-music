// «Умный пропуск» — пример дополнения Nyao Music.
//
// Учится на твоих действиях: если трек раз за разом листают в первые секунды, после N раз
// дополнение само переключает его дальше и говорит об этом. Всё хранится на этом компьютере (nyao.storage),
// в сеть ничего не уходит. В меню трека — «Больше не пропускать» и «Пропускать всегда».
//
// Как отличить «пролистал» от «трек кончился»: трек сменился, а до конца было далеко и прошло меньше окна.
// Позицию Nyao присылает при паузе, перемотке и смене трека, поэтому между событиями досчитываем по часам.

(async () => {
  let settings = await nyao.settings.get();
  nyao.settings.onChange((v) => { settings = v; });

  // { [id]: { n: сколько раз пролистали, title, artist, pinned?: 'skip' | 'keep' } }
  const memory = (await nyao.storage.get('skips')) || {};
  const save = () => nyao.storage.set('skips', memory);

  let cur = null; // { track, started: ms, position, at, playing, autoskipped }
  let lastState = null;

  /** Сколько секунд трек реально проиграл к этому моменту */
  function played(st) {
    if (!st) return 0;
    return st.position + (st.playing ? (Date.now() - st.at) / 1000 : 0);
  }

  function judge(prev, wasState) {
    // предыдущий трек закончился или его пролистали?
    if (!prev || !prev.track || prev.autoskipped || !wasState || wasState.live) return;
    if (settings.wave && wasState.mode !== 'wave') return;
    const t = played(wasState);
    const dur = prev.track.duration || wasState.duration || 0;
    const limit = Number(settings.window) || 15;
    if (!(t > 0.5 && t < limit && (!dur || dur - t > 10))) return;
    const m = memory[prev.track.id] || { n: 0, title: prev.track.title, artist: prev.track.artist };
    if (m.pinned === 'keep') return;
    m.n += 1;
    memory[prev.track.id] = m;
    save();
    const after = Number(settings.after) || 3;
    if (m.n === after - 1) nyao.log(`«${m.title}» пролистан ${m.n} раз — в следующий раз пропущу сам`);
  }

  function shouldSkip(track) {
    const m = memory[track.id];
    if (!m || m.pinned === 'keep') return false;
    return m.pinned === 'skip' || m.n >= (Number(settings.after) || 3);
  }

  nyao.player.onState((st) => {
    const id = st.track && st.track.id;
    if (!cur || (cur.track && cur.track.id) !== id) {
      judge(cur, lastState);
      cur = st.track ? { track: st.track, autoskipped: false } : null;
      if (cur && st.playing && !st.live && !(settings.wave && st.mode !== 'wave') && shouldSkip(st.track)) {
        cur.autoskipped = true; // своё переключение не считаем «пролистыванием» следующего
        nyao.player.next();
        nyao.ui.toast(`Пропустил «${st.track.title}» — ты его обычно листаешь`);
      }
    }
    lastState = st;
  });

  // меню трека: можно поправить решение руками
  await nyao.ui.trackMenu.add({ id: 'keep', title: 'Не пропускать автоматически' }, (track) => {
    memory[track.id] = { ...(memory[track.id] || {}), n: 0, title: track.title, artist: track.artist, pinned: 'keep' };
    save();
    nyao.ui.toast(`«${track.title}» больше не пропускаю`);
  });
  await nyao.ui.trackMenu.add({ id: 'skip', title: 'Всегда пропускать' }, (track) => {
    memory[track.id] = { ...(memory[track.id] || {}), title: track.title, artist: track.artist, pinned: 'skip' };
    save();
    nyao.ui.toast(`«${track.title}» буду пропускать`);
  });

  const known = Object.values(memory).filter((m) => m.pinned === 'skip' || m.n >= (Number(settings.after) || 3)).length;
  nyao.log(`запущено · уже пропускаю: ${known}`);
})();
