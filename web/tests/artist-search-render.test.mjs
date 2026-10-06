import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const fixture = {};
globalThis.__artistSearchFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const stubs = {
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@tanstack/react-query": moduleUrl("export function useQuery(options) {globalThis.__artistSearchFixture.options = options; return globalThis.__artistSearchFixture.result;}"),
  "@/lib/catalogQueries": moduleUrl("export const SEARCH_MIN_LENGTH = 2; export function searchTracksOptions(query) {return {queryKey: ['search', 'track', query]};}"),
  "@/hooks/useSearchInput": moduleUrl("export function useSearchInput(source, scope) {const f = globalThis.__artistSearchFixture; f.scope = scope; return f.search;}"),
  "@/components/SearchField": moduleUrl("export default function SearchField() {return null;}"),
  "@/components/PopularTrackTable": moduleUrl("export default function PopularTrackTable() {return null;}"),
  "@/components/Skeleton": moduleUrl("export function RowListSkeleton() {return null;}"),
  "./artistSearchModel": new URL("../src/components/artistSearchModel.ts", import.meta.url).href,
};
const source = await readFile(new URL("../src/components/ArtistSongSearch.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext}}).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(stubs[name], `Unmocked artist search import: ${name}`);
  return `from ${JSON.stringify(stubs[name])}`;
});
const {default: ArtistSongSearch} = await import(moduleUrl(compiled));
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {for (const child of node) nodes(child, predicate, found); return found;}
  if (predicate(node)) found.push(node);
  nodes(node.props?.children, predicate, found);
  return found;
}
function screen({input = "Bohemian", query = input.trim(), preparing = false, data = [], error = null} = {}) {
  fixture.submitted = 0;
  fixture.cleared = 0;
  fixture.retries = 0;
  fixture.search = {input, query, preparing, setInput() {}, setComposing() {}, submit() {fixture.submitted += 1;}, clear() {fixture.cleared += 1;}};
  fixture.result = {data, isError: !!error, error: error ? new Error(error) : null, isSuccess: !error, isLoading: false, isFetching: false, refetch() {fixture.retries += 1;}};
  const tree = ArtistSongSearch({artistId: "27", artistName: "Queen"});
  return {
    field: nodes(tree, (node) => node.type?.name === "SearchField")[0].props,
    table: nodes(tree, (node) => node.type?.name === "PopularTrackTable")[0],
    skeleton: nodes(tree, (node) => node.type?.name === "RowListSkeleton")[0],
    alerts: nodes(tree, (node) => node.props?.role === "alert"),
    statuses: nodes(tree, (node) => node.props?.role === "status"),
    buttons: nodes(tree, (node) => node.type === "button"),
  };
}
test("artist search uses canonical shared request keys and resets on artist changes", () => {
  const ui = screen();
  assert.deepEqual(fixture.options, {queryKey: ["search", "track", '"Queen" "Bohemian"'], enabled: true});
  assert.equal(fixture.scope, "27");
  ui.field.onSubmit();
  ui.field.onClear();
  assert.equal(fixture.submitted, 1);
  assert.equal(fixture.cleared, 1);
});
test("draft changes hide a playable cached result before the next request begins", () => {
  const ui = screen({input: "Radio Ga", query: "Bohemian", preparing: true, data: [{id: "old", artist_id: "27", artist: "Queen"}]});
  assert.equal(fixture.options.enabled, false);
  assert.equal(ui.table, undefined);
  assert.ok(ui.skeleton);
});
test("clear and a single character disable requests and hide cached songs", () => {
  for (const input of ["", "B"]) {
    const ui = screen({input, data: [{id: "cached", artist_id: "27", artist: "Queen"}]});
    assert.equal(fixture.options.enabled, false);
    assert.equal(ui.table, undefined);
    assert.deepEqual(ui.statuses, []);
  }
});
test("results match exact performer credits and exclude known different artists", () => {
  const exact = {id: "real", artist_id: "27", artist: "Queen"};
  const featured = {id: "featured", artist_id: "other", artist: "Other", artists: [{id: "27", name: "Queen"}]};
  const wrong = {id: "wrong", artist_id: "other", artist: "Queen"};
  const substring = {id: "substring", artist: "Queen Bee"};
  assert.deepEqual(screen({data: [exact, featured, wrong, substring]}).table.props.tracks, [exact, featured]);
});
test("errors expose the upstream message and retry without a false empty result", () => {
  const ui = screen({error: "API search: HTTP 503"});
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0].props.children.slice(0, 2).join(""), /HTTP 503/);
  assert.deepEqual(ui.statuses, []);
  ui.buttons[0].props.onClick();
  assert.equal(fixture.retries, 1);
});
