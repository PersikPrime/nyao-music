import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleLine, wrap, fitLines, cardColors } from '../src/renderer/lyric-card.js';

test('карточка: строки выбираются подряд и не больше четырёх', () => {
  let s = toggleLine([], 5);
  assert.deepEqual(s, [5]);
  s = toggleLine(s, 6);
  s = toggleLine(s, 4);
  s = toggleLine(s, 7);
  assert.deepEqual(s, [4, 5, 6, 7]);
  assert.deepEqual(toggleLine(s, 8), [8], 'пятая строка — начать заново');
  assert.deepEqual(toggleLine(s, 4), [5, 6, 7], 'край убирается');
  assert.deepEqual(toggleLine(s, 5), [5], 'середина — заново');
  assert.deepEqual(toggleLine([3], 3), []);
  assert.deepEqual(toggleLine([3], 9), [9], 'не рядом — заново');
});

test('карточка: перенос и подбор шрифта влезают в рамку', () => {
  const m = (size) => (str) => str.length * size * 0.6;
  assert.deepEqual(wrap('раз два три четыре', 50, m(10)), ['раз два', 'три', 'четыре']);
  const lines = ['Я иду по городу ночному', 'и считаю фонари', 'каждый — как маленькое солнце', 'что горит внутри'];
  const box = { w: 888, h: 900 };
  const fit = fitLines(lines, box, m);
  assert.ok(fit.height <= box.h);
  assert.ok(fit.size >= 40 && fit.size <= 92);
  assert.ok(fit.rows.flat().every((r) => m(fit.size)(r) <= box.w));
  assert.ok(fitLines(['коротко'], box, m).size === 92, 'одна короткая строка — крупно');
});

test('карточка: фон из цвета обложки', () => {
  const c = cardColors([200, 40, 40]);
  assert.match(c.top, /^rgb\(/);
  assert.ok(cardColors(null).top);
});
