import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { renderCover, placeholderCover, coverIndex, isPlaceholderCover } from '../src/main/cover-art.js';
import { mapAudio } from '../src/main/providers/vk.js';

test('шаблонная обложка: PNG нужного размера, цвет стабилен для трека', () => {
  const png = renderCover('vk:1_2', 64);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(coverIndex('vk:1_2'), coverIndex('vk:1_2'));
  assert.ok(zlib.deflateSync(Buffer.alloc(1)));
});

test('VK без обложки получает шаблонную, с обложкой — свою', () => {
  const base = [2, 1, '', 'Трек', 'Исполнитель', 180, 0, 0, '', 0, 0, '', '', 'h/h', ''];
  const t = mapAudio(base);
  assert.equal(t.cover, placeholderCover('vk:1_2'));
  assert.ok(isPlaceholderCover(t.cover));
  const withCover = base.slice();
  withCover[14] = 'https://sun9.userapi.com/a.jpg';
  assert.equal(mapAudio(withCover).cover, 'https://sun9.userapi.com/a.jpg');
});
