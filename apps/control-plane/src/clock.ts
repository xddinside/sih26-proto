/**
 * Injectable clock so schedule evaluation, lease expiry, and freshness checks
 * are deterministic in tests. Production code uses the wall clock; tests
 * inject a fixed one.
 */
export interface Clock {
  now(): Date
  nowIso(): string
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
}

export function fixedClock(iso: string): Clock {
  const at = new Date(iso)
  return {
    now: () => new Date(at.getTime()),
    nowIso: () => new Date(at.getTime()).toISOString(),
  }
}

export function advanceClock(clock: Clock, seconds: number): Clock {
  return {
    now: () => new Date(clock.now().getTime() + seconds * 1000),
    nowIso: () => new Date(clock.now().getTime() + seconds * 1000).toISOString(),
  }
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString()
}
