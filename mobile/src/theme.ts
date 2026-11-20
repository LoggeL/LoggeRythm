/**
 * Theme v2 — the single source of visual truth for the native app, aligned
 * with the redesigned web app (web/src/app/globals.css). Screens and
 * components must take every colour, font size, radius, spacing step and
 * shell metric from here; see docs/DESIGN_SYSTEM.md for the rules.
 */
export const colors = {
  /** Behind everything: tab bar, system bars, modal scrims' base. */
  backdrop: '#050608',
  /** Default screen background. */
  background: '#0c0d11',
  backgroundElevated: '#12141a',
  /** Cards, rows, inputs. */
  surface: '#171a21',
  /** Floating surfaces: mini player, sheets, menus, pressed cards. */
  surfaceElevated: '#20242d',
  surfacePressed: '#2a2f3a',
  /** Translucent white fills for neutral controls (web `.action-secondary`, `.filter-chip`). */
  fill: 'rgba(255,255,255,0.07)',
  fillStrong: 'rgba(255,255,255,0.12)',
  textPrimary: '#f4f4f7',
  textSecondary: '#a0a4b2',
  /** Tertiary copy. Still >= 4.5:1 on every surface up to surfaceElevated. */
  textMuted: '#8a8fa0',
  accent: '#8f73ff',
  accentSolid: '#7a5cf5',
  accentPressed: '#6a4ee0',
  accentSoft: '#c3b5ff',
  accentSubtle: '#262040',
  /** Logo fill and the "Rythm" half of the wordmark (web --brand / web/public/Logo.svg). */
  brand: '#d6ff4b',
  /** Ink on accent / accentSolid fills (dark, like the web play FAB). */
  onAccent: '#050308',
  /** Ink on light (textPrimary) fills such as the primary ActionButton. */
  onLight: '#0b0c10',
  border: '#272b35',
  borderSubtle: '#1f232c',
  /** 1px separators and card outlines. Not a hex: never feed it to contrast maths. */
  hairline: 'rgba(255,255,255,0.07)',
  scrim: 'rgba(5,6,8,0.72)',
  success: '#5fd6a0',
  successSubtle: '#143a2e',
  warning: '#f6c768',
  warningSubtle: '#3d321b',
  danger: '#ff7a8a',
  dangerSubtle: '#3a1f27',
} as const;

export type ColorToken = keyof typeof colors;

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
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  /** Content cards and artwork tiles (web --radius-card). */
  card: 14,
  /** Panels and the mini player (web --radius-panel). */
  panel: 18,
  /** Top corners of bottom sheets and dialogs. */
  sheet: 28,
  pill: 999,
} as const;

/**
 * The complete type scale. Spread a token into a style (`...typography.body`)
 * or use `<AppText variant="body">`. Never write a literal fontSize.
 */
export const typography = {
  /** Splash / marketing numerals. */
  display: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -1.2 },
  /** Large screen titles (ScreenHeader) and detail heroes. */
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.9 },
  /** Dialog / sheet / state titles. */
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 },
  /** Section headings inside a screen. */
  section: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  /** Row titles, emphasised body copy. */
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  /** Secondary lines: artists, descriptions, status text. */
  callout: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  /** Metadata, timestamps, counts. */
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  /** Buttons, chips, links. */
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  /** Tab bar labels and badges. */
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.1 },
  /** Uppercase eyebrow above titles. */
  overline: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Opacity applied to a control while pressed or disabled. */
export const opacity = {
  pressed: 0.72,
  disabled: 0.4,
} as const;

/**
 * Elevation presets. Android reads `elevation`; the shadow* keys keep iOS/web
 * previews coherent. Spread into a style: `...elevation.floating`.
 */
export const elevation = {
  none: { elevation: 0 },
  card: {
    elevation: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  floating: {
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  sheet: {
    elevation: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -6 },
  },
} as const;

export type ElevationLevel = keyof typeof elevation;

export const metrics = {
  minimumTouchTarget: 48,
  pagePadding: spacing.lg,
  tabBarHeight: 64,
  miniPlayerSurfaceHeight: 64,
  miniPlayerGap: spacing.xs,
  /** Profile avatar in the stack headers, centred in a minimumTouchTarget button. */
  headerAvatar: 36,
  /** Outer diameter of a notification dot, ring included. */
  badgeDot: 12,
  /** Ring in the surrounding background that separates a dot from photos. */
  badgeDotRing: 2,
} as const;

/** Shell and rhythm metrics shared by every screen. */
export const layout = {
  /** Horizontal page gutter. */
  pagePadding: metrics.pagePadding,
  /** Bottom tab bar content height, without the bottom safe-area inset. */
  tabBarHeight: metrics.tabBarHeight,
  /** Space the floating mini player occupies above the tab bar (surface + gap). */
  miniPlayerHeight: metrics.miniPlayerSurfaceHeight + metrics.miniPlayerGap,
  /** Vertical gap between the sections of a screen. */
  sectionGap: spacing.xxl,
  /** Gap between a section header and its content. */
  headerGap: spacing.sm,
  /** Gap between cards in a horizontal rail or grid. */
  railGap: spacing.sm,
  /** Gap between stacked controls / paragraphs. */
  stackGap: spacing.md,
  /** Breathing room below the last item of a scroll view (added by useBottomInset). */
  scrollEndGap: spacing.xl,
  /** Height of a standard track / list row. */
  rowHeight: 64,
  /** Artwork edge lengths. */
  artwork: { xs: 40, sm: 48, md: 56, lg: 96, card: 148, hero: 220 },
} as const;
