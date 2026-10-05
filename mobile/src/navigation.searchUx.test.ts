import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CommonActions, TabRouter } from '@react-navigation/routers';
import { navigateToSearch } from './navigationActions';

const source = readFileSync(fileURLToPath(new URL('./navigation.tsx', import.meta.url)), 'utf8');

describe('native navigation search placement', () => {
  it('keeps SearchTab route identity in the exact middle bottom-tab position', () => {
    const tabNames = [...source.matchAll(/<Tab\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);

    expect(tabNames.slice(0, 5)).toEqual([
      'HomeTab',
      'DiscoverTab',
      'SearchTab',
      'RadioTab',
      'LibraryTab',
    ]);
    expect(tabNames.indexOf('SearchTab')).toBe(Math.floor(tabNames.slice(0, 5).length / 2));
    expect(source).toContain("tabBarButtonTestID: 'tab-search'");
    expect(source).toContain('tabBarAccessibilityLabel: strings.navigation.search');
  });

  it('selects the Search tab while preserving the Home detail stack', () => {
    const router = TabRouter({ initialRouteName: 'HomeTab' });
    const config = {
      routeNames: ['HomeTab', 'DiscoverTab', 'SearchTab', 'RadioTab', 'LibraryTab'],
      routeParamList: {},
      routeGetIdList: {},
    };
    const initial = router.getInitialState(config);
    const home = {
      ...initial.routes[0],
      state: {
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'Album', params: { albumId: '123', title: 'Current album' } },
        ],
      },
    };
    const current = { ...initial, routes: [home, ...initial.routes.slice(1)] };
    let next = current;

    navigateToSearch({
      navigate: (route, params) => {
        expect(route).toBe('Tabs');
        const result = router.getStateForAction(
          current,
          CommonActions.navigate(params.screen, params.params),
          config,
        );
        expect(result).not.toBeNull();
        next = result as typeof current;
      },
    });

    expect(next.routes[next.index]).toMatchObject({
      name: 'SearchTab',
      params: { screen: 'Search' },
    });
    expect(next.routes[0]).toBe(home);
  });
});
