import { describe, expect, it, vi } from 'vitest';
import AppIcon from './AppIcon';

vi.mock('react-native', () => ({ Text: 'Text' }));

describe('AppIcon', () => {
  it('renders a bundled Material Design glyph as decorative text', () => {
    const icon = AppIcon({ name: 'play', color: '#fff', size: 20, testID: 'play-icon' });

    expect(icon.type).toBe('Text');
    expect(icon.props.accessible).toBe(false);
    expect(icon.props.allowFontScaling).toBe(false);
    expect(icon.props.importantForAccessibility).toBe('no');
    expect(icon.props.testID).toBe('play-icon');
    expect(icon.props.style[0]).toEqual({
      color: '#fff',
      fontFamily: 'MaterialDesignIcons',
      fontSize: 20,
      fontStyle: 'normal',
      fontWeight: 'normal',
      lineHeight: 20,
    });
    expect(Array.from(icon.props.children as string)).toHaveLength(1);
  });

  it('maps distinct semantic icon names to distinct bundled code points', () => {
    const play = AppIcon({ name: 'play' });
    const pause = AppIcon({ name: 'pause' });

    expect(play.props.children).not.toEqual(pause.props.children);
  });
});
