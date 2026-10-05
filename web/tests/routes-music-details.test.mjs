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

const collectionImports = {
  "react/jsx-runtime": jsxUrl,
  "./collection.module.css": styleUrl,
};
const heroUrl = await compileRoute(
  "../src/app/playlist/_components/CollectionHero.tsx",
  collectionImports,
);
const tracksUrl = await compileRoute(
  "../src/app/playlist/_components/CollectionTracks.tsx",
  collectionImports,
);
const imports = {
  react: moduleUrl(
    `export const use = value => value; export const useEffect = () => {};`,
  ),
  "react/jsx-runtime": jsxUrl,
  "next/link": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement("a", {...props, href}, children); }`,
  ),
  "@tanstack/react-query": moduleUrl(
    `export const useQuery = () => globalThis.__musicDetailsFixture.mixes;`,
  ),
  "@/hooks/useAuth": moduleUrl(
    `export const useMe = () => globalThis.__musicDetailsFixture.account;`,
  ),
  "@/hooks/useReleaseRadar": moduleUrl(
    `export const RADAR_TITLE = "Dein Release Radar"; export const useReleaseRadar = () => globalThis.__musicDetailsFixture.radar; export const useRefreshReleaseRadar = () => ({mutate() {}, isPending: false, isSuccess: false, error: null}); export const useReleaseRadarSeen = () => ({markVisibleTracksSeen() {}});`,
  ),
  "@/store/player": moduleUrl(
    `export const usePlayerStore = selector => selector({playQueue() {}});`,
  ),
  "@/lib/api": moduleUrl(`export const api = {};`),
  "@/components/TrackRow": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function TrackRow({track}) { return createElement("div", {"data-testid": "track"}, track.title); }`,
  ),
  "@/components/CoverPlaceholder": moduleUrl(
    `export default function CoverPlaceholder() { return null; }`,
  ),
  "@/components/Skeleton": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export const DetailHeaderSkeleton = () => createElement("span", {"data-testid": "header-loading"}); export const RowListSkeleton = () => createElement("span", {"data-testid": "tracks-loading"});`,
  ),
  "@/components/icons": moduleUrl(
    `export const PlayIcon = () => null; export const RefreshIcon = () => null;`,
  ),
  "@/app/playlist/_components/CollectionHero": heroUrl,
  "@/app/playlist/_components/CollectionTracks": tracksUrl,
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
  fixture.radar = success([track]);
  for (const screen of [mixScreen, radarScreen]) {
    const html = screen();
    assert.match(html, /Profilaktualisierung: HTTP 503/);
    assert.match(html, /Cached song/);
    assert.doesNotMatch(html, /href="\/login"/);
  }
});
