/** The first prototype remains selectable; saved v1 tuning is never overwritten. */
export const CLASSIC_DEFAULTS = {
  mass: 1, thrust: 30, rotationTorque: 7, angularDamping: 0.65,
  fuelCapacity: 1.8, fuelRegen: 0.9, wingDrag: 5, jointStrength: 1,
  balance: 1, friction: 0.85, crashThreshold: 4.8,
  flightAssist: 0, turnSpeed: 110, turnBraking: 9, tiltLimit: 50,
  airDrag: 0, viewScale: 1,
};

export const DEFAULTS = {
  ...CLASSIC_DEFAULTS,
  thrust: 26, rotationTorque: 12, angularDamping: 0.85,
  fuelCapacity: 1.6, fuelRegen: 1.4, wingDrag: 6, crashThreshold: 8,
  flightAssist: 1, airDrag: 1.5, viewScale: 0.7,
};
export type Settings = typeof DEFAULTS;
type Control = { key: keyof Settings; label: string; min: number; max: number; step: number; unit: string };
export const CONTROLS: Control[] = [
  { key: 'flightAssist', label: 'Guided flight (0 off / 1 on)', min: 0, max: 1, step: 1, unit: '' },
  { key: 'turnSpeed', label: 'Maximum turn speed', min: 40, max: 300, step: 5, unit: '°/s' },
  { key: 'tiltLimit', label: 'Maximum lean', min: 25, max: 80, step: 5, unit: '°' },
  { key: 'turnBraking', label: 'Turn braking', min: 1, max: 16, step: 0.5, unit: 's⁻¹' },
  { key: 'viewScale', label: 'Camera zoom', min: 0.55, max: 1.1, step: 0.05, unit: '×' },
  { key: 'thrust', label: 'Jet strength', min: 20, max: 44, step: 1, unit: 'm/s²' },
  { key: 'rotationTorque', label: 'Steering strength', min: 2, max: 14, step: 0.5, unit: 'N·m' },
  { key: 'airDrag', label: 'Air resistance', min: 0, max: 2, step: 0.1, unit: 's⁻¹' },
  { key: 'fuelCapacity', label: 'Fuel capacity', min: 0.5, max: 3.5, step: 0.1, unit: 's' },
  { key: 'fuelRegen', label: 'Refill rate', min: 0.2, max: 2, step: 0.1, unit: 's/s' },
  { key: 'wingDrag', label: 'Wing resistance', min: 1, max: 10, step: 0.5, unit: 's⁻¹' },
  { key: 'balance', label: 'Balance assist', min: 0, max: 2, step: 0.1, unit: '×' },
  { key: 'jointStrength', label: 'Joint strength', min: 0.2, max: 2, step: 0.1, unit: '×' },
  { key: 'mass', label: 'Body mass', min: 0.5, max: 2, step: 0.1, unit: '×' },
  { key: 'angularDamping', label: 'Angular damping', min: 0, max: 2, step: 0.05, unit: '' },
  { key: 'friction', label: 'Surface friction', min: 0.1, max: 1.4, step: 0.05, unit: '' },
  { key: 'crashThreshold', label: 'Impact tolerance', min: 2, max: 12, step: 0.5, unit: 'm/s' },
];

export function validateSettings(data: unknown): Partial<Settings> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Choose a valid tuning preset.');
  const result: Partial<Settings> = {};
  for (const c of CONTROLS) {
    const value = (data as Record<string, unknown>)[c.key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < c.min || value > c.max || (c.key === 'flightAssist' && value !== 0 && value !== 1))
      throw new Error(`${c.label} must be between ${c.min} and ${c.max}.`);
    result[c.key] = value;
  }
  if (!Object.keys(result).length) throw new Error('No physics settings found in this file.');
  return result;
}

export function importSettings(data: unknown): Settings {
  const record = data as { format?: unknown; settings?: unknown } | null;
  const partial = validateSettings(record?.settings ?? data);
  const legacy = record?.format === 'jetshoes-fairy-tuning-v1' || partial.flightAssist === undefined;
  return { ...(legacy ? CLASSIC_DEFAULTS : DEFAULTS), ...partial };
}

export const PRESETS = {
  flow: DEFAULTS,
  classic: CLASSIC_DEFAULTS,
  training: { ...DEFAULTS, turnSpeed: 85, tiltLimit: 40, turnBraking: 12, wingDrag: 7, balance: 1.5, jointStrength: 1.3, fuelCapacity: 1.9 },
  chaos: { ...CLASSIC_DEFAULTS, rotationTorque: 10, balance: 0.5, jointStrength: 0.65, thrust: 35, viewScale: 0.7 },
};
