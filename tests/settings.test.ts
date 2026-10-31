import { describe, it, expect } from 'vitest';
import { CLASSIC_DEFAULTS, DEFAULTS, importSettings, validateSettings } from '../src/game/settings';

describe('tuning compatibility', () => {
  it('imports an old exported preset with Classic control and camera semantics', () => {
    const old = { format: 'jetshoes-fairy-tuning-v1', settings: { thrust: 33, balance: 1.4, rotationTorque: 4 } };
    const result = importSettings(old);
    expect(result.thrust).toBe(33); expect(result.balance).toBe(1.4);
    expect(result.flightAssist).toBe(0); expect(result.airDrag).toBe(0); expect(result.viewScale).toBe(1);
    expect(old.settings).toEqual({ thrust: 33, balance: 1.4, rotationTorque: 4 });
  });

  it('imports raw legacy local settings without losing values', () => {
    const result = importSettings({ thrust: 34, fuelCapacity: 2.2 });
    expect(result).toEqual({ ...CLASSIC_DEFAULTS, thrust: 34, fuelCapacity: 2.2 });
  });

  it('round-trips a new Flow preset including its steering and view settings', () => {
    const settings = { ...DEFAULTS, tiltLimit: 40, viewScale: 0.6 };
    expect(importSettings({ format: 'jetshoes-fairy-tuning-v2', settings })).toEqual(settings);
  });

  it('rejects nonfinite and out-of-range values and fractional assist modes', () => {
    for (const invalid of [{ turnSpeed: Infinity }, { viewScale: 0 }, { turnBraking: -1 }, { flightAssist: 0.5 }])
      expect(() => validateSettings(invalid)).toThrow();
  });
});
