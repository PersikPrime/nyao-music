import test from 'node:test';
import assert from 'node:assert/strict';
import { FullScreen, backgroundFrom } from '../src/renderer/fullscreen.js';

// Крошечный «DOM»: ровно то, что трогает update()/tick(), без браузера
function node() {
  const classes = new Set();
  return {
    innerHTML: '', textContent: '', src: '', disabled: false, title: '', dataset: {}, childElementCount: 0,
    style: { setProperty() {}, visibility: '' },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, scrollTo() {}, clientHeight: 100,
  };
}
function fake(deps) {
  const fs = new FullScreen({ icons: { play: 'p', pause: 'P', heart: 'h', heartOn: 'H' }, ensureLyrics: () => Promise.resolve(null), api: { coverColor: () => Promise.resolve(null) }, ...deps });
  const nodes = new Map();
  fs.el = node();
  fs.$ = (sel) => { if (!nodes.has(sel)) nodes.set(sel, node()); return nodes.get(sel); };
  fs.open = true;
  return { fs, $: fs.$ };
}
const player = (track) => ({ current: track, playing: true, liked: new Set(), audio: { currentTime: 5, duration: 100 }, queue: [track], index: 0 });

test('fullscreen: название меняется, даже если цвет обложки и текст падают', () => {
  const a = { id: 'ya:1', title: 'Первый', artist: 'A', cover: 'x' };
  const b = { id: 'ya:2', title: 'Второй', artist: 'B', cover: 'y' };
  const p = player(a);
  const { fs, $ } = fake({
    player: p,
    api: { coverColor: () => { throw new Error('ipc'); } },
    ensureLyrics: () => { throw new Error('clone'); },
  });
  fs.update();
  assert.equal($('.fs-title').textContent, 'Первый');
  p.current = b;
  fs.update();
  assert.equal($('.fs-title').textContent, 'Второй');
  assert.equal($('.fs-art img').src, 'y');
});

test('fullscreen: tick сам подхватывает новый трек, если событие смены потерялось', () => {
  const a = { id: 'ya:1', title: 'Первый', artist: 'A' };
  const b = { id: 'ya:2', title: 'Второй', artist: 'B' };
  const p = player(a);
  const { fs, $ } = fake({ player: p });
  fs.update();
  p.current = b;
  fs.tick();
  assert.equal($('.fs-title').textContent, 'Второй');
  assert.equal(fs.trackId, 'ya:2');
});

test('fullscreen: зависший запрос текста не ждём дольше предела', async () => {
  const fs = new FullScreen({ icons: {}, api: {}, player: {} });
  const v = await fs.withTimeout(new Promise(() => {}), 10, 'нет');
  assert.equal(v, 'нет');
  assert.equal(await fs.withTimeout(Promise.resolve(3), 10), 3);
  assert.equal(await fs.withTimeout(Promise.reject(new Error('x')), 10, null), null);
});

test('backgroundFrom: фон почти чёрный, но в тоне обложки', () => {
  assert.equal(backgroundFrom(null), '#1c1a20');
  const m = backgroundFrom([200, 40, 40]).match(/rgb\((\d+), (\d+), (\d+)\)/);
  assert.ok(m && Number(m[1]) > Number(m[2]) && Number(m[1]) < 100);
});
