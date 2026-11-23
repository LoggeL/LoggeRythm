import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateLocale, strings } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { byTestId, byType, queryByTestId, textContent } from '../../test/render';
import { RadioHero } from './RadioHero';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

afterEach(() => {
  activateLocale('de');
});

describe('RadioHero', () => {
  it('titles the screen and stays quiet when no radio is loaded', () => {
    const tree = RadioHero({ onAir: null });

    expect(byTestId(tree, 'radio-hero')).toBeDefined();
    expect(byType(tree, 'Text').find((text) => text.props.accessibilityRole === 'header')?.props.children)
      .toBe(strings.radio.title);
    expect(queryByTestId(tree, 'radio-on-air')).toBeNull();
  });

  it.each(['de', 'en'] as const)('names the station that is on air in %s', (locale) => {
    activateLocale(locale);
    const tree = RadioHero({ onAir: { label: 'Chill radio', playing: true } });
    const onAir = byTestId(tree, 'radio-on-air');

    expect(onAir.props.accessibilityLiveRegion).toBe('polite');
    expect(textContent(onAir)).toContain(accountStrings.radio.onAirStation('Chill radio'));
  });

  it('does not invent a station name for a legacy radio queue', () => {
    const tree = RadioHero({ onAir: { label: null, playing: false } });
    expect(textContent(byTestId(tree, 'radio-on-air'))).toContain(accountStrings.radio.onAirUnnamed);
  });

  it('shows paused status instead of "On air" when a named radio queue is paused', () => {
    const tree = RadioHero({ onAir: { label: 'Chill radio', playing: false } });
    const pill = byTestId(tree, 'radio-on-air');
    expect(textContent(pill)).toContain(`${strings.trackPresentation.paused}: Chill radio`);
    expect(textContent(pill)).not.toContain(accountStrings.radio.onAirStation('Chill radio'));
  });
});
