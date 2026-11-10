// Оверлей для OBS — встроенное дополнение и заодно пример: написано на том же API, что доступен всем.
// Берёт «что играет» (право track) и публикует на локальную страницу (право page). В сеть не ходит.
(async () => {
  let settings = await nyao.settings.get();
  let last = await nyao.player.get();

  function publish() {
    const t = last.track;
    nyao.page.publish({
      style: settings.style, side: settings.side, progress: settings.progress, hidePaused: settings.hidePaused,
      playing: last.playing, live: last.live, position: last.position, duration: last.duration, at: last.at,
      track: t && { id: t.id, title: t.title, artist: t.artist, cover: t.cover },
    });
  }

  nyao.player.onState((st) => { last = st; publish(); });
  nyao.settings.onChange((v) => { settings = v; publish(); });
  publish();
})();
