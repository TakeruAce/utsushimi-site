import { clampPosition, DEMO_SETTINGS, followPosition, sweptLagStrength, resistanceAt, toControlPosition, toDisplayPosition } from './pseudoHapticsModel';

/** Pointer displacement illustrates pseudo-haptics, not the device's force input. */
export function initializePseudoHaptics(root: HTMLElement) {
  if (root.dataset.initialized) return;
  const surface = root.querySelector<HTMLElement>('[data-play-surface]')!;
  const object = root.querySelector<HTMLElement>('[data-demo-object]')!;
  const status = root.querySelector<HTMLElement>('[data-demo-status]')!;
  const modeLabel = root.querySelector<HTMLElement>('[data-mode-label]')!;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let travel = 0, controlPosition = 0, targetPosition = 0, displayPosition = 0;
  let pointerId: number | null = null;
  let lastPointerX = 0, frameId = 0, lastTime = performance.now();
  let announceWhenSettled = false;
  let responseLagMs = 0;
  let mouseDrag = false, lockPending = false, lockRequestId = 0;
  let lockUsesPromise = false;
  let lastUnlockedMouseX: number | null = null;
  let cssDistance = 0, movementDistance = 0;
  let mouseCssScale = 1, lockedMouseScale = 1;
  const heldArrows = new Set<string>();
  let keyboardTime = performance.now(), keyboardFast = false;

  // movementXの単位は環境で異なるため、通常カーソルのCSSピクセルと揃える。
  function measureMouseScale(event: MouseEvent) {
    const previousX = lastUnlockedMouseX;
    lastUnlockedMouseX = event.clientX;
    if (previousX === null) return;
    const cssDelta = event.clientX - previousX;
    const movement = event.movementX;
    if (!Number.isFinite(cssDelta) || !Number.isFinite(movement) || cssDelta * movement <= 0) return;
    const scale = cssDelta / movement;
    if (scale < 0.2 || scale > 5) return;
    cssDistance += Math.abs(cssDelta);
    movementDistance += Math.abs(movement);
    if (movementDistance >= 20) mouseCssScale = cssDistance / movementDistance;
    if (movementDistance > 400) {
      cssDistance *= 0.5;
      movementDistance *= 0.5;
    }
  }

  // Permission denial must preserve ordinary dragging, just like API absence.
  function useBoundedMouse(requestId: number) {
    if (requestId !== lockRequestId || !mouseDrag || pointerId === null) return;
    lockPending = false;
    surface.setPointerCapture(pointerId);
    surface.dataset.inputMode = 'bounded';
    status.textContent = '左右にドラッグできます。画面端では一度離してからドラッグを続けるか、左右キーで操作してください。';
  }

  async function lockMouse(requestId: number) {
    if (!surface.requestPointerLock) {
      useBoundedMouse(requestId);
      return;
    }
    try {
      // Keep OS acceleration/velocity consistent with the ordinary cursor.
      const request = surface.requestPointerLock();
      lockUsesPromise = Boolean(request && typeof request.then === 'function');
      await request;
    } catch {
      useBoundedMouse(requestId);
    }
  }

  function render() {
    object.style.setProperty('--object-x', `${displayPosition}px`);
    const resisted = resistanceAt(displayPosition, travel) > 0;
    surface.dataset.zone = resisted ? 'viscous' : 'direct';
    modeLabel.textContent = resisted ? '粘り' : 'そのまま';
  }

  function announce() {
    status.textContent = `${resistanceAt(displayPosition, travel) > 0 ? '中央の粘りエリア' : 'そのまま動くエリア'}。物体の位置は左端から${travel ? Math.round(displayPosition / travel * 100) : 0}%。`;
  }

  function advanceDisplay(time: number) {
    const elapsed = Math.max(0, time - lastTime);
    lastTime = time;
    if (reducedMotion.matches) {
      displayPosition = targetPosition;
      responseLagMs = 0;
      return;
    }
    const start = travel * DEMO_SETTINGS.start;
    const end = travel * DEMO_SETTINGS.end;
    // Neutral space follows directly; a large movement still enters the viscous band.
    if (displayPosition < start && targetPosition > start) displayPosition = start;
    else if (displayPosition > end && targetPosition < end) displayPosition = end;
    const desiredLag = DEMO_SETTINGS.lagMs * sweptLagStrength(displayPosition, targetPosition, travel);
    // Let the remaining lag decay at the exit rather than snapping to the target.
    responseLagMs = desiredLag >= responseLagMs
      ? desiredLag
      : followPosition(responseLagMs, desiredLag, elapsed, 60);
    if (responseLagMs < 1) responseLagMs = 0;
    displayPosition = followPosition(displayPosition, targetPosition, elapsed, responseLagMs);
    if (Math.abs(targetPosition - displayPosition) < 0.05) displayPosition = targetPosition;
    if (displayPosition === targetPosition && !resistanceAt(displayPosition, travel)) responseLagMs = 0;
  }

  function animate(time: number) {
    frameId = 0;
    advanceKeyboard(time);
    advanceDisplay(time);
    render();
    if (heldArrows.size || displayPosition !== targetPosition) scheduleRender();
    else if (announceWhenSettled) {
      announceWhenSettled = false;
      announce();
    }
  }

  function scheduleRender() {
    if (!frameId) frameId = requestAnimationFrame(animate);
  }

  function moveBy(delta: number) {
    if (!Number.isFinite(delta)) return;
    advanceDisplay(performance.now());
    updateControl(delta);
    scheduleRender();
  }

  function updateControl(delta: number) {
    controlPosition = clampPosition(controlPosition + delta, 0, toControlPosition(travel, travel));
    targetPosition = toDisplayPosition(controlPosition, travel);
  }

  // OSのキーリピートに依存せず、押していた時間だけ入力を進める。
  function advanceKeyboard(time: number) {
    const direction = Number(heldArrows.has('ArrowRight')) - Number(heldArrows.has('ArrowLeft'));
    if (direction) updateControl(direction * DEMO_SETTINGS.keySpeed * (keyboardFast ? 2.5 : 1) * Math.max(0, time - keyboardTime) / 1000);
    keyboardTime = time;
  }

  function stopKeyboard() {
    advanceKeyboard(performance.now());
    heldArrows.clear();
    keyboardFast = false;
  }

  function endDrag(cancel = false) {
    if (cancel) stopKeyboard();
    const captured = pointerId;
    pointerId = null;
    mouseDrag = false;
    lastUnlockedMouseX = null;
    lockPending = false;
    lockRequestId++;
    delete surface.dataset.dragging;
    if (captured !== null && captured >= 0 && surface.hasPointerCapture(captured)) surface.releasePointerCapture(captured);
    if (cancel) {
      advanceDisplay(performance.now());
      targetPosition = displayPosition;
      controlPosition = toControlPosition(displayPosition, travel);
      cancelAnimationFrame(frameId);
      frameId = 0;
      announceWhenSettled = false;
      responseLagMs = 0;
      render();
    } else {
      announceWhenSettled = true;
      scheduleRender();
    }
    // ドラッグ終了後はOSカーソルへ戻す。キューブは最後の位置に残す。
    surface.dataset.inputMode = 'native';
    if (document.pointerLockElement === surface) document.exitPointerLock();
  }

  function reset() {
    endDrag(true);
    displayPosition = targetPosition = travel * 0.14;
    controlPosition = toControlPosition(displayPosition, travel);
    lastTime = performance.now();
    render();
  }

  surface.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
    endDrag(true);
    pointerId = event.pointerId;
    lastPointerX = event.clientX;
    mouseDrag = event.pointerType === 'mouse';
    surface.focus({ preventScroll: true });
    surface.dataset.dragging = 'true';
    if (mouseDrag) {
      event.preventDefault();
      lockedMouseScale = mouseCssScale * DEMO_SETTINGS.mouseGain;
      lastUnlockedMouseX = null;
      status.textContent = '';
      surface.dataset.inputMode = 'locking';
      lockPending = true;
      void lockMouse(++lockRequestId);
    } else {
      surface.setPointerCapture(pointerId);
      surface.dataset.inputMode = 'touch';
    }
  });
  surface.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    if (mouseDrag && (lockPending || document.pointerLockElement === surface)) {
      // Do not replay movement accumulated while permission was pending.
      lastPointerX = event.clientX;
      return;
    }
    moveBy(event.clientX - lastPointerX);
    lastPointerX = event.clientX;
  });
  surface.addEventListener('pointerup', event => {
    if (event.pointerId !== pointerId) return;
    if (!mouseDrag || (!lockPending && document.pointerLockElement !== surface)) moveBy(event.clientX - lastPointerX);
    endDrag();
  });
  surface.addEventListener('pointercancel', event => {
    if (mouseDrag && (lockPending || document.pointerLockElement === surface)) return;
    if (event.pointerId === pointerId) endDrag(true);
  });
  surface.addEventListener('lostpointercapture', event => {
    if (mouseDrag && (lockPending || document.pointerLockElement === surface)) return;
    if (event.pointerId === pointerId) endDrag(true);
  });
  document.addEventListener('mousemove', event => {
    if (mouseDrag && document.pointerLockElement === surface) {
      moveBy(event.movementX * lockedMouseScale);
    } else if (!mouseDrag) {
      measureMouseScale(event);
    }
  });
  document.addEventListener('mouseup', event => {
    if (event.button === 0 && mouseDrag) endDrag();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === surface) {
      if (!mouseDrag) return document.exitPointerLock();
      lockPending = false;
      surface.dataset.inputMode = 'relative';
    } else if (mouseDrag && !lockPending) {
      endDrag(true);
    }
  });
  document.addEventListener('pointerlockerror', () => {
    // Promise対応ブラウザーはlockMouseのcatchで処理する。
    if (lockUsesPromise) return;
    useBoundedMouse(lockRequestId);
  });
  surface.addEventListener('keydown', event => {
    if (event.key === 'Escape') return endDrag(true);
    if (event.key === 'Home') {
      event.preventDefault();
      reset();
      announce();
      return;
    }
    if (event.key === 'Shift') {
      advanceKeyboard(performance.now());
      keyboardFast = true;
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (event.repeat) return;
    if (pointerId !== null) endDrag(true);
    advanceKeyboard(performance.now());
    heldArrows.add(event.key);
    keyboardFast = event.shiftKey;
    announceWhenSettled = true;
    scheduleRender();
  });
  window.addEventListener('keyup', event => {
    if (event.key !== 'Shift' && !heldArrows.has(event.key)) return;
    advanceKeyboard(performance.now());
    heldArrows.delete(event.key);
    keyboardFast = event.shiftKey;
    advanceDisplay(performance.now());
    render();
    scheduleRender();
  });
  surface.addEventListener('blur', () => endDrag(true));
  root.querySelector<HTMLElement>('[data-reset-position]')!.addEventListener('click', () => {
    reset();
    status.textContent = '左側のはじめの位置に戻しました。中央の粘りエリアへ動かしてください。';
  });
  reducedMotion.addEventListener('change', () => {
    endDrag(true);
    root.querySelector<HTMLElement>('[data-reduced-note]')!.hidden = !(reducedMotion.matches && DEMO_SETTINGS.lagMs > 0);
  });
  window.addEventListener('blur', () => endDrag(true));
  window.addEventListener('pagehide', () => endDrag(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) endDrag(true);
  });
  root.querySelector<HTMLElement>('[data-demo-interactive]')!.hidden = false;
  root.querySelector<HTMLElement>('[data-demo-fallback]')!.hidden = true;
  surface.style.setProperty('--zone-start', `${DEMO_SETTINGS.start * 100}%`);
  surface.style.setProperty('--zone-width', `${(DEMO_SETTINGS.end - DEMO_SETTINGS.start) * 100}%`);
  travel = Math.max(0, surface.clientWidth - object.offsetWidth);
  reset();
  root.querySelector<HTMLElement>('[data-reduced-note]')!.hidden = !(reducedMotion.matches && DEMO_SETTINGS.lagMs > 0);
  new ResizeObserver(() => {
    const nextTravel = Math.max(0, surface.clientWidth - object.offsetWidth);
    if (nextTravel === travel) return;
    endDrag(true);
    const fraction = travel ? displayPosition / travel : 0.14;
    travel = nextTravel;
    displayPosition = targetPosition = fraction * travel;
    controlPosition = toControlPosition(displayPosition, travel);
    render();
  }).observe(surface);
  new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) endDrag(true);
  }).observe(root);
  root.dataset.initialized = 'true';
}
