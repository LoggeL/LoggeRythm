import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const fixture = {
  hooks: [],
  cursor: 0,
  requests: [],
  added: [],
  addedNext: [],
  party: {
    code: "SEARCH",
    name: "Party",
    is_host: false,
    host_name: "Host",
    guests_can_control: false,
    is_playing: false,
    position_sec: 0,
    playback_updated_at: null,
    viewer_key: "u:2",
    viewer_name: "Listener",
    viewer_is_guest: false,
    tracks: [],
    members: [],
    current_index: -1,
  },
};
globalThis.__partySearchFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactStub = moduleUrl(`
  export const use = (value) => value;
  export function useEffect() {}
  export function useImperativeHandle() {}
  export function useSyncExternalStore(_subscribe, _client, server) { return server(); }
  export function useRef(value) { const f = globalThis.__partySearchFixture; const index = f.cursor++; return f.hooks[index] ??= {current: value}; }
  export function useState(initial) { const f = globalThis.__partySearchFixture; const index = f.cursor++; if (!(index in f.hooks)) f.hooks[index] = typeof initial === 'function' ? initial() : initial; return [f.hooks[index], (value) => {f.hooks[index] = typeof value === 'function' ? value(f.hooks[index]) : value;}]; }
`);
const iconStub = moduleUrl(`
  export function PlayIcon() {return null;}
  export const PauseIcon = PlayIcon;
  export const NextIcon = PlayIcon;
  export const PrevIcon = PlayIcon;
  export const SearchIcon = PlayIcon;
  export const CloseIcon = PlayIcon;
  export const PlusIcon = PlayIcon;
  export const ChevronDownIcon = PlayIcon;
  export const QueueIcon = PlayIcon;
  export const EditIcon = PlayIcon;
  export const ClockIcon = PlayIcon;
  export const SpinnerIcon = PlayIcon;
  export const SavePlaylistIcon = PlayIcon;
  export const CinemaIcon = PlayIcon;
  export const SparklesIcon = PlayIcon;
  export const CrownIcon = PlayIcon;
`);
const feedbackIconStub = moduleUrl(
  "export function CopyIcon() {return null;} export const CheckCircleIcon = CopyIcon; export const InfoCircleIcon = CopyIcon; export const AlertCircleIcon = CopyIcon;",
);
const nullStub = moduleUrl("export default function Placeholder() { return null; }");
const cacheMarkerStub = moduleUrl(
  `export default function CacheMarker(props) { return { $$typeof: Symbol.for("react.transitional.element"), type: "cache-marker", props }; }`,
);

async function compile(path, substitutions) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(substitutions[name], `Unmocked party search import: ${name} (in ${path})`);
    return `from ${JSON.stringify(substitutions[name])}`;
  });
  return moduleUrl(compiled);
}

const fieldUrl = await compile("../src/components/SearchField.tsx", {
  react: reactStub,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@/components/icons": iconStub,
});
const { default: SearchField } = await import(fieldUrl);

const party = (file) => `../src/app/party/[code]/${file}`;
const jsxRuntime = import.meta.resolve("react/jsx-runtime");
const requestsUrl = new URL("../src/app/party/requests.ts", import.meta.url).href;
const toastStub = moduleUrl("export const toast = {error() {}, success() {}};");
const playerStub = moduleUrl(
  "export const usePlayerStore = Object.assign((selector) => selector({followHostPlayback() {}, isBuffering: false}), { getState: () => ({ toggle() {}, currentTime: 0 }) });",
);
const partyStoreStub = moduleUrl(
  "export const usePartyStore = (selector) => selector({listenLocally: true, setListenLocally() {}, detached: false, setDetached() {}});",
);
const formatStub = moduleUrl("export const formatTime = (value) => String(value);");
const artistsStub = moduleUrl("export const trackArtistLabel = (track) => track.artist;");
const linkStub = moduleUrl("export default function Link({ children }) { return children ?? null; }");

const sessionUrl = await compile(party("usePartySession.ts"), {
  react: reactStub,
  "next/navigation": moduleUrl("export function useRouter() { return {push() {}}; }"),
  "@/hooks/useParty": moduleUrl(`export function useParty() { return {
    party: globalThis.__partySearchFixture.party,
    ended: false,
    endedReason: null,
    hasLeft: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: async () => {},
    add: async (track, insert) => {
      if (insert === "next") globalThis.__partySearchFixture.addedNext.push(track);
      else globalThis.__partySearchFixture.added.push(track);
    },
    remove: async () => {},
    reorder: async () => {},
    setCurrent: async () => {},
    setPlayback: async () => {},
    updateSettings: async () => {},
    kickMember: async () => {},
    savePlaylist: async () => ({ id: "1", name: "Jam" }),
    transferHost: async () => {},
    autoDjFill: async () => {},
    react: async () => {},
    voteSkip: async () => ({ skipped: false, votes: ["u:2"], votes_needed: 2 }),
    join: async () => {},
    leave: async () => {},
    end: async () => {},
  }; }`),
  "@/store/party": partyStoreStub,
  "@/store/player": playerStub,
  "@/store/toast": toastStub,
  "../requests": requestsUrl,
});
const searchUrl = await compile(party("usePartySearch.ts"), {
  react: reactStub,
  "@/lib/api": moduleUrl(`export const api = { search(term, kind, signal) {
    let resolve, reject;
    const promise = new Promise((complete, fail) => {resolve = complete; reject = fail;});
    globalThis.__partySearchFixture.requests.push({term, kind, signal, resolve, reject});
    return promise;
  }};`),
  "../requests": requestsUrl,
});
const shareLinkUrl = await compile(party("useShareLink.ts"), {
  react: reactStub,
  "@/store/toast": toastStub,
  "../requests": requestsUrl,
});
const loadBadgeUrl = await compile(party("PartyLoadBadge.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "@/components/icons": iconStub,
  "@/components/feedbackIcons": feedbackIconStub,
});
const trackRowUrl = await compile(party("PartyTrackRow.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "@/components/CacheMarker": cacheMarkerStub,
  "@/components/ui/Cover": nullStub,
});
const searchPanelUrl = await compile(party("PartySearch.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "@/components/SearchField": fieldUrl,
  "@/components/ui/EmptyState": nullStub,
  "@/components/icons": iconStub,
  "@/lib/trackArtists": artistsStub,
  "./PartyTrackRow": trackRowUrl,
});
const queueUrl = await compile(party("PartyQueue.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "@/components/Avatar": nullStub,
  "@/components/CacheMarker": cacheMarkerStub,
  "@/components/EqualizerBars": nullStub,
  "@/components/ui/Cover": nullStub,
  "@/components/ui/EmptyState": nullStub,
  "@/components/icons": iconStub,
  "@/lib/format": formatStub,
  "@/lib/trackArtists": artistsStub,
  "./PartyLoadBadge": loadBadgeUrl,
  "./PartyTrackRow": trackRowUrl,
});
const shareCardUrl = await compile(party("ShareCard.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "qrcode.react": moduleUrl("export function QRCodeSVG() { return null; }"),
  "@/components/feedbackIcons": feedbackIconStub,
});
const membersUrl = await compile(party("MembersCard.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "@/components/Avatar": nullStub,
  "@/components/icons": iconStub,
});
const statesUrl = await compile(party("PartyStates.tsx"), {
  "react/jsx-runtime": jsxRuntime,
  "next/link": linkStub,
});
const pageUrl = await compile(party("page.tsx"), {
  react: reactStub,
  "react/jsx-runtime": jsxRuntime,
  "next/navigation": moduleUrl("export function useRouter() { return {push() {}}; }"),
  "@/components/ConfirmDialog": nullStub,
  "@/components/Modal": nullStub,
  "@/components/party/PartyScreenKiosk": moduleUrl("export const PARTY_REACTION_EMOJIS = ['🔥']; export default function PartyScreenKiosk() { return null; }"),
  "@/components/feedbackIcons": feedbackIconStub,
  "@/components/icons": iconStub,
  "@/hooks/useAuth": moduleUrl("export function useMe() { return {data: {is_approved: true}}; }"),
  "@/lib/slugs": moduleUrl("export const playlistPath = (p) => '/playlist/' + p.id;"),
  "@/store/player": playerStub,
  "@/store/toast": toastStub,
  "./GuestParty": nullStub,
  "./MembersCard": membersUrl,
  "./PartyQueue": queueUrl,
  "./PartySearch": searchPanelUrl,
  "./PartyStates": statesUrl,
  "./ShareCard": shareCardUrl,
  "./usePartySearch": searchUrl,
  "./usePartySession": sessionUrl,
  "./useShareLink": shareLinkUrl,
});
const { default: PartyPage } = await import(pageUrl);
const { default: PartyLoadBadge } = await import(loadBadgeUrl);

function setup(partyOverride = {}) {
  Object.assign(fixture, {
    hooks: [],
    cursor: 0,
    requests: [],
    added: [],
    addedNext: [],
    input: null,
    party: {
      code: "SEARCH",
      name: "Party",
      is_host: false,
      host_name: "Host",
      guests_can_control: false,
      is_playing: false,
      position_sec: 0,
      playback_updated_at: null,
      viewer_key: "u:2",
      viewer_name: "Listener",
      viewer_is_guest: false,
      tracks: [],
      members: [],
      current_index: -1,
      ...partyOverride,
    },
  });
}
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {for (const child of node) nodes(child, predicate, found); return found;}
  if (predicate(node)) found.push(node);
  if (typeof node.type === "function" && node.type !== SearchField) return nodes(node.type(node.props), predicate, found);
  nodes(node.props?.children, predicate, found);
  return found;
}
function render() {
  fixture.cursor = 0;
  const view = PartyPage({params: {code: "SEARCH"}});
  const tree = view.type(view.props);
  const field = nodes(tree, (node) => node.type === SearchField)[0].props;
  const form = SearchField(field);
  const input = nodes(form, (node) => node.type === "input")[0].props;
  fixture.input ??= {dataset: {}, focus() {}};
  input.ref.current = fixture.input;
  return {
    tree,
    field,
    form: form.props,
    input,
    actions: nodes(tree, (node) => node.type === "button" && node.props["aria-label"]?.endsWith("zur Party hinzufügen")),
    nextActions: nodes(tree, (node) => node.type === "button" && node.props["aria-label"]?.endsWith("als Nächstes in die Jam einreihen")),
    cacheMarkers: nodes(tree, (node) => node.type === "cache-marker"),
    alerts: nodes(tree, (node) => node.props?.role === "alert"),
  };
}
function submit(screen) {
  let prevented = false;
  screen.form.onSubmit({preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
}
const flush = () => new Promise(setImmediate);
const track = {id: "song", title: "Song", artist: "Artist", cover: "", duration_sec: 100};

test("party field retains explicit submit, renders CacheMarker on hits, and supports add + play-next", async () => {
  setup();
  render().field.onValueChange("  Queen  ");
  assert.deepEqual(fixture.requests, []);
  const screen = render();
  assert.equal(screen.field.trailing.props.type, "submit");
  assert.equal(screen.field.trailing.props.disabled, false);
  submit(screen);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].term, "Queen");
  assert.equal(fixture.requests[0].kind, "track");
  assert.equal(render().field.inputProps["aria-busy"], true);
  fixture.requests[0].resolve([track]);
  await flush();
  const after = render();
  assert.equal(after.cacheMarkers.some((m) => m.props.trackId === "song"), true);
  await after.actions[0].props.onClick();
  await after.nextActions[0].props.onClick();
  assert.deepEqual(fixture.added, [track]);
  assert.deepEqual(fixture.addedNext, [track]);
});

test("party queue renders normal CacheMarker icons in Now Playing and Next in Jam without static ready text pills", () => {
  setup({
    is_host: true,
    is_playing: true,
    current_index: 0,
    tracks: [
      { id: 1, deezer_id: "101", title: "Now Song", artist: "A", album: "", cover: "", duration_sec: 180, added_by: "Host", added_by_member: "u:1", is_stored: true, load_state: "ready", load_error: null },
      { id: 2, deezer_id: "102", title: "Next Song", artist: "B", album: "", cover: "", duration_sec: 200, added_by: "Jule", added_by_member: "u:2", is_stored: true, load_state: "ready", load_error: null },
      { id: 3, deezer_id: "103", title: "Loading Song", artist: "C", album: "", cover: "", duration_sec: 210, added_by: "Jule", added_by_member: "u:2", is_stored: false, load_state: "loading", load_error: null },
    ],
  });
  const screen = render();
  const markerIds = screen.cacheMarkers.map((m) => [m.props.trackId, m.props.serverStored]);
  assert.deepEqual(markerIds, [
    ["101", true],
    ["102", true],
    ["103", false],
  ]);
  // PartyLoadBadge returns null for ready & idle, spinner for loading, alert for failed.
  assert.equal(PartyLoadBadge({ state: "ready", error: null }), null);
  assert.equal(PartyLoadBadge({ state: "idle", error: null }), null);
  assert.equal(PartyLoadBadge({ state: "loading", error: null }).props["data-load-state"], "loading");
  const failed = PartyLoadBadge({ state: "failed", error: "Region blocked" });
  assert.equal(failed.props["data-load-state"], "failed");
  assert.match(failed.props.title, /Region blocked/);
});

test("party clear immediately aborts a pending request and rejects its late results", async () => {
  setup();
  render().field.onValueChange("Queen");
  submit(render());
  const request = fixture.requests[0];
  render().field.onClear();
  assert.equal(request.signal.aborted, true);
  const cleared = render();
  assert.equal(cleared.field.value, "");
  assert.equal(cleared.field.inputProps["aria-busy"], false);
  assert.equal(cleared.field.trailing.props.disabled, true);
  request.resolve([track]);
  await flush();
  assert.equal(render().actions.length, 0);
  assert.equal(render().alerts.length, 0);
});

test("party clear removes completed search actions and prior search failures", async () => {
  setup();
  render().field.onValueChange("Queen");
  submit(render());
  fixture.requests[0].resolve([track]);
  await flush();
  assert.equal(render().actions.length, 1);
  render().field.onClear();
  assert.equal(render().actions.length, 0);
  render().field.onValueChange("Unavailable");
  submit(render());
  fixture.requests[1].reject(new Error("HTTP 503"));
  await flush();
  assert.match(render().alerts[0].props.children, /HTTP 503/);
  render().field.onClear();
  assert.equal(render().alerts.length, 0);
});

test("editing party input cancels the old request without starting a new one", async () => {
  setup();
  render().field.onValueChange("Queen");
  submit(render());
  const first = fixture.requests[0];
  render().field.onValueChange("Daft Punk");
  assert.equal(first.signal.aborted, true);
  assert.equal(fixture.requests.length, 1);
  submit(render());
  const second = fixture.requests[1];
  first.resolve([track]);
  await flush();
  assert.equal(render().actions.length, 0);
  assert.equal(render().field.inputProps["aria-busy"], true);
  second.resolve([{...track, id: "new", title: "New song"}]);
  await flush();
  assert.match(render().actions[0].props["aria-label"], /New song/);
});

test("party Enter submit waits until IME composition finishes", async () => {
  setup();
  render().field.onValueChange("東京");
  let screen = render();
  screen.input.onCompositionStart({currentTarget: fixture.input});
  submit(screen);
  assert.deepEqual(fixture.requests, []);
  screen.input.onCompositionEnd({currentTarget: fixture.input});
  screen = render();
  submit(screen);
  assert.equal(fixture.requests[0].term, "東京");
  fixture.requests[0].resolve([]);
  await flush();
});
