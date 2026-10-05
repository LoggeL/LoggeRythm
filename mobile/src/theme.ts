/** Shared native tokens keep navigation, content, and playback surfaces coherent. */
export const colors = {
  background: '#0b0c10',
  backgroundElevated: '#111318',
  surface: '#15171e',
  surfaceElevated: '#1d2029',
  surfacePressed: '#252933',
  textPrimary: '#f5f5f7',
  textSecondary: '#969aa8',
  textMuted: '#858b9a',
  accent: '#7c5cff',
  accentSolid: '#7452ed',
  accentPressed: '#6b4be8',
  accentSoft: '#c1b2ff',
  accentSubtle: '#27203e',
  onAccent: '#ffffff',
  border: '#252933',
  borderSubtle: '#20232c',
  success: '#55d6a2',
  successSubtle: '#153b30',
  warning: '#f6c768',
  warningSubtle: '#3d321b',
  danger: '#ff7184',
  dangerSubtle: '#40232c',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.9 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6 },
  section: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
} as const;

export const metrics = {
  minimumTouchTarget: 48,
  pagePadding: spacing.lg,
  tabBarHeight: 56,
  miniPlayerSurfaceHeight: 64,
  miniPlayerGap: spacing.xs,
} as const;
