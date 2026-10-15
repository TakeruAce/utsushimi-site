// Execute the actual input controller with DOM/event mocks. These do not replace
// browser/device testing; they cover permission and event-lifecycle regressions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
const strip = path => stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' })
  .replace(/^import .*?;\s*/m, '').replaceAll('export function', 'function').replaceAll('export const', 'const');
const script = strip('src/scripts/pseudoHapticsModel.ts') + '\n' + strip('src/scripts/pseudoHaptics.ts');
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} vs ${expected}`);
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(lock = 'supported') {
  let time = 0, nextFrame = 1, rejectLock;
  const frames = new Map(), observers = {};
  const element = () => ({ dataset: {}, hidden: false, textContent: '', clientWidth: 1096, offsetWidth: 96,
    listeners: {}, style: { values: {}, setProperty(key, value) { this.values[key] = value; } },
    addEventListener(key, callback) { (this.listeners[key] ??= []).push(callback); },
    emit(key, event = {}) { for (const callback of this.listeners[key] ?? []) callback(event); },
  });
  const surface = element(), object = element(), status = element(), mode = element(), root = element();
  const window = element(), document = element(), reduced = element(), reset = element(), captures = new Set();
  reduced.matches = false;
  window.matchMedia = () => reduced;
  Object.assign(surface, { focus() {}, setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); }, releasePointerCapture(id) { captures.delete(id); },
  });
  document.exitPointerLock = () => { document.pointerLockElement = null; document.emit('pointerlockchange'); };
  if (lock === 'rejected') surface.requestPointerLock = () => Promise.reject(new Error('Permission denied'));
  if (lock === 'pending') surface.requestPointerLock = () => new Promise((resolve, reject) => { rejectLock = reject; });
  if (lock === 'legacy') surface.requestPointerLock = () => undefined;
  if (lock === 'supported') surface.requestPointerLock = () => {
    document.pointerLockElement = surface;
    queueMicrotask(() => document.emit('pointerlockchange'));
    return Promise.resolve();
  };
  const elements = { '[data-play-surface]': surface, '[data-demo-object]': object,
    '[data-demo-status]': status, '[data-mode-label]': mode, '[data-reset-position]': reset };
  root.querySelector = selector => elements[selector] ??= element();
  const context = { document, window, performance: { now: () => time },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class { constructor(callback) { observers.resize = callback; } observe() {} },
    IntersectionObserver: class { constructor(callback) { observers.intersection = callback; } observe() {} },
    queueMicrotask,
  };
  runInNewContext(script, context);
  context.initializePseudoHaptics(root);
  const position = () => parseFloat(object.style.values['--object-x']);
  const step = delta => { time += delta; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
  const pointer = (extra = {}) => ({ pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse', clientX: 100, preventDefault() {}, ...extra });
  const key = (name, extra = {}) => ({ key: name, repeat: false, shiftKey: false, preventDefault() {}, ...extra });
  return { surface, object, document, window, root, reset, reduced, mode, status, elements, captures, observers,
    position, step, pointer, key, frames, run(milliseconds, interval = 16) { for (let elapsed = 0; elapsed < milliseconds; elapsed += interval) step(Math.min(interval, milliseconds - elapsed)); }, reject: () => rejectLock(new Error('Permission denied')) };
}

// A denied request previously cleared pointerId and made all subsequent drags inert.
for (const lock of ['rejected', 'legacy', 'unsupported']) {
  const t = setup(lock);
  t.surface.emit('pointerdown', t.pointer());
  if (lock === 'legacy') t.document.emit('pointerlockerror');
  await settle();
  assert.equal(t.surface.dataset.inputMode, 'bounded', lock);
  assert.ok(t.captures.has(1), lock);
  t.surface.emit('pointermove', t.pointer({ clientX: 200 }));
  t.step(16);
  close(t.position(), 240, `${lock}: drag remains usable`);
  t.surface.emit('pointerup', t.pointer({ clientX: 200 }));
  assert.equal(t.captures.size, 0);
}

// If permission is pending, resume at the latest pointer position without a jump.
{
  const t = setup('pending');
  t.surface.emit('pointerdown', t.pointer());
  t.surface.emit('pointermove', t.pointer({ clientX: 150 }));
  t.reject(); await settle();
  t.surface.emit('pointermove', t.pointer({ clientX: 160 })); t.step(16);
  close(t.position(), 150, 'no replay of pending movement');
}
// Late failure after release must not recapture a pointer or resurrect a drag.
{
  const t = setup('pending');
  t.surface.emit('pointerdown', t.pointer());
  t.document.emit('mouseup', { button: 0 });
  t.reject(); await settle();
  assert.equal(t.surface.dataset.inputMode, 'native');
  assert.equal(t.captures.size, 0);
  assert.equal(t.surface.dataset.dragging, undefined);
}
// Relative input scales to normal CSS cursor travel; release restores the cursor.
{
  const t = setup();
  t.document.emit('mousemove', { clientX: 0, movementX: 0 });
  t.document.emit('mousemove', { clientX: 50, movementX: 100 });
  t.surface.emit('pointerdown', t.pointer()); await settle();
  t.document.emit('mousemove', { movementX: 200 }); t.step(16);
  close(t.position(), 240, 'relative mouse calibration');
  t.document.emit('mouseup', { button: 0 });
  assert.equal(t.document.pointerLockElement, null);
  assert.equal(t.surface.dataset.inputMode, 'native');
}

// In the central region the object trails input and keeps settling after normal release.
{
  const t = setup('unsupported');
  t.surface.emit('pointerdown', t.pointer());
  t.surface.emit('pointermove', t.pointer({ clientX: 540 })); t.step(16);
  const early = t.position();
  assert.ok(early > 340 && early < 400, 'visible lag on entering the center');
  assert.equal(t.mode.textContent, '粘り');
  t.surface.emit('pointerup', t.pointer({ clientX: 540 }));
  t.run(100);
  assert.ok(t.position() > early && t.position() < 500, 'release preserves the viscous tail');
  t.run(3000);
  close(t.position(), 500, 'settles to mapped target after release');
  assert.equal(t.frames.size, 0, 'settled demo stops animating');
}
// A single large event cannot skip the band; exiting fades the lag rather than teleporting.
{
  const t = setup('unsupported');
  t.surface.emit('pointerdown', t.pointer());
  t.surface.emit('pointermove', t.pointer({ clientX: 1020 })); t.step(16);
  assert.ok(t.position() > 340 && t.position() < 500, 'large movement enters the band');
  for (let frame = 0; t.position() < 660 && frame < 100; frame++) t.step(16);
  const exit = t.position();
  assert.ok(exit >= 660 && exit < 900, 'exit still has a tail');
  assert.equal(t.mode.textContent, 'そのまま');
  t.step(16);
  assert.ok(t.position() > exit && t.position() < 900, 'tail decays gradually outside band');
  t.run(2000); close(t.position(), 900);
  t.surface.emit('pointermove', t.pointer({ clientX: 1070 })); t.step(16);
  close(t.position(), 950, 'settled right neutral area tracks immediately');
  t.surface.emit('pointerup', t.pointer({ clientX: 1070 }));
}
// Regrabbing the object cancels its old destination, so a pending tail cannot jump away.
{
  const t = setup('unsupported');
  t.surface.emit('pointerdown', t.pointer({ pointerType: 'touch' }));
  t.surface.emit('pointermove', t.pointer({ pointerType: 'touch', clientX: 540 })); t.step(16);
  t.surface.emit('pointerup', t.pointer({ pointerType: 'touch', clientX: 540 })); t.run(100);
  t.surface.emit('pointerdown', t.pointer({ pointerType: 'touch' }));
  const caught = t.position(); t.run(1000); close(t.position(), caught, 'regrab holds current visual position');
  t.surface.emit('pointercancel', t.pointer({ pointerType: 'touch' }));
  assert.equal(t.captures.size, 0);
}
// Touch can traverse and reverse the whole band, with the same settled C/D mapping.
{
  const t = setup();
  t.surface.emit('pointerdown', t.pointer({ pointerType: 'touch' }));
  t.surface.emit('pointermove', t.pointer({ pointerType: 'touch', clientX: 1100 })); t.run(3000);
  close(t.position(), 980); assert.equal(t.mode.textContent, 'そのまま');
  t.surface.emit('pointerup', t.pointer({ pointerType: 'touch', clientX: 1100 })); t.step(16);
  t.surface.emit('pointerdown', t.pointer({ pointerType: 'touch' }));
  t.surface.emit('pointermove', t.pointer({ pointerType: 'touch', clientX: -900 })); t.step(16);
  assert.ok(t.position() > 500 && t.position() < 660, 'reverse traversal also lags');
  t.run(3000); close(t.position(), 140); assert.equal(t.mode.textContent, 'そのまま');
  t.surface.emit('pointercancel', t.pointer({ pointerType: 'touch' }));
  assert.equal(t.captures.size, 0);
}
// Key speed depends on held duration, not OS repeat or display refresh rate.
// Key release stops input while allowing the visual response to finish.
for (const fps of [30, 60, 144]) {
  const t = setup();
  t.surface.emit('keydown', t.key('ArrowRight'));
  for (let frame = 0; frame < fps; frame++) {
    t.surface.emit('keydown', t.key('ArrowRight', { repeat: true }));
    t.step(1000 / fps);
  }
  const released = t.position();
  assert.ok(released > 340 && released < 366.6667, 'keyboard motion trails in the band');
  t.window.emit('keyup', t.key('ArrowRight')); t.run(3000);
  close(t.position(), 366.6666666667, `${fps} fps: 240 px control travel, then settled`);
  const final = t.position(); t.run(500); close(t.position(), final, 'no input after keyup');
}
// Lifecycle cancellation halts both held input and the uncompleted viscous response.
for (const stop of ['blur', 'pagehide', 'visibility', 'offscreen', 'escape', 'surface-blur']) {
  const t = setup();
  t.surface.emit('keydown', t.key('ArrowRight', { shiftKey: true })); t.run(600);
  assert.ok(t.position() > 340 && t.position() < 446.6667, 'Shift input has an uncompleted viscous tail');
  if (stop === 'visibility') { t.document.hidden = true; t.document.emit('visibilitychange'); }
  else if (stop === 'offscreen') t.observers.intersection([{ isIntersecting: false }]);
  else if (stop === 'escape') t.surface.emit('keydown', t.key('Escape'));
  else if (stop === 'surface-blur') t.surface.emit('blur');
  else t.window.emit(stop);
  const stopped = t.position(); t.run(3000); close(t.position(), stopped, stop);
  assert.equal(t.frames.size, 0, 'cancelled animation has no tail');
  t.surface.emit('keydown', t.key('Home')); close(t.position(), 140, 'Home reset');
}
for (const stop of ['pointercancel', 'lostpointercapture']) {
  const t = setup();
  t.surface.emit('pointerdown', t.pointer({ pointerType: 'touch' }));
  t.surface.emit('pointermove', t.pointer({ pointerType: 'touch', clientX: 540 })); t.step(16);
  t.surface.emit(stop, t.pointer({ pointerType: 'touch' }));
  const stopped = t.position(); t.run(3000); close(t.position(), stopped, stop);
  assert.equal(t.frames.size, 0);
}
// Reduced motion retains spatial gain, but removes following and post-release motion.
{
  const t = setup('unsupported');
  t.reduced.matches = true; t.reduced.emit('change');
  assert.equal(t.elements['[data-reduced-note]'].hidden, false);
  t.surface.emit('pointerdown', t.pointer());
  t.surface.emit('pointermove', t.pointer({ clientX: 540 })); t.step(16);
  close(t.position(), 500, 'reduced motion reaches central target immediately');
  t.surface.emit('pointerup', t.pointer({ clientX: 540 })); t.run(500);
  close(t.position(), 500, 'no reduced-motion tail');
  t.reduced.matches = false; t.reduced.emit('change');
  assert.equal(t.elements['[data-reduced-note]'].hidden, true);
}
{
  const t = setup();
  t.surface.emit('keydown', t.key('ArrowRight')); t.step(500);
  close(t.position(), 260, 'left neutral keyboard movement');
  t.surface.clientWidth = 596; t.observers.resize(); close(t.position(), 130, 'resize preserves fraction');
  t.reset.emit('click'); close(t.position(), 70, 'reset uses resized travel');
}
console.log('PASS: pointer-lock fallback/async release/calibration, direct tracking, central lag and release settling, gradual exit, touch reversal/regrab, continuous keyboard, cancellation, reduced motion, resize/reset. DOM mocks; physical browser input is not covered.');
