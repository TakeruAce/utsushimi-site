/** One optional, user-initiated transition from the intro to the company site. */
export function initializeIntroSnap(
  intro: HTMLElement,
  company: HTMLElement,
  reduced: MediaQueryList,
  headerOffset: () => number = () => 0,
): () => void {
  type State = 'idle' | 'armed' | 'snapping' | 'settled' | 'cancelled' | 'disabled';
  let state: State = 'idle';
  let disposed = false;
  let frame = 0;
  let previousY = window.scrollY;
  let topIntent = false;
  let intentUntil = 0;
  let focusOnArrival = false;
  let targetY = 0;
  let startedAt = 0;
  let movedAt = 0;
  let touch: { x: number; y: number } | null = null;
  const previousState = intro.getAttribute('data-snap-state');

  const now = () => performance.now();
  const introTop = () => intro.getBoundingClientRect().top + window.scrollY;
  const destination = () => company.getBoundingClientRect().top + window.scrollY - headerOffset();
  const atStart = () => window.scrollY <= introTop() + 16;
  const threshold = () => Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight) * 0.28;

  function setState(next: State) {
    state = next;
    intro.dataset.snapState = next;
  }

  function instant(top: number) {
    // `auto` can inherit the site's CSS smooth scrolling; `instant` also aborts it.
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  }

  function interrupt(next: State = 'cancelled') {
    if (state === 'snapping') instant(window.scrollY);
    topIntent = false;
    intentUntil = 0;
    focusOnArrival = false;
    setState(reduced.matches ? 'disabled' : next);
    previousY = window.scrollY;
  }

  function queueTick() {
    if (!disposed && !frame) frame = requestAnimationFrame(tick);
  }

  function settle() {
    setState('settled');
    if (focusOnArrival) company.focus({ preventScroll: true });
    focusOnArrival = false;
  }

  function beginSnap(explicit = false) {
    if (disposed || !company.isConnected || (!explicit && reduced.matches)) return;
    if (state === 'snapping') instant(window.scrollY);
    topIntent = false;
    intentUntil = 0;
    focusOnArrival = explicit;
    targetY = Math.max(0, destination());
    previousY = window.scrollY;
    if (reduced.matches || Math.abs(targetY - previousY) <= 2) {
      instant(targetY);
      settle();
      return;
    }
    startedAt = movedAt = now();
    setState('snapping');
    window.scrollTo({ top: targetY, behavior: 'smooth' });
    queueTick();
  }

  function tick() {
    frame = 0;
    if (disposed) return;
    const y = window.scrollY;
    const delta = y - previousY;
    previousY = y;

    if (state === 'snapping') {
      if (reduced.matches || !company.isConnected) {
        interrupt();
        return;
      }
      const time = now();
      const freshTarget = Math.max(0, destination());
      if (Math.abs(freshTarget - targetY) > 2) {
        targetY = freshTarget;
        movedAt = time;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      } else if (delta < -2 && targetY > y + 2) {
        // Covers upward scrollbar/assistive scrolling as well as input events.
        interrupt();
        return;
      }
      if (Math.abs(delta) > 0.25) movedAt = time;
      if (Math.abs(y - targetY) <= 2) {
        instant(targetY);
        settle();
        return;
      }
      // Never keep consuming input if the browser cancels or cannot finish.
      if (time - startedAt > 1800 || (time - startedAt > 250 && time - movedAt > 200)) {
        interrupt();
        return;
      }
      queueTick();
      return;
    }

    if (reduced.matches) return;
    if (atStart()) {
      if (state !== 'armed') {
        topIntent = false;
        intentUntil = 0;
        setState('armed');
      }
      return;
    }
    if (state !== 'armed') return;
    if (delta < -2 || !topIntent || now() > intentUntil) {
      interrupt('idle');
      return;
    }
    if (delta > 0 && y - introTop() >= threshold()) {
      if (destination() > y + 2) beginSnap();
      else setState('settled');
    }
  }

  function downwardIntent() {
    if (reduced.matches) return;
    if (atStart() && state !== 'snapping') setState('armed');
    if (state !== 'armed') return;
    if (!topIntent && !atStart()) return;
    topIntent = true;
    intentUntil = now() + 1200;
  }

  function nestedScroller(target: EventTarget | null, direction: number) {
    let element = target instanceof Element ? target : null;
    while (element && element !== document.body && element !== document.documentElement) {
      const style = getComputedStyle(element);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
        if (direction > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 1) return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  function onWheel(event: WheelEvent) {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      if (state === 'snapping') interrupt();
      return;
    }
    if (Math.abs(event.deltaY) < 0.5) return;
    if (nestedScroller(event.target, event.deltaY)) {
      if (state === 'snapping') interrupt();
      return;
    }
    if (event.deltaY < 0) {
      interrupt();
    } else if (state === 'snapping') {
      // Only absorb the continuing downward gesture during this bounded snap.
      if (event.cancelable) event.preventDefault();
    } else downwardIntent();
  }

  function onTouchStart(event: TouchEvent) {
    if (state === 'snapping') interrupt();
    touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }

  function onTouchMove(event: TouchEvent) {
    if (event.defaultPrevented || !touch || event.touches.length !== 1) return;
    const current = event.touches[0];
    const dy = touch.y - current.clientY;
    const dx = touch.x - current.clientX;
    touch = { x: current.clientX, y: current.clientY };
    if (Math.abs(dy) < 2 || Math.abs(dx) > Math.abs(dy)) return;
    if (nestedScroller(event.target, dy)) {
      if (state === 'snapping') interrupt();
      return;
    }
    if (dy < 0) interrupt();
    else if (state === 'snapping') {
      if (event.cancelable) event.preventDefault();
    } else downwardIntent();
  }

  const onTouchEnd = () => { touch = null; };
  const onPointerDown = () => { if (state === 'snapping') interrupt(); };

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (['Escape', 'ArrowUp', 'PageUp', 'Home', 'End', 'Tab'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
      interrupt();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowDown', 'PageDown', ' '].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="tablist"], [role="listbox"], [role="combobox"], video, audio') || nestedScroller(event.target, 1)) return;
    if (state === 'snapping') event.preventDefault();
    else downwardIntent();
  }

  function onClick(event: MouseEvent) {
    if (event.defaultPrevented) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor) return;
    const plainClick = event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (plainClick && intro.contains(anchor) && company.id && anchor.getAttribute('href') === `#${company.id}` && !anchor.hasAttribute('download') && (!anchor.target || anchor.target === '_self')) {
      event.preventDefault();
      beginSnap(true);
    } else interrupt('idle');
  }

  const onNavigation = () => interrupt('idle');
  const onReducedChange = () => { interrupt(reduced.matches ? 'disabled' : 'idle'); queueTick(); };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queueTick) : null;
  resizeObserver?.observe(intro);
  resizeObserver?.observe(company);
  if (document.body) resizeObserver?.observe(document.body);

  setState(reduced.matches ? 'disabled' : atStart() ? 'armed' : 'idle');
  window.addEventListener('scroll', queueTick, { passive: true });
  window.addEventListener('resize', queueTick, { passive: true });
  window.visualViewport?.addEventListener('resize', queueTick);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onClick, true);
  window.addEventListener('hashchange', onNavigation);
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('pageshow', onNavigation);
  reduced.addEventListener('change', onReducedChange);

  return () => {
    if (disposed) return;
    interrupt('idle');
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    window.removeEventListener('scroll', queueTick);
    window.removeEventListener('resize', queueTick);
    window.visualViewport?.removeEventListener('resize', queueTick);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('hashchange', onNavigation);
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('pageshow', onNavigation);
    reduced.removeEventListener('change', onReducedChange);
    if (previousState === null) intro.removeAttribute('data-snap-state');
    else intro.setAttribute('data-snap-state', previousState);
  };
}
