/** Production brand tokens shared by every native surface. */
export const colors = {
  background: '#0a0a14',
  backgroundElevated: '#11111d',
  surface: '#14141f',
  surfaceElevated: '#1a1a28',
  surfacePressed: '#1e1e2c',
  textPrimary: '#f3f3f6',
  textSecondary: '#a0a0ad',
  accent: '#7c5cff',
  accentPressed: '#9277ff',
  accentSoft: '#b9a8ff',
  onAccent: '#ffffff',
  border: '#2a2a3b',
  success: '#55d6a2',
  warning: '#f6c768',
  danger: '#ff7184',
} as const;

export const metrics = {
  minimumTouchTarget: 48,
} as const;
