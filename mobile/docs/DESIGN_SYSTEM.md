# LoggeRythm mobile design system

The contract for every screen and component in `mobile/src`. Tokens live in
`src/theme.ts`, primitives in `src/components/ui/` (import from the barrel
`../components/ui`), shell pieces in `src/navigation/` and
`src/components/MiniPlayer.tsx`. The look follows the web app
(`web/src/app/globals.css`): deep neutral surfaces, one violet accent, light
pills for primary actions.

Constraints: RN core only (`Animated`, `Pressable`, `PanResponder`, `Image`,
`Modal`). No reanimated / gesture-handler / gradient / blur / svg / expo-image,
no new native dependency. Never touch `modules/`, `plugins/`, `android/`,
`src/player`, `src/api`, `src/offline`, `src/auth`.

## 1. Rules

1. **No literals in screens.** No hex/rgba colours, no `fontSize` /
   `fontWeight` / `lineHeight`, no raw radii, no magic paddings. Use
   `colors.*`, `typography.*` (or `<AppText variant>`), `radii.*`,
   `spacing.*`, `layout.*`, `opacity.*`, `elevation.*`. If a value is missing,
   add a token to `theme.ts` (and a pin in `theme.test.ts`) instead of inlining.
2. **No `paddingBottom: 144/140/120`.** Scroll content clears the mini player
   with `useBottomInset()` (section 4).
3. **States are primitives.** Loading = `Skeleton` / `TrackRowSkeleton` /
   `CardRailSkeleton` shaped like the content (an `ActivityIndicator` only
   inside a button or for a sub-second inline refresh). Empty = `EmptyState`.
   Failure = `ErrorState` with the one `RetryButton`. Never build another
   retry button.
4. **Fail loud** (`../CLAUDE.md`). No swallowed errors, no placeholder data
   when a request fails. A failed query renders `ErrorState`; a failed action
   surfaces its message. `EmptyState` is only for a *successful* empty result.
5. **Strings come from the catalogs.** German and English, via `strings.*`
   (`src/localization/catalog.ts`, both `de` and `en`, typed by
   `StringCatalog`) or a screen catalog built with `createRuntimeCatalog`.
   Read `strings.x` inside render, never in a module-level constant — a
   captured label does not follow a locale switch.
6. **testIDs, accessibilityLabels and route names are contracts.** On-device
   QA (`scripts/android_*.py`) and the vitest suites address them. Keep every
   existing one on an element with the same role; when you move it into a
   sub-component, update the test in the same change. Never rename a route
   (`navigationLinking.ts` / `navigationPersistence.ts` allowlist them).
7. **48dp touch targets**, always (`metrics.minimumTouchTarget`). A smaller
   visual gets a 48dp pressable around it (see `FilterChip`, the mini player
   play disc). Every pressable has `accessibilityRole` and a label.
8. **One loud control per view**: `PlayButton`. One `ActionButton
   variant="primary"` per view; the rest are `secondary` / `ghost`.
9. **Press feedback everywhere**: primitives already have it. For custom
   pressables use `PressableScale`, or `pressed && { opacity: opacity.pressed }`.

## 2. Tokens (`src/theme.ts`)

| Group | Tokens |
| --- | --- |
| Surfaces | `backdrop` #050608 (tab bar, behind everything) · `background` #0c0d11 (screens) · `backgroundElevated` #12141a · `surface` #171a21 (cards, rows, inputs) · `surfaceElevated` #20242d (floating: mini player, menus, artwork placeholder) · `surfacePressed` |
| Fills | `fill` / `fillStrong` (translucent white: neutral controls, chips, active tab pill) · `scrim` (behind sheets/dialogs) |
| Lines | `hairline` rgba(255,255,255,0.07) (1dp separators, card outlines) · `border` / `borderSubtle` (opaque hex, inputs) |
| Text | `textPrimary` #f4f4f7 · `textSecondary` #a0a4b2 · `textMuted` #8a8fa0 (all >= 4.5:1 up to `surfaceElevated`) |
| Accent | `accent` #8f73ff · `accentSolid` #7a5cf5 · `accentPressed` · `accentSoft` #c3b5ff (accent-coloured *text/icons*) · `accentSubtle` (tinted background) |
| Ink | `onAccent` (dark ink on `accent`/`accentSolid` — **not white**) · `onLight` (dark ink on `textPrimary` fills) |
| Status | `success` #5fd6a0 / `successSubtle` · `warning` / `warningSubtle` · `danger` #ff7a8a / `dangerSubtle` |

- `spacing`: xxs 4 · xs 8 · sm 12 · md 16 · lg 20 · xl 24 · xxl 32 · xxxl 40
- `radii`: xs 4 · sm 8 · md 12 · lg 16 · xl 20 · `card` 14 (artwork, tiles) ·
  `panel` 18 (surfaces, mini player) · `sheet` 28 · `pill` 999
- `typography` (spread into a style or use `AppText`):

  | Variant | Size/line | Weight | Use |
  | --- | --- | --- | --- |
  | `display` | 40/46 | 800 | splash numerals |
  | `hero` | 32/38 | 800 | `ScreenHeader` title, detail hero |
  | `title` | 24/30 | 700 | dialog, sheet, page-state titles |
  | `section` | 20/26 | 700 | `SectionHeader` |
  | `bodyStrong` | 15/22 | 600 | row titles, stack header title |
  | `body` | 15/22 | 400 | copy |
  | `callout` | 13/19 | 400 | artist lines, descriptions, status |
  | `caption` | 12/17 | 400 | metadata, counts, timestamps |
  | `label` | 14/20 | 600 | buttons, chips, links |
  | `micro` | 11/14 | 600 | tab labels, badges |
  | `overline` | 11/16 | 700, uppercase | eyebrows |

- `opacity`: `pressed` 0.72 · `disabled` 0.4
- `elevation`: `none` · `card` · `floating` (mini player, FAB, banners) ·
  `sheet` — spread: `...elevation.floating`
- `metrics`: `minimumTouchTarget` 48 · `pagePadding` 20 · `tabBarHeight` 64 ·
  `miniPlayerSurfaceHeight` 64 · `miniPlayerGap` 8
- `layout`: `pagePadding` · `tabBarHeight` · `miniPlayerHeight` (72) ·
  `sectionGap` 32 · `headerGap` 12 · `railGap` 12 · `stackGap` 16 ·
  `scrollEndGap` 24 · `rowHeight` 64 · `artwork.{xs 40, sm 48, md 56, lg 96,
  card 148, hero 220}`

## 3. Primitives (`src/components/ui`)

```tsx
import {
  ActionButton, AppText, Artwork, BottomSheet, Card, CardRailSkeleton, EmptyState,
  ErrorState, FilterChip, IconButton, ListSeparator, PlayButton, PressableScale,
  RetryButton, ScreenHeader, SectionHeader, Skeleton, Surface, TrackRowSkeleton,
} from '../components/ui';
```

**AppText** — `variant?` (type-scale key, default `body`), `color?`
(`primary|secondary|muted|accent|danger|success|warning|onAccent|onLight`),
`align?`, plus every `Text` prop.

```tsx
<AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
<AppText variant="callout" color="secondary" numberOfLines={1}>{artist}</AppText>
```

**Surface / Card** — `Surface`: `level?` (`flat|card|raised`, default `card`),
`radius?` (radii key, default `panel`), `padded?`, plus `View` props. `Card`:
same look, `padded` by default; with `onPress`/`onLongPress` it becomes one
button (`accessibilityLabel`, `accessibilityHint?`, `disabled?`, `testID?`).

```tsx
<Card onPress={open} accessibilityLabel={strings.library.openPlaylist(name)} testID="playlist-card">
  <AppText variant="bodyStrong">{name}</AppText>
</Card>
```

**IconButton** — `icon`, `onPress`, `accessibilityLabel` (required),
`size?` (`sm|md|lg` glyph 20/24/28; target always 48), `variant?`
(`plain|tonal|filled`), `selected?`, `color?`, `disabled?`, `busy?`,
`onLongPress?`, `accessibilityHint?`, `testID?`, `style?`.

```tsx
<IconButton icon="dots-vertical" accessibilityLabel={strings.track.moreActions(title)} onPress={openMenu} />
<IconButton icon="shuffle" selected={shuffle} accessibilityLabel={strings.player.shuffle} onPress={toggle} />
```

**ActionButton** — `label`, `onPress`, `icon?`, `variant?`
(`primary` light pill | `accent` | `secondary` | `ghost` | `danger`),
`disabled?`, `busy?`, `fullWidth?`, `accessibilityLabel?`,
`accessibilityHint?`, `testID?`, `style?`.

```tsx
<ActionButton label={strings.common.save} onPress={save} busy={saving} testID="profile-save" />
<ActionButton variant="secondary" icon="shuffle" label={strings.playlist.shuffle} onPress={shuffle} />
```

**PlayButton** — `onPress`, `accessibilityLabel` (required), `playing?`,
`busy?`, `disabled?`, `size?` (`sm` 48 | `md` 56 | `lg` 64), `icon?`,
`testID?`, `style?`.

```tsx
<PlayButton size="lg" playing={isPlaying} busy={buffering}
  accessibilityLabel={isPlaying ? strings.common.pause : strings.common.play} onPress={toggle} />
```

**FilterChip** — `label`, `onPress`, `selected?`, `disabled?`, `icon?`,
`accessibilityRole?` (`button|tab|radio`), `accessibilityLabel?`, `testID?`,
`style?`. Lay out in a horizontal `ScrollView` with `gap: spacing.xs`.

```tsx
<FilterChip label={strings.search.tabs.album} selected={tab === 'album'}
  accessibilityRole="tab" onPress={() => setTab('album')} testID="search-tab-album" />
```

**ScreenHeader** — `title`, `subtitle?`, `eyebrow?`, `action?` (node),
`testID?`, `titleTestID?`, `style?`. No own horizontal padding.

```tsx
<ScreenHeader title={strings.navigation.library} titleTestID="library-title"
  action={<IconButton icon="plus" accessibilityLabel={strings.library.createPlaylist} onPress={create} />} />
```

**SectionHeader** — `title`, `subtitle?`, `onShowAll?`, `showAllLabel?`
(default `strings.common.showAll` = "Alle anzeigen"),
`showAllAccessibilityLabel?`, `showAllTestID?`, `trailing?`, `padded?`
(default true = page gutter), `testID?`, `style?`.

```tsx
<SectionHeader title={strings.home.mixes} onShowAll={openMixes} showAllTestID="home-mixes-all" />
```

**Artwork** — the only cover/avatar renderer. `uri` (string | null |
undefined), `size` (number or `'fill'`), `shape?` (`square|round`), `radius?`,
`icon?` (placeholder glyph, default `music-note`), `accessibilityLabel?`
(decorative when omitted), `testID?`, `style?`. The placeholder is always
underneath the image, so no load/error state is needed.

```tsx
<Artwork uri={track.cover} size={layout.artwork.sm} />
<Artwork uri={artist.picture} size={layout.artwork.lg} shape="round" icon="account-music" />
```

**Skeleton / TrackRowSkeleton / CardRailSkeleton** — `Skeleton`: `width?`,
`height?`, `radius?`, `testID?`, `style?`. Groups: `accessibilityLabel`
(required, localized loading text), `count?`, `testID?`, `style?`;
`CardRailSkeleton` adds `size?`, `round?`. Keep the existing `*-loading`
testID on the group.

```tsx
if (visual.body === 'loading')
  return <TrackRowSkeleton testID="album-loading" accessibilityLabel={strings.album.loading} />;
```

**EmptyState** — `title`, `message?`, `icon?`, `action?` (node), `layout?`
(`inline|page`), `testID?`, `style?`.

```tsx
<EmptyState layout="page" icon="playlist-plus" title={strings.library.noPlaylists}
  action={<ActionButton label={strings.library.createPlaylist} onPress={create} />} />
```

**ErrorState / RetryButton** — `ErrorState`: `message` (already
user-facing), `title?`, `kind?` (`error|offline`), `layout?` (`inline|page`),
`onRetry?`, `retryBusy?`, `retryLabel?`, `retryAccessibilityLabel?`,
`testID?`, `retryTestID?`, `style?`. `RetryButton`: `onRetry`, `busy?`,
`label?`, `accessibilityLabel?`, `testID?`, `style?`.

```tsx
<ErrorState layout="page" testID="album-error" retryTestID="album-retry"
  message={catalogStrings.common.loadFailed} onRetry={refetch} retryBusy={isFetching} />
```

Map query state with `resolveRemoteVisualState` (`src/data/remoteState.ts`):
`body` `loading` → skeleton, `offline` → `ErrorState kind="offline"`,
`hard-error` → `ErrorState`, `empty` → `EmptyState`, `content` → content;
`notice` (`cached-offline`, `cached-refresh-error`, `refreshing`, `stale`) is
an inline line above cached content, with `RetryButton` where retryable.

**ListSeparator** — `inset?`, `style?`.

```tsx
<FlatList ItemSeparatorComponent={() => <ListSeparator inset={layout.artwork.sm + spacing.sm} />} />
```

**BottomSheet** — `visible`, `onClose`, `closeLabel` (localized scrim
label), `title?`, `children`, `testID?` (also yields `${testID}-scrim`,
`${testID}-handle`), `contentStyle?`. Scrim tap, hardware back and a
downward drag on the handle call `onClose`. `shouldDismissSheet({dy, vy})` is
exported for tests.

```tsx
<BottomSheet visible={open} onClose={close} closeLabel={strings.common.dismiss}
  title={track.title} testID="track-actions-sheet">
  {actions.map((action) => <ActionRow key={action.id} {...action} />)}
</BottomSheet>
```

**PressableScale** — every `Pressable` prop except a function `style`;
`scaleTo?` (default 0.96).

```tsx
<PressableScale onPress={open} accessibilityRole="button" accessibilityLabel={label} testID={id}>
  <Artwork uri={album.cover} size={layout.artwork.card} />
</PressableScale>
```

## 4. Shell

- **Bottom inset** — `src/hooks/useBottomInset.ts`:

  ```tsx
  const bottom = useBottomInset();                 // inside the tabs
  const bottom = useBottomInset({ hasTabBar: false, extra: spacing.md }); // Profile, modals
  <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} />
  ```

  It returns `scrollEndGap` plus `layout.miniPlayerHeight` only while a track
  is loaded, plus the safe area outside the tabs. `bottomInset(...)` is the
  pure version. It is not in the ui barrel because it imports the player.
- **Tab bar** — `src/navigation/tabBar.tsx` (`tabBarScreenOptions`,
  `TabBarIcon`): `backdrop` background, hairline top border, translucent pill
  behind the focused icon, `micro` labels. Height `metrics.tabBarHeight` +
  bottom inset.
- **MiniPlayer** — floating `surfaceElevated` card (radius `panel`) 8dp above
  the tab bar; testIDs `mini-player`, `mini-player-open`, `mini-player-like`,
  `mini-player-play-pause`, `mini-player-next`. Exports `TAB_BAR_HEIGHT`,
  `MINI_PLAYER_HEIGHT`.
- **Stack headers** — `sectionScreenOptions` in
  `src/navigation/headerChrome.tsx` (flat, borderless, `bodyStrong` title).
  Tab roots show the brand lockup + `ProfileButton`; screens add their own
  large title with `ScreenHeader`.
- **Navigation layout** — `src/navigation.tsx` is only the topology (tabs +
  root stack). `src/navigation/`: `types.ts` (param lists), `routes.tsx`
  (route wrappers that turn navigation props into `onOpenX` callbacks —
  screens never import navigation types), `sectionNavigators.tsx` (one
  factory for the five tab stacks + shared detail routes), `headerChrome.tsx`,
  `tabBar.tsx`, `playerOverlays.tsx`, `PlayerStartup.tsx`,
  `usePlayerBootstrap.ts`, `useNavigationRestoration.ts`, `rootNavigation.ts`.
  A new detail route = a param type in `types.ts`, a wrapper in `routes.tsx`,
  a screen in `detailScreens()`, and the linking/persistence allowlists.

## 5. Screen recipe

```tsx
const bottom = useBottomInset();
<ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
  <ScreenHeader title={strings.navigation.discover} style={styles.gutter} />
  <View style={styles.section}>
    <SectionHeader title={strings.discover.charts} onShowAll={openCharts} />
    {/* skeleton | ErrorState | EmptyState | rail */}
  </View>
</ScrollView>

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: layout.sectionGap, paddingTop: spacing.md },
  gutter: { paddingHorizontal: layout.pagePadding },
  section: { gap: layout.headerGap },
});
```

Rails are full-bleed with `contentContainerStyle={{ paddingHorizontal:
layout.pagePadding, gap: layout.railGap }}`; rows are `layout.rowHeight` tall
with `Artwork size={layout.artwork.sm}`.

## 6. Tests (vitest, `npm test`) — how they work and how to keep them green

There is **no renderer**. A component test mocks `react-native` export by
export, calls the component as a plain function and walks `props.children`.

```tsx
vi.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T): T => styles },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
import { byTestId, byType, flatStyle, textContent } from '../../test/render';

const rendered = MyRow({ title: 'x', onPress });
expect(byTestId(rendered, 'my-row').props.accessibilityRole).toBe('button');
```

`src/test/render.ts` provides `elements`, `byTestId`, `queryByTestId`,
`byType`, `textContent`, `flatStyle` (resolves arrays and `({pressed})`
style functions). `elements` calls unmocked function components, so
hook-free primitives can stay real.

Consequences — check each when you touch a tested file:

- **New RN import ⇒ add it to that test's `react-native` mock** (a missing
  export throws on access). Same for a new `theme` token if the test mocks
  `../theme` (e.g. `MixScreen.test`, `CatalogTrackList.test`,
  `SessionRestoreError.test`) and for new `strings` keys if it mocks
  `../localization`.
- **Hooks cannot run outside a render.** Hook-free primitives (`AppText`,
  `Surface`, `Card`, `IconButton`, `ActionButton`, `PlayButton`, `FilterChip`,
  `ScreenHeader`, `SectionHeader`, `Artwork`, `ListSeparator`, `EmptyState`,
  `ErrorState`, `RetryButton`) may be used unmocked. Primitives with hooks —
  `Skeleton` (+ groups), `PressableScale`, `BottomSheet` — and
  `useBottomInset` must be mocked in the consumer's test:

  ```tsx
  vi.mock('../components/ui', async (original) => ({
    ...(await original<typeof import('../components/ui')>()),
    TrackRowSkeleton: 'TrackRowSkeleton', PressableScale: 'PressableScale', BottomSheet: 'BottomSheet',
  }));
  vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));
  ```

  A mocked string component keeps its props, so `byTestId` still finds the
  testID you passed to it.
- **Hook order is pinned** where a test mocks `useState` positionally:
  `ProfileScreen` (its update-card slot comes from `useAndroidUpdatePlacement`,
  a custom hook with its own `useState` that the profile test mocks), `LoginScreen`, `PendingApprovalScreen`, `MixScreen`,
  `SessionRestoreError`, `AndroidUpdateCard` (one mount `useEffect` that
  subscribes the check-outcome announcer and asks for the profile check — add
  card behaviour there or in a store helper, not as another hook; its
  `LastChecked` child: clock `useState`, then the one-minute refresh `useEffect`), `NowPlayingScreen` (gestures),
  `AndroidUpdateToastHost`, `TrackPresentationProvider`, `AuthContext`. Do
  not add, remove or reorder `useState` calls there without updating the
  test's sequence; put new state into a child component or a custom hook
  that the test mocks.
- **Source scanners** read file text: `navigation.searchUx.test.ts`
  (`<Tab.Screen name="…">` order and `tabBarButtonTestID: 'tab-search'` /
  `tabBarAccessibilityLabel: strings.navigation.search` in
  `src/navigation.tsx`), `HomeScreen.searchAction.test.ts`,
  `SearchScreen.source.test.ts`. Keep those literals in those files.
- `react-native-safe-area-context` is aliased to `src/test/safeAreaContextStub.ts`
  (zero insets) in `vitest.config.mts`; override with `vi.mock` when a test
  needs real insets.
- Update a test when structure legitimately changes, keeping its behavioural
  intent. Never delete an assertion to go green.
- New component ⇒ a focused test next to it in this style (role, label,
  state, testID, tokens, callbacks).

Before reporting: `npm run typecheck && npm run lint && npm test` from `mobile/`.
