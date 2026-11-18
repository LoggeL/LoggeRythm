import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = { account: null, mixes: null, radar: null };
globalThis.__musicDetailsFixture = fixture;

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const jsxUrl = import.meta.resolve("react/jsx-runtime");
const styleUrl = moduleUrl(
  `export default ${JSON.stringify({
    hero: "hero",
    artwork: "artwork",
    roundArtwork: "round",
    info: "info",
    title: "title",
    description: "description",
    metadata: "metadata",
    actions: "actions",
    tracks: "tracks",
    trackHeading: "track-heading",
    trackCount: "track-count",
    wash: "wash",
    coverEdit: "cover-edit",
  })};`,
);

async function compileRoute(path, imports) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
      assert.ok(imports[name], `Unmocked music detail import: ${name}`);
      return `from ${JSON.stringify(imports[name])}`;
    });
  return moduleUrl(compiled);
}

const nextLinkUrl = moduleUrl(
  `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement("a", {...props, href}, children); }`,
);
const skeletonUrl = moduleUrl(
  `import {createElement} from ${JSON.stringify(reactUrl)}; export const DetailHeaderSkeleton = () => createElement("span", {"data-testid": "header-loading"}); export const RowListSkeleton = () => createElement("span", {"data-testid": "tracks-loading"});`,
);
const playerStoreUrl = moduleUrl(
  `export const usePlayerStore = selector => selector({playQueue() {}});`,
);
const iconsUrl = moduleUrl(
  `export const PlayIcon = () => null; export const PauseIcon = PlayIcon; export const ShuffleIcon = PlayIcon; export const MoreIcon = PlayIcon; export const QueueIcon = PlayIcon; export const RefreshIcon = PlayIcon;`,
);
// Shared primitives render for real so the pages' error and empty states are
// asserted on their actual markup.
const queryErrorUrl = await compileRoute("../src/components/ui/QueryError.tsx", {
  "react/jsx-runtime": jsxUrl,
});
const emptyStateUrl = await compileRoute("../src/components/ui/EmptyState.tsx", {
  "react/jsx-runtime": jsxUrl,
});
const collectionImports = {
  react: reactUrl,
  "react/jsx-runtime": jsxUrl,
  "next/link": nextLinkUrl,
  "./collection.module.css": styleUrl,
  "@/hooks/useCoverColors": moduleUrl(`export const useCoverColors = () => null;`),
  "@/components/TrackList": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export function TrackListHeader({noteLabel}) { return noteLabel === undefined ? null : createElement("span", {"data-testid": "note-heading"}, noteLabel); }`,
  ),
  "@/components/Skeleton": skeletonUrl,
  "@/components/ui/QueryError": queryErrorUrl,
  "@/components/ui/EmptyState": emptyStateUrl,
  "@/components/ContextMenu": moduleUrl(
    `export default function ContextMenu() { return null; }`,
  ),
  "@/components/icons": iconsUrl,
  "@/store/player": playerStoreUrl,
  "@/store/toast": moduleUrl(`export const toast = {info() {}};`),
  // View transitions need a browser; the hero renders its content unwrapped
  // and no card has handed over artwork for the loading header.
  "@/components/motion/Morph": moduleUrl(
    `export const HeroMorph = ({children}) => children; export const useMorphSeed = () => null;`,
  ),
  "@/components/ui/Cover": moduleUrl(
    `export default function Cover() { return null; }`,
  ),
};
collectionImports["./collectionPlayback"] = await compileRoute(
  "../src/app/playlist/_components/collectionPlayback.ts",
  {},
);
const heroUrl = await compileRoute(
  "../src/app/playlist/_components/CollectionHero.tsx",
  collectionImports,
);
collectionImports["./CollectionHero"] = heroUrl;
const tracksUrl = await compileRoute(
  "../src/app/playlist/_components/CollectionTracks.tsx",
  collectionImports,
);
const pageStateUrl = await compileRoute(
  "../src/app/playlist/_components/CollectionPageState.tsx",
  collectionImports,
);
const actionsUrl = await compileRoute(
  "../src/app/playlist/_components/CollectionActions.tsx",
  collectionImports,
);
const metaUrl = await compileRoute(
  "../src/app/playlist/_components/collectionMeta.ts",
  {},
);
const imports = {
  react: moduleUrl(
    `export const use = value => value; export const useEffect = () => {};`,
  ),
  "react/jsx-runtime": jsxUrl,
  "next/link": nextLinkUrl,
  "@tanstack/react-query": moduleUrl(
    `export const useQuery = () => globalThis.__musicDetailsFixture.mixes;`,
  ),
  "@/hooks/useAuth": moduleUrl(
    `export const useMe = () => globalThis.__musicDetailsFixture.account;`,
  ),
  "@/hooks/useReleaseRadar": moduleUrl(
    `export const RADAR_TITLE = "Dein Release Radar"; export const useReleaseRadar = () => globalThis.__musicDetailsFixture.radar; export const useRefreshReleaseRadar = () => ({mutate() {}, isPending: false, isSuccess: false, error: null}); export const useReleaseRadarSeen = () => ({markVisibleTracksSeen() {}});`,
  ),
  "@/store/player": playerStoreUrl,
  "@/lib/api": moduleUrl(`export const api = {};`),
  // The radar's reason wording is the real formatter.
  "@/lib/radarReason": await compileRoute("../src/lib/radarReason.ts", {}),
  "@/components/TrackRow": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function TrackRow({track, note}) { return createElement("div", {"data-testid": "track"}, track.title, note === undefined ? null : createElement("div", {"data-testid": "note"}, note)); }`,
  ),
  "@/components/ui/Cover": moduleUrl(
    `export default function Cover() { return null; }`,
  ),
  "@/components/ui/QueryError": queryErrorUrl,
  "@/components/ui/EmptyState": emptyStateUrl,
  "@/components/Skeleton": skeletonUrl,
  "@/components/icons": iconsUrl,
  "@/app/playlist/_components/CollectionHero": heroUrl,
  "@/app/playlist/_components/CollectionTracks": tracksUrl,
  "@/app/playlist/_components/CollectionPageState": pageStateUrl,
  "@/app/playlist/_components/CollectionActions": actionsUrl,
  "@/app/playlist/_components/collectionMeta": metaUrl,
};

const { default: MixPage } = await import(
  await compileRoute("../src/app/mix/[key]/page.tsx", imports)
);
const { default: RadarPage } = await import(
  await compileRoute("../src/app/radar/page.tsx", imports)
);

const success = (data) => ({
  data,
  error: null,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: async () => {},
});
const failure = (message) => ({
  ...success(undefined),
  error: new Error(message),
  isError: true,
});

function reset() {
  fixture.account = success({ id: "user" });
  fixture.mixes = success([{ key: "mix", title: "Mein Mix", tracks: [] }]);
  fixture.radar = success([]);
}

const mixScreen = () =>
  renderToStaticMarkup(createElement(MixPage, { params: { key: "mix" } }));
const radarScreen = () => renderToStaticMarkup(createElement(RadarPage));

test("personalized detail pages wait for account lookup before choosing an empty state", () => {
  reset();
  fixture.account = { ...success(undefined), isLoading: true };
  for (const screen of [mixScreen, radarScreen]) {
    const html = screen();
    assert.match(html, /data-testid="tracks-loading"/);
    assert.doesNotMatch(
      html,
      /Playlist nicht gefunden|Noch keine frischen|href="\/login"/,
    );
  }
});

test("personalized detail pages keep account failures distinct from a signed-out session", () => {
  reset();
  fixture.account = failure("Konto: HTTP 503");
  for (const screen of [mixScreen, radarScreen]) {
    const html = screen();
    assert.match(html, /role="alert"/);
    assert.match(html, /Konto: HTTP 503/);
    assert.match(html, /Erneut versuchen/);
    assert.doesNotMatch(
      html,
      /href="\/login"|Noch keine frischen|Playlist nicht gefunden/,
    );
  }
});

test("signed-out personalized detail pages provide an explicit sign-in action", () => {
  reset();
  fixture.account = success(null);
  for (const screen of [mixScreen, radarScreen]) {
    const html = screen();
    assert.match(html, /href="\/login"/);
    assert.doesNotMatch(html, /Playlist nicht gefunden|Noch keine frischen/);
  }
});

test("failed personalized collection lookups show the cause without a successful empty state", () => {
  reset();
  fixture.mixes = failure("Mixe: HTTP 502");
  fixture.radar = failure("Radar: HTTP 504");
  const mix = mixScreen();
  const radar = radarScreen();
  assert.match(mix, /Mixe: HTTP 502/);
  assert.doesNotMatch(mix, /Playlist ist leer|Playlist nicht gefunden/);
  assert.match(radar, /Radar: HTTP 504/);
  assert.doesNotMatch(radar, /Noch keine frischen Releases/);
});

test("an account refresh error leaves cached music visible and reports the failure", () => {
  reset();
  fixture.account = {
    ...failure("Profilaktualisierung: HTTP 503"),
    data: { id: "user" },
  };
  const track = { id: "1", title: "Cached song" };
  fixture.mixes.data[0].tracks = [track];
  // Every radar track carries the reason it is listed.
  fixture.radar = success([
    { ...track, radar_reason: { kind: "followed", artist_id: "7", artist_name: "Bekannte Künstlerin", play_count: 0 } },
  ]);
  for (const screen of [mixScreen, radarScreen]) {
    const html = screen();
    assert.match(html, /Profilaktualisierung: HTTP 503/);
    assert.match(html, /Cached song/);
    assert.doesNotMatch(html, /href="\/login"/);
  }
});

test("the release radar states its rule and why each track is listed", () => {
  reset();
  const radarTrack = (id, radar_reason) => ({ id, title: `Song ${id}`, artist: "Fremder", artist_id: "999", radar_reason });
  fixture.radar = success([
    radarTrack("1", { kind: "followed", artist_id: "7", artist_name: "Bekannte Künstlerin", play_count: 0 }),
    radarTrack("2", { kind: "played", artist_id: "8", artist_name: "Oft Gehört", play_count: 4 }),
    radarTrack("3", { kind: "followed", artist_id: "9", artist_name: "", play_count: 3 }),
    radarTrack("4", { kind: "played", artist_id: "10", artist_name: "", play_count: 2 }),
  ]);

  const html = radarScreen();

  assert.match(
    html,
    /Neue Releases von Künstler:innen, denen du folgst oder die du in den letzten 90 Tagen mindestens zweimal gehört hast\./,
  );
  assert.match(html, /data-testid="note-heading">Warum im Radar</);
  const notes = [...html.matchAll(/<div data-testid="note">(.*?)<\/div>/g)].map((match) => match[1]);
  // The reason is real text in the row; the watched source artist (not the
  // track's own artist) is named and linked.
  assert.deepEqual(notes, [
    '<span title="Du folgst Bekannte Künstlerin">Du folgst <a class="hover:text-foreground hover:underline" href="/artist/7">Bekannte Künstlerin</a></span>',
    '<span title="4× gehört: Oft Gehört">4× gehört: <a class="hover:text-foreground hover:underline" href="/artist/8">Oft Gehört</a></span>',
    // No name from the server: no invented name and no link.
    '<span title="Von dir gefolgt">Von dir gefolgt</span>',
    '<span title="2× gehört">2× gehört</span>',
  ]);
  assert.doesNotMatch(html, /href="\/artist\/(9|10|999)"/);
});

test("the mix page keeps its rows free of radar reasons", () => {
  reset();
  fixture.mixes.data[0].tracks = [{ id: "1", title: "Mix song" }];
  const html = mixScreen();
  assert.match(html, /Mix song/);
  assert.doesNotMatch(html, /data-testid="note|Warum im Radar/);
});
