import test from 'node:test';
import assert from 'node:assert/strict';
import { isNight, cappedVolume, startupVolume, resumePoint, sleepGain, LONG_TRACK } from '../src/renderer/qol.js';

const at = (h) => { const d = new Date(2026, 10, 10, h, 30); return d; };

test('ночь: через полночь, предел громкости только ночью', () => {
  assert.equal(isNight(at(23)), true);
  assert.equal(isNight(at(3)), true);
  assert.equal(isNight(at(7)), false);
  assert.equal(isNight(at(15)), false);
  assert.equal(cappedVolume(0.9, { nightCap: 0.4, now: at(1) }), 0.4);
  assert.equal(cappedVolume(0.9, { nightCap: 0.4, now: at(12) }), 0.9);
  assert.equal(cappedVolume(0.2, { nightCap: 0.4, now: at(1) }), 0.2);
  assert.equal(cappedVolume(0.9, { nightCap: 0, now: at(1) }), 0.9);
});

test('громкость при запуске, место в длинных треках, затухание сна', () => {
  assert.equal(startupVolume({ volume: 0.9 }), 0.9);
  assert.equal(startupVolume({ volume: 0.9, startVolume: 'last' }), 0.9);
  assert.equal(startupVolume({ volume: 0.9, startVolume: 0.3 }), 0.3);
  assert.equal(resumePoint(600, LONG_TRACK + 600), 600);
  assert.equal(resumePoint(600, 300), 0, 'короткий трек — с начала');
  assert.equal(resumePoint(30, LONG_TRACK + 600), 0, 'меньше минуты — с начала');
  assert.equal(resumePoint(LONG_TRACK + 580, LONG_TRACK + 600), 0, 'почти дослушан — с начала');
  assert.equal(sleepGain(60), 1);
  assert.equal(sleepGain(15), 0.5);
  assert.equal(sleepGain(-1), 0);
});
