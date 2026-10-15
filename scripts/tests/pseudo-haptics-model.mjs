import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const js = stripTypeScriptTypes(readFileSync('src/scripts/pseudoHapticsModel.ts', 'utf8'), { mode: 'strip' })
  .replaceAll('export function', 'function').replaceAll('export const', 'const')
  + '\nthis.settings = DEMO_SETTINGS;';
const model = {};
runInNewContext(js, model);
const { toControlPosition, toDisplayPosition, resistanceAt, resistanceIntegral, followPosition, lagStrengthAt, sweptLagStrength, settings } = model;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} vs ${expected}`);
const move = (position, delta, travel = 1000) => toDisplayPosition(toControlPosition(position, travel) + delta, travel);
assert.equal(settings.cdRatio, 1.5);
assert.equal(settings.lagMs, 220);
assert.equal(settings.boundaryWidth, 0);
close(move(100, 100), 200, 'left direct region');
close(move(800, -100), 700, 'right direct region');
close(move(450, 150), 550, 'gentle 1.5:1 central resistance');
close(move(550, -150), 450, 'gentle 1.5:1 reverse');
close(move(300, 100), 380, 'cross left boundary');
close(move(700, -100), 620, 'cross right boundary');
close(move(100, 960), 900, 'cross entire region');
close(move(900, -960), 100, 'reverse entire region');

for (const [origin, delta] of [[100, 960], [900, -960], [300, 300], [700, -300]]) {
  const whole = move(origin, delta);
  for (const subdivisions of [2, 7, 60, 144]) {
    let split = origin;
    for (let step = 0; step < subdivisions; step++) split = move(split, delta / subdivisions);
    close(split, whole, `input subdivision ${subdivisions}`);
  }
  close(move(whole, -delta), origin, 'reversible without end-stop clipping');
}
for (const origin of [0, 100, 500, 900, 1000]) {
  close(move(origin, 0), origin, 'zero input');
  close(move(origin, 10000), 1000, 'right end stop');
  close(move(origin, -10000), 0, 'left end stop');
}
close(move(0, 10), 10, 'leave left stop');
close(move(1000, -10), 990, 'leave right stop');
assert.equal(toControlPosition(100, 0), 0);
assert.equal(toDisplayPosition(100, 0), 0);
assert.equal(resistanceAt(100, 0), 0);
assert.equal(resistanceAt(340, 1000), 0);
assert.equal(resistanceAt(341, 1000), 1);
assert.equal(resistanceAt(659, 1000), 1);
assert.equal(resistanceAt(660, 1000), 0);

// Optional soft edges remain an integrated, symmetric mapping, including both boundaries.
for (const edge of [0, 0.06, 0.2]) {
  settings.boundaryWidth = edge;
  const actualEdge = Math.min(edge, (settings.end - settings.start) / 2);
  close(resistanceIntegral(1), settings.end - settings.start - actualEdge, 'integral across band');
  for (let position = 0; position <= 1000; position++) {
    close(toDisplayPosition(toControlPosition(position, 1000), 1000), position, 'inverse mapping');
    close(resistanceAt(position, 1000), resistanceAt(1000 - position, 1000), 'symmetric band');
    assert.ok(resistanceAt(position, 1000) >= 0 && resistanceAt(position, 1000) <= 1);
  }
}
settings.boundaryWidth = 0;

// The viscous response is spatial: neutral areas have no lag and both edges ease in.
for (const position of [0, 100, 340, 660, 900, 1000]) {
  close(lagStrengthAt(position, 1000), 0, 'neutral or boundary lag');
}
close(lagStrengthAt(370, 1000), 0.5, 'left response ramp');
close(lagStrengthAt(630, 1000), 0.5, 'right response ramp');
for (const position of [400, 500, 600]) close(lagStrengthAt(position, 1000), 1, 'full central lag');
for (const [from, to, strength] of [[100, 900, 1], [900, 100, 1], [0, 300, 0], [700, 1000, 0], [350, 370, 0.5]]) {
  close(sweptLagStrength(from, to, 1000), strength, 'whole path participates in lag');
}
assert.equal(lagStrengthAt(100, 0), 0);
assert.equal(sweptLagStrength(0, 100, 0), 0);
assert.equal(lagStrengthAt(NaN, 1000), 0);
assert.equal(sweptLagStrength(0, Infinity, 1000), 0);

// Following moves toward the target without overshoot, including reverse motion.
for (const [from, to] of [[0, 500], [900, 500]]) {
  const once = followPosition(from, to, 220, 220);
  close(once, to + (from - to) * Math.exp(-1), 'response time constant');
  for (const fps of [30, 60, 144]) {
    let position = from;
    for (let frame = 0; frame < fps; frame++) {
      position = followPosition(position, to, 1000 / fps, 220);
      assert.ok(position >= Math.min(from, to) && position <= Math.max(from, to));
    }
    close(position, followPosition(from, to, 1000, 220), 'frame-independent exponential response');
  }
}
close(followPosition(10, 100, 16, 0), 100, 'no lag is immediate');
close(followPosition(10, 100, -16, 220), 10, 'negative elapsed time does not move');
console.log('PASS: gentle spatial resistance, reversible mapping, event subdivision/end stops, smooth lag boundaries, swept response, and frame-independent following.');
