import { BRAND } from '@bmpl/shared';

/**
 * Design tokens shared across web + admin (and available to mobile). Single
 * source for the Belize brand palette so the apps stay visually consistent.
 */
export const colors = BRAND.colors;

export const gradients = {
  hero: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #3b82f6 100%)',
  accent: 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)',
};

export const roleStatusColor: Record<string, { bg: string; fg: string }> = {
  APPROVED: { bg: '#dcfce7', fg: '#15803d' },
  PENDING: { bg: '#fef3c7', fg: '#b45309' },
  MORE_INFO_REQUIRED: { bg: '#dbeafe', fg: '#1d4ed8' },
  REJECTED: { bg: '#fee2e2', fg: '#b91c1c' },
  SUSPENDED: { bg: '#ffedd5', fg: '#c2410c' },
  REVOKED: { bg: '#e2e8f0', fg: '#334155' },
};

/**
 * Liquid Glass theme tokens -- the authenticated-platform redesign (web
 * dashboard + admin console only; public/marketing pages and the login
 * screens keep the existing light theme and are untouched). These are the
 * SAME numbers written as CSS custom properties in `glass.css`; exported
 * here too so a JS/TS consumer (a chart library config, a canvas overlay,
 * anything that can't read a CSS var) never has to hardcode a second copy.
 *
 * Every alpha value below was reached empirically, not guessed: the
 * hive/agents/bmpl-web-mtmd0uea/liquid-glass-preview prototype measured
 * real rendered pixels (see that folder's contrast-report.json) across
 * desktop/tablet/mobile and iterated until a DOM-derived sample set (every
 * visible text node, not a hand-picked list) cleared 4.5:1 everywhere,
 * including worst-case bright patches of the mural background. These are
 * the numbers that passed that measurement, carried over verbatim.
 */
export const glassTokens = {
  // Ambient glass fill: stays genuinely translucent (8-18% brief) because
  // legibility comes from local text scrims below, not from darkening the
  // whole panel -- the earlier panel-wide brightness() filter was tried
  // and explicitly rejected for trading away "the scene reads through".
  surfaceFill: 'rgba(146, 185, 230, 0.16)',
  surfaceFillLight: 'rgba(146, 185, 230, 0.12)',
  cardFill: 'rgba(158, 195, 235, 0.14)',
  pillFill: 'rgba(255, 255, 255, 0.13)',
  pillFillStrong: 'rgba(255, 255, 255, 0.2)',
  border: 'rgba(255, 255, 255, 0.32)',
  borderSoft: 'rgba(255, 255, 255, 0.16)',
  sheen: 'rgba(255, 255, 255, 0.22)',
  blur: '22px',
  blurLarge: '34px',
  backdropChrome: 'blur(22px) saturate(145%)',
  backdropCard: 'blur(18px) saturate(135%)',
  backdropDense: 'blur(26px) saturate(135%) brightness(0.88)',

  // Text-on-glass: the color itself never changes by position (the mural
  // is too variable to read against reliably with color alone) -- every
  // text run gets a local scrim (see `textScrim`) sized to the run, not
  // the panel, which is what makes the ratio hold regardless of which
  // mural patch it lands on.
  textOnGlass: '#f4f8ff',
  textOnGlassMuted: 'rgba(244, 248, 255, 0.82)',
  textOnGlassFaint: 'rgba(244, 248, 255, 0.64)',
  textScrim: 'rgba(4, 10, 20, 0.42)',
  textScrimStrong: 'rgba(4, 10, 20, 0.6)',
  rowScrim: 'rgba(4, 10, 20, 0.42)',
  overlayFill: 'rgba(10, 20, 38, 0.56)',

  glowLift: '0 0 32px rgba(96, 165, 250, 0.22)',
  shadow: '0 18px 50px -20px rgba(2, 8, 20, 0.65), 0 2px 10px -4px rgba(2, 8, 20, 0.4)',
  shadowSmall: '0 8px 24px -12px rgba(2, 8, 20, 0.55), 0 0 20px rgba(96, 165, 250, 0.14)',

  // Focus ring: visible-on-glass needs more than the flat theme's single
  // ring color, because a mid-tone ring can wash out against a bright
  // mural patch the same way plain text did. Two-layer ring (dark halo +
  // bright core) holds contrast against both ends of the mural's range.
  focusRingCore: '#7dd3fc',
  focusRingHalo: 'rgba(4, 10, 20, 0.85)',

  motionFast: '120ms',
  motionBase: '200ms',
  motionSlow: '320ms',
} as const;
