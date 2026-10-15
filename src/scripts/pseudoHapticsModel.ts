/** Restore the original spatial demo: light C/D resistance plus viscous following. */
export const DEMO_SETTINGS = {
  start: 0.34,
  end: 0.66,
  cdRatio: 1.5,
  mouseGain: 1,
  keySpeed: 240,
  boundaryWidth: 0,
  lagMs: 220,
};

export function clampPosition(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const smoothStep = (value: number) => value * value * (3 - 2 * value);

export function resistanceAt(position: number, travel: number): number {
  if (travel <= 0) return 0;
  const edge = Math.min(DEMO_SETTINGS.boundaryWidth, (DEMO_SETTINGS.end - DEMO_SETTINGS.start) / 2);
  const relative = position / travel;
  if (relative <= DEMO_SETTINGS.start || relative >= DEMO_SETTINGS.end) return 0;
  if (edge <= 0) return 1;
  return smoothStep(clampPosition(Math.min(relative - DEMO_SETTINGS.start, DEMO_SETTINGS.end - relative) / edge, 0, 1));
}

/** Integrating resistance keeps input mapping independent of event subdivision. */
export function resistanceIntegral(relative: number): number {
  const length = DEMO_SETTINGS.end - DEMO_SETTINGS.start;
  const edge = Math.min(DEMO_SETTINGS.boundaryWidth, length / 2);
  const distance = clampPosition(relative - DEMO_SETTINGS.start, 0, length);
  if (edge <= 0) return distance;
  if (distance < edge) {
    const t = distance / edge;
    return edge * (t ** 3 - t ** 4 / 2);
  }
  if (distance <= length - edge) return distance - edge / 2;
  if (distance < length) {
    const t = (distance - length + edge) / edge;
    return length - 1.5 * edge + edge * (t - t ** 3 + t ** 4 / 2);
  }
  return length - edge;
}

export function toControlPosition(position: number, travel: number): number {
  if (travel <= 0) return 0;
  const relative = clampPosition(position / travel, 0, 1);
  return travel * (relative + (DEMO_SETTINGS.cdRatio - 1) * resistanceIntegral(relative));
}

export function toDisplayPosition(control: number, travel: number): number {
  if (travel <= 0) return 0;
  const bounded = clampPosition(control, 0, toControlPosition(travel, travel));
  let low = 0, high = travel;
  for (let iteration = 0; iteration < 36; iteration++) {
    const middle = (low + high) / 2;
    if (toControlPosition(middle, travel) < bounded) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Exponential following: lagMs is a response time constant, not a fixed delay. */
export function followPosition(current: number, target: number, deltaMs: number, lagMs: number): number {
  if (!Number.isFinite(lagMs) || lagMs <= 0) return target;
  const elapsed = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  return current + (target - current) * -Math.expm1(-elapsed / lagMs);
}

/** Lag eases in over 6% of the track, independently of the spatial C/D mapping. */
export function lagStrengthAt(position: number, travel: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(travel) || travel <= 0) return 0;
  const relative = position / travel;
  return smoothStep(clampPosition(Math.min(relative - DEMO_SETTINGS.start, DEMO_SETTINGS.end - relative) / 0.06, 0, 1));
}

/** Include the whole path so a large pointer event cannot skip the viscous area. */
export function sweptLagStrength(from: number, to: number, travel: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(travel) || travel <= 0) return 0;
  const start = (DEMO_SETTINGS.start + 0.06) * travel;
  const end = (DEMO_SETTINGS.end - 0.06) * travel;
  if (Math.min(from, to) <= end && Math.max(from, to) >= start) return 1;
  return Math.max(lagStrengthAt(from, travel), lagStrengthAt(to, travel));
}
