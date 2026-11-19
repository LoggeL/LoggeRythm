/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  setState: vi.fn(),
  openURL: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useState: () => [mocks.state, mocks.setState],
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: mocks.openURL },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

import { AndroidReleaseLink } from './AndroidReleaseLink';
import { strings } from '../../localization';
import { metrics } from '../../theme';
import { byTestId, flatStyle, queryByTestId, textContent } from '../../test/render';

const URL = 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.16';

function render() {
  return AndroidReleaseLink({ url: URL, label: 'Full changelog', testID: 'release-link' });
}

describe('AndroidReleaseLink', () => {
  beforeEach(() => {
    mocks.state = null;
    mocks.setState.mockClear();
    mocks.openURL.mockReset();
  });

  it('is a labelled 48dp button that opens the release page', async () => {
    mocks.openURL.mockResolvedValue(true);
    const tree = render();
    const button = byTestId(tree, 'release-link');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Full changelog');
    const style = flatStyle(button.props.style);
    expect(style.minHeight).toBe(metrics.minimumTouchTarget);
    expect(style.minWidth).toBe(metrics.minimumTouchTarget);
    (button.props.onPress as () => void)();
    expect(mocks.openURL).toHaveBeenCalledExactlyOnceWith(URL);
    expect(mocks.setState).toHaveBeenCalledExactlyOnceWith(null);
    await Promise.resolve();
    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(queryByTestId(tree, 'release-link-error')).toBeNull();
  });

  it('keeps a rejected open as a visible failure', async () => {
    mocks.openURL.mockRejectedValue(new Error('No activity found to handle Intent'));
    (byTestId(render(), 'release-link').props.onPress as () => void)();
    await vi.waitFor(() => expect(mocks.setState).toHaveBeenCalledTimes(2));
    expect(mocks.setState).toHaveBeenLastCalledWith(expect.objectContaining({
      code: null,
      message: 'No activity found to handle Intent',
    }));
  });

  it('shows the failure and its raw detail', () => {
    mocks.state = { code: null, message: 'No activity found to handle Intent', httpStatus: null };
    const tree = render();
    const error = byTestId(tree, 'release-link-error');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(textContent(error)).toEqual([strings.profile.update.errors.linkFailed]);
    expect(textContent(byTestId(tree, 'release-link-error-detail'))).toEqual([
      strings.profile.update.detail('error', 'No activity found to handle Intent'),
    ]);
  });
});
