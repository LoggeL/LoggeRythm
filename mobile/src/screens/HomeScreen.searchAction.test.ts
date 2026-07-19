import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const homeSource = readFileSync(fileURLToPath(new URL('./HomeScreen.tsx', import.meta.url)), 'utf8');
const modelSource = readFileSync(fileURLToPath(new URL('./homeModel.ts', import.meta.url)), 'utf8');

describe('HomeScreen search action', () => {
  it('adds a small accessible loupe action in the hero with a 48dp touch target', () => {
    expect(homeSource).toContain('testID="home-search-action"');
    expect(homeSource).toContain('accessibilityRole="button"');
    expect(homeSource).toContain('accessibilityLabel={strings.navigation.search}');
    expect(homeSource).toContain('onPress={onOpenSearch}');
    expect(homeSource).toContain('name="magnify"');
    expect(homeSource).toContain('width: metrics.minimumTouchTarget');
    expect(homeSource).toContain('height: metrics.minimumTouchTarget');
  });

  it('requires the route callback so navigation integration cannot be omitted', () => {
    expect(modelSource).toContain('onOpenSearch: () => void;');
    expect(modelSource).toContain("typeof (value as Partial<HomeRouteCallbacks>).onOpenSearch !== 'function'");
  });
});
