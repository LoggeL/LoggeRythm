export interface SearchTabNavigator {
  navigate(
    route: 'Tabs',
    params: { screen: 'SearchTab'; params: { screen: 'Search' } },
  ): void;
}

/** Search belongs to its own tab, so opening it preserves the Home stack. */
export function navigateToSearch(navigation: SearchTabNavigator): void {
  navigation.navigate('Tabs', {
    screen: 'SearchTab',
    params: { screen: 'Search' },
  });
}
