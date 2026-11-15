import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const fixture = { hooks: [], cursor: 0, requests: [], added: [] };
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
const iconStub = moduleUrl("export function PlayIcon() {return null;} export const SearchIcon = PlayIcon; export const CloseIcon = PlayIcon; export const PlusIcon = PlayIcon; export const ChevronDownIcon = PlayIcon; export const QueueIcon = PlayIcon;");
const feedbackIconStub = moduleUrl("export function CopyIcon() {return null;} export const CheckCircleIcon = CopyIcon; export const InfoCircleIcon = CopyIcon;");
const nullStub = moduleUrl("export default function Placeholder() { return null; }");

async function compile(path, substitutions) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(substitutions[name], `Unmocked party search import: ${name}`);
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
// The page is split into hooks and presentational components that live next
// to it. Each local module is compiled through the same strict import map so
// an unexpected dependency in any of them fails the suite.
const party = (file) => `../src/app/party/[code]/${file}`;
const jsxRuntime = import.meta.resolve("react/jsx-runtime");
const requestsUrl = new URL("../src/app/party/requests.ts", import.meta.url).href;
const toastStub = moduleUrl("export const toast = {error() {}, success() {}};");
const playerStub = moduleUrl("export const usePlayerStore = (selector) => selector({followHostPlayback() {}});");
const formatStub = moduleUrl("export const formatTime = (value) => String(value);");
const artistsStub = moduleUrl("export const trackArtistLabel = (track) => track.artist;");

const playbackSyncUrl = await compile(party("usePartyPlaybackSync.ts"), {
  react: reactStub,
  "@/store/player": playerStub,
  "@/store/party": moduleUrl("export const usePartyStore = (selector) => selector({isPlaying: false, positionSec: 0, playbackUpdatedAt: null});"),
  "@/store/toast": toastStub,
  "../requests": requestsUrl,
});
const sessionUrl = await compile(party("usePartySession.ts"), {
  react: reactStub,
  "next/navigation": moduleUrl("export function useRouter() { return {push() {}}; }"),
  "@/hooks/useParty": moduleUrl(`export function useParty() { return {
    party: {code: 'SEARCH', name: 'Party', is_host: false, host_name: 'Host', tracks: [], members: [], current_index: -1},
    add: async (track) => {globalThis.__partySearchFixture.added.push(track);},
    join: async () => {}, leave: async () => {},
  }; }`),
  "@/store/toast": toastStub,
  "../requests": requestsUrl,
  "./usePartyPlaybackSync": playbackSyncUrl,
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
const trackRowUrl = await compile(party("PartyTrackRow.tsx"), {
  "react/jsx-runtime": jsxRuntime,
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
  "@/components/ui/EmptyState": nullStub,
  "@/components/icons": iconStub,
  "@/lib/format": formatStub,
  "@/lib/trackArtists": artistsStub,
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
});
const statesUrl = await compile(party("PartyStates.tsx"), {
  "react/jsx-runtime": jsxRuntime,
});
const pageUrl = await compile(party("page.tsx"), {
  react: reactStub,
  "react/jsx-runtime": jsxRuntime,
  "@/components/ConfirmDialog": nullStub,
  "@/components/feedbackIcons": feedbackIconStub,
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

function setup() {
  Object.assign(fixture, {hooks: [], cursor: 0, requests: [], added: [], input: null});
}
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {for (const child of node) nodes(child, predicate, found); return found;}
  if (predicate(node)) found.push(node);
  // The page composes hook-free section components; expand them the way React
  // would. SearchField keeps its own refs and is rendered explicitly by render().
  if (typeof node.type === "function" && node.type !== SearchField) return nodes(node.type(node.props), predicate, found);
  nodes(node.props?.children, predicate, found);
  return found;
}
function render() {
  fixture.cursor = 0;
  const tree = PartyPage({params: {code: "SEARCH"}});
  const field = nodes(tree, (node) => node.type === SearchField)[0].props;
  const form = SearchField(field);
  const input = nodes(form, (node) => node.type === "input")[0].props;
  fixture.input ??= {dataset: {}, focus() {}};
  input.ref.current = fixture.input;
  return {
    tree, field, form: form.props, input,
    actions: nodes(tree, (node) => node.type === "button" && node.props["aria-label"]?.endsWith("zur Party hinzufügen")),
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

test("party field retains explicit submit and starts the trimmed term immediately", async () => {
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
  await render().actions[0].props.onClick();
  assert.deepEqual(fixture.added, [track]);
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
