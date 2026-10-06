import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import ts from "typescript";

const fixture = {};
globalThis.__searchNavigationFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = moduleUrl(`
  const fixture = () => globalThis.__searchNavigationFixture;
  function sameDeps(a, b) { return a && b && a.length === b.length && b.every((value, index) => Object.is(value, a[index])); }
  export function createContext(value) { return {Provider: Symbol('provider'), value}; }
  export function useContext(context) { return context.value; }
  export function useRef(value) {
    const f = fixture(), index = f.cursor++;
    return f.hooks[index] ??= {current: value};
  }
  export function useReducer(reducer, initial) {
    const f = fixture(), index = f.cursor++;
    if (!(index in f.hooks)) {
      const slot = {value: initial, dispatch: null};
      slot.dispatch = (action) => {
        const next = reducer(slot.value, action);
        if (!Object.is(next, slot.value)) { slot.value = next; f.dirty = true; }
      };
      f.hooks[index] = slot;
    }
    const slot = f.hooks[index];
    return [slot.value, slot.dispatch];
  }
  export function useCallback(callback, deps) {
    const f = fixture(), index = f.cursor++, previous = f.hooks[index];
    if (!previous || !sameDeps(previous.deps, deps)) f.hooks[index] = {value: callback, deps};
    return f.hooks[index].value;
  }
  export function useEffect(callback, deps) {
    const f = fixture(), index = f.cursor++;
    f.nextEffects.push({index, callback, deps});
  }
`);
const imports = {
  react: reactUrl,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/navigation": moduleUrl(`
    export function usePathname() { return globalThis.__searchNavigationFixture.route.pathname; }
    export function useSearchParams() { return globalThis.__searchNavigationFixture.route.searchParams; }
    export function useRouter() { return globalThis.__searchNavigationFixture.router; }
  `),
  "@/hooks/useRecentSearches": moduleUrl(`
    export function useRecentSearches() { return {remember: globalThis.__searchNavigationFixture.remember}; }
  `),
  // The debounce scheduler is deterministic here; API/cache hooks are outside
  // this navigation integration. Every timer is delivered explicitly below.
  "@/lib/catalogQueries": moduleUrl("export const SEARCH_DEBOUNCE_MS = 250;"),
  "@/lib/searchInputModel": new URL("../src/lib/searchInputModel.ts", import.meta.url).href,
  "@/lib/searchState": new URL("../src/lib/searchState.ts", import.meta.url).href,
};

async function loadComponent(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(imports[name], `Unmocked search integration import: ${name}`);
    return `from ${JSON.stringify(imports[name])}`;
  });
  return moduleUrl(compiled);
}
imports["@/hooks/useSearchInput"] = await loadComponent("../src/hooks/useSearchInput.ts");
const { SearchProvider } = await import(await loadComponent("../src/hooks/useSearchNavigation.tsx"));

const originalGlobals = {
  window: globalThis.window,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

function unmount() {
  for (const effect of fixture.effects ?? []) effect?.cleanup?.();
  fixture.effects = [];
}

after(() => {
  unmount();
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  delete globalThis.__searchNavigationFixture;
});

function setRoute(href) {
  fixture.route = new URL(href, "https://example.test");
  window.location = fixture.route;
  fixture.dirty = true;
}

function setup(href = "/") {
  unmount();
  Object.assign(fixture, {
    hooks: [], effects: [], cursor: 0, nextEffects: [], dirty: false,
    routes: [], remembered: [], timers: new Map(), history: [href], historyIndex: 0,
    writes: [], listeners: new Map(),
  });
  fixture.remember = (value) => fixture.remembered.push(value);
  fixture.router = { push: (url, options) => fixture.routes.push({url, options}) };
  globalThis.window = {
    addEventListener(type, listener) {
      if (!fixture.listeners.has(type)) fixture.listeners.set(type, new Set());
      fixture.listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { fixture.listeners.get(type)?.delete(listener); },
    history: {
      replaceState(_data, _unused, url) {
        fixture.writes.push({method: "replace", url});
        fixture.history[fixture.historyIndex] = url;
        setRoute(url);
      },
      pushState(_data, _unused, url) {
        fixture.writes.push({method: "push", url});
        fixture.history.splice(fixture.historyIndex + 1);
        fixture.history.push(url);
        fixture.historyIndex += 1;
        setRoute(url);
      },
    },
  };
  globalThis.setTimeout = (callback, duration) => {
    const id = Symbol("debounce");
    fixture.timers.set(id, {callback, duration});
    return id;
  };
  globalThis.clearTimeout = (id) => fixture.timers.delete(id);
  setRoute(href);
  return render();
}

function sameDeps(a, b) {
  return a && b && a.length === b.length && b.every((value, index) => Object.is(value, a[index]));
}

function render() {
  // Render-phase reducer updates restart the render before effects commit, just
  // as React does. Effects run only when their dependency identities change.
  for (let pass = 0; pass < 40; pass += 1) {
    fixture.cursor = 0;
    fixture.nextEffects = [];
    fixture.dirty = false;
    const element = SearchProvider({children: null});
    if (fixture.dirty) continue;
    for (const effect of fixture.nextEffects) {
      const previous = fixture.effects[effect.index];
      if (previous && sameDeps(previous.deps, effect.deps)) continue;
      previous?.cleanup?.();
      fixture.effects[effect.index] = {...effect, cleanup: effect.callback()};
    }
    if (!fixture.dirty) {
      fixture.control = element.props.value;
      return fixture.control;
    }
  }
  throw new Error("SearchProvider did not settle within 40 renders.");
}

function act(action, ...args) {
  fixture.control[action](...args);
  return render();
}

function deliverTimers() {
  const timers = [...fixture.timers];
  for (const [id, timer] of timers) {
    fixture.timers.delete(id);
    timer.callback();
  }
  return render();
}

function acknowledgeRouter(href = fixture.routes.at(-1)?.url) {
  assert.ok(href, "A router acknowledgement needs a pending destination.");
  fixture.history.splice(fixture.historyIndex + 1);
  fixture.history.push(href);
  fixture.historyIndex += 1;
  setRoute(href);
  return render();
}

function back() {
  assert.ok(fixture.historyIndex > 0, "A previous history entry must exist.");
  fixture.historyIndex -= 1;
  setRoute(fixture.history[fixture.historyIndex]);
  for (const listener of fixture.listeners.get("popstate") ?? []) listener();
  return render();
}

test("the same search can be opened again after returning Home", () => {
  setup("/");
  act("setInput", "Roads");
  act("submit");
  assert.equal(fixture.routes.length, 1);
  assert.equal(fixture.routes[0].url, "/search?q=Roads");
  acknowledgeRouter();
  // Return through the Home link, without popstate. The previous search must
  // not remain marked as a pending router request in the persistent provider.
  setRoute("/");
  assert.equal(render().input, "");
  assert.equal(window.location.pathname, "/");

  act("setInput", "Roads");
  act("submit");
  assert.equal(fixture.routes.length, 2);
  assert.equal(fixture.routes[1].url, "/search?q=Roads");
  assert.deepEqual(fixture.routes[1].options, {scroll: false});
  assert.equal(acknowledgeRouter().query, "Roads");
});

test("a delayed router acknowledgement keeps the newer typed draft", () => {
  setup("/");
  act("setInput", "Road");
  act("submit");
  act("setInput", "Roads");
  const acknowledged = acknowledgeRouter("/search?q=Road");
  assert.equal(acknowledged.input, "Roads");
  assert.equal(acknowledged.query, "Road");
  assert.equal(acknowledged.preparing, true);
  assert.equal(fixture.routes.length, 1);

  const committed = deliverTimers();
  assert.equal(committed.query, "Roads");
  assert.equal(window.location.search, "?q=Roads");
  assert.equal(fixture.history.length, 2, "typing updates the entry created by entering search");
});

test("Back between same-query filter entries replaces and cancels a pending draft", () => {
  setup("/search?q=Roads");
  act("setTab", "track");
  assert.equal(window.location.search, "?q=Roads&type=track");
  act("setInput", "unfinished draft");
  const staleTimer = [...fixture.timers.values()][0].callback;
  assert.equal(fixture.control.preparing, true);

  const restored = back();
  assert.equal(restored.tab, "all");
  assert.equal(restored.input, "Roads");
  assert.equal(restored.query, "Roads");
  assert.equal(restored.preparing, false);
  assert.equal(fixture.timers.size, 0);
  staleTimer();
  assert.equal(render().query, "Roads");
  assert.equal(window.location.search, "?q=Roads");
});

test("typed terms replace the current URL while entity and sort changes create Back entries", () => {
  setup("/search?q=Roads");
  act("setInput", "Teardrop");
  assert.equal(window.location.search, "?q=Roads", "the draft does not navigate before debounce");
  deliverTimers();
  assert.equal(window.location.search, "?q=Teardrop");
  assert.equal(fixture.history.length, 1);
  assert.equal(fixture.writes.at(-1).method, "replace");

  act("setTab", "album");
  assert.equal(fixture.history.length, 2);
  assert.equal(fixture.writes.at(-1).method, "push");
  act("setSort", "title");
  assert.equal(fixture.history.length, 3);
  assert.equal(fixture.writes.at(-1).method, "push");
  assert.equal(window.location.search, "?q=Teardrop&type=album&sort=title");
  act("setTab", "album");
  act("setSort", "title");
  assert.equal(fixture.history.length, 3, "selecting the active controls does not duplicate history");
  assert.equal(back().sort, "relevance");
  assert.equal(back().tab, "all");
});

test("clear resets term and filters and an already queued debounce cannot undo it", () => {
  setup("/search?q=Roads&type=track&sort=title");
  act("setInput", "unfinished draft");
  const staleTimer = [...fixture.timers.values()][0].callback;
  const cleared = act("clear");
  assert.equal(cleared.input, "");
  assert.equal(cleared.query, "");
  assert.equal(cleared.tab, "all");
  assert.equal(cleared.sort, "relevance");
  assert.equal(cleared.preparing, false);
  assert.equal(window.location.pathname + window.location.search, "/search");
  assert.equal(fixture.timers.size, 0);

  staleTimer();
  assert.equal(render().query, "");
  assert.equal(window.location.pathname + window.location.search, "/search");
  assert.equal(fixture.history.length, 1);
});

test("repeated submission before the first router acknowledgement creates one navigation", () => {
  setup("/");
  act("setInput", "Roads");
  act("submit");
  act("submit");
  assert.equal(fixture.routes.length, 1);
  assert.equal(acknowledgeRouter().query, "Roads");
  assert.equal(fixture.history.length, 2);
});

test("an external search navigation replaces the draft without rewriting its destination", () => {
  setup("/search?q=Roads");
  act("setInput", "unfinished draft");
  setRoute("/search?q=Portishead&type=artist&sort=title");
  const navigated = render();
  assert.equal(navigated.input, "Portishead");
  assert.equal(navigated.query, "Portishead");
  assert.equal(navigated.tab, "artist");
  assert.equal(navigated.sort, "title");
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.writes.length, 0);
  assert.equal(window.location.search, "?q=Portishead&type=artist&sort=title");
});
