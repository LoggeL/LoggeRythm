import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocaleHydrationGate from './LocaleHydrationGate';

const mocks = vi.hoisted(() => ({ ready: false }));

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'de',
    ready: mocks.ready,
    selectLocale: vi.fn(),
  }),
}));

describe('LocaleHydrationGate', () => {
  beforeEach(() => {
    mocks.ready = false;
  });

  it('does not mount locale-dependent children while hydration is pending', () => {
    const fallback = React.createElement('Fallback', { testID: 'locale-pending' });
    const child = React.createElement('PlayerAndAutoChildren', { testID: 'localized-app' });

    const tree = LocaleHydrationGate({ fallback, children: child });

    expect(tree.props.children).toBe(fallback);
    expect(tree.props.children).not.toBe(child);
  });

  it('releases the same children only after hydration becomes ready', () => {
    mocks.ready = true;
    const fallback = React.createElement('Fallback', { testID: 'locale-pending' });
    const child = React.createElement('PlayerAndAutoChildren', { testID: 'localized-app' });

    const tree = LocaleHydrationGate({ fallback, children: child });

    expect(tree.props.children).toBe(child);
  });
});
