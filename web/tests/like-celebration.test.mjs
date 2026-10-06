import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { getLikeBurstGeometry, LIKE_BURST_DURATION } from "../src/components/LikeButton.motion.ts";

const fixture = { hooks: [], effects: [], cursor: 0, nextEffects: [] };
globalThis.__likeCelebrationFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const stubs = {
  react: moduleUrl(`
    export function useRef(value) { const f = globalThis.__likeCelebrationFixture; const index = f.cursor++; return f.hooks[index] ??= {current: value}; }
    export function useId() { return useRef('like-gradient').current; }
    export function useState(initial) { const f = globalThis.__likeCelebrationFixture; const index = f.cursor++; if (!(index in f.hooks)) f.hooks[index] = initial; return [f.hooks[index], (value) => { f.hooks[index] = typeof value === 'function' ? value(f.hooks[index]) : value; }]; }
    export function useEffect(callback, deps) { const f = globalThis.__likeCelebrationFixture; const index = f.cursor++; f.nextEffects.push({index, callback, deps}); }
  `),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "react-dom": moduleUrl("export function createPortal(children, container) { return {children, container}; }"),
  "next/navigation": moduleUrl("export function useRouter() { return {push: (url) => globalThis.__likeCelebrationFixture.routes.push(url)}; }"),
  "@/hooks/useAuth": moduleUrl("export function useMe() { return {data: globalThis.__likeCelebrationFixture.me}; }"),
  "@/hooks/useLibrary": moduleUrl(`
    export function useLikedIds() { const f = globalThis.__likeCelebrationFixture; return new Set(f.liked ? [String(f.track.id)] : []); }
    export function useLikePending() { return globalThis.__likeCelebrationFixture.pending; }
    export function useToggleLike() { const f = globalThis.__likeCelebrationFixture; return {isPending: f.mutationPending, mutate: (variables, callbacks) => f.requests.push({variables, callbacks})}; }
  `),
  "@/components/icons": moduleUrl("export function HeartIcon() { return null; }"),
  "./LikeButton.motion": new URL("../src/components/LikeButton.motion.ts", import.meta.url).href,
  "./LikeButton.module.css": moduleUrl("export default new Proxy({}, {get: (_target, property) => String(property)});"),
};
const source = await readFile(new URL("../src/components/LikeButton.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(stubs[name], `Unmocked LikeButton import: ${name}`);
  return `from ${JSON.stringify(stubs[name])}`;
});
const { default: LikeButton } = await import(moduleUrl(compiled));

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of listeners.get(type) ?? []) listener(); },
  };
}

function sourceButton({ left = 320, top = 400, surface = { left: 10, top: 390, width: 370, height: 64 } } = {}) {
  return {
    isConnected: true,
    getBoundingClientRect: () => ({ left, top, width: 36, height: 36 }),
    closest: () => surface ? { getBoundingClientRect: () => surface } : null,
  };
}

function unmount() {
  for (const effect of fixture.effects) effect?.cleanup?.();
  fixture.effects = [];
}

function setup(overrides = {}) {
  unmount();
  Object.assign(fixture, {
    hooks: [], cursor: 0, nextEffects: [], effects: [],
    me: { id: "local-user" }, liked: false, pending: false,
    mutationPending: false, requests: [], routes: [],
    track: { id: "916424", title: "Without Me" },
    timers: new Map(), ...overrides,
  });
  globalThis.window = {
    ...eventTarget(), innerWidth: 390, innerHeight: 844,
    setTimeout(callback, duration) { const id = Symbol("timer"); fixture.timers.set(id, {callback, duration}); return id; },
    clearTimeout(id) { fixture.timers.delete(id); },
  };
  globalThis.document = { ...eventTarget(), body: {}, hidden: false };
}

function render() {
  fixture.cursor = 0;
  fixture.nextEffects = [];
  const screen = LikeButton({ track: fixture.track });
  for (const effect of fixture.nextEffects) {
    const previous = fixture.effects[effect.index];
    if (previous && effect.deps.every((value, index) => Object.is(value, previous.deps[index]))) continue;
    previous?.cleanup?.();
    fixture.effects[effect.index] = { ...effect, cleanup: effect.callback() };
  }
  return { button: screen.props.children[0].props, celebration: screen.props.children[1] };
}

function complete(request = fixture.requests.at(-1), success = true) {
  if (success) request.callbacks.onSuccess();
  request.callbacks.onSettled();
}

test("initial liked state has a pressed heart and no one-shot celebration", () => {
  setup({ liked: true });
  const screen = render();
  assert.equal(screen.button["aria-pressed"], true);
  assert.equal(screen.celebration, null);
  assert.equal(fixture.timers.size, 0);
});

test("a saved like celebrates once in a body portal, never before the API succeeds", () => {
  setup();
  const screen = render();
  const button = sourceButton();
  screen.button.onClick({ currentTarget: button });
  screen.button.onClick({ currentTarget: button });
  assert.equal(fixture.requests.length, 1, "double-click before a render must not duplicate writes");
  assert.equal(render().celebration, null);
  assert.equal(fixture.requests[0].variables.liked, false);
  complete();
  fixture.liked = true;
  const saved = render();
  assert.equal(saved.button["aria-pressed"], true);
  assert.match(saved.button.className, /celebrating/);
  const portal = saved.celebration.type(saved.celebration.props);
  assert.equal(portal.container, document.body);
  assert.equal(portal.children.props["aria-hidden"], "true");
  assert.equal(saved.celebration.props.burst.particles.length, 40);
  assert.equal(fixture.timers.size, 1);
  assert.equal([...fixture.timers.values()][0].duration, LIKE_BURST_DURATION);
});

test("failed likes do not celebrate and their next explicit retry can succeed", () => {
  setup();
  render().button.onClick({ currentTarget: sourceButton() });
  complete(undefined, false);
  assert.equal(render().celebration, null);
  render().button.onClick({ currentTarget: sourceButton() });
  assert.equal(fixture.requests.length, 2);
  complete();
  assert.ok(render().celebration);
});

test("unlikes cancel a previous bloom and do not start a new success celebration", () => {
  setup();
  render().button.onClick({ currentTarget: sourceButton() });
  complete();
  fixture.liked = true;
  assert.ok(render().celebration);
  render().button.onClick({ currentTarget: sourceButton() });
  assert.equal(fixture.requests.at(-1).variables.liked, true);
  assert.equal(render().celebration, null);
  complete();
  fixture.liked = false;
  assert.equal(render().celebration, null);
  assert.equal(fixture.timers.size, 0);
});

test("signed-out, shared-pending, and mutation-pending buttons cannot start a like", () => {
  setup({ me: null });
  render().button.onClick({ currentTarget: sourceButton() });
  assert.deepEqual(fixture.routes, ["/login"]);
  assert.equal(fixture.requests.length, 0);
  for (const pending of [{ pending: true }, { mutationPending: true }]) {
    setup(pending);
    const screen = render();
    assert.equal(screen.button.disabled, true);
    assert.equal(screen.button["aria-busy"], true);
    screen.button.onClick({ currentTarget: sourceButton() });
    assert.equal(fixture.requests.length, 0);
  }
});

test("late saves after detachment, a track change, or unmount cannot launch a ghost bloom", () => {
  setup();
  const button = sourceButton();
  render().button.onClick({ currentTarget: button });
  button.isConnected = false;
  complete();
  assert.equal(render().celebration, null);
  setup();
  render().button.onClick({ currentTarget: sourceButton() });
  const oldRequest = fixture.requests[0];
  fixture.track = { id: "66609426", title: "Get Lucky" };
  render();
  complete(oldRequest);
  assert.equal(render().celebration, null);
  setup();
  render().button.onClick({ currentTarget: sourceButton() });
  unmount();
  complete();
  assert.equal(fixture.hooks[3].celebration, null);
});

test("the same component instance cannot resurrect a previous song's burst after A, B, A", () => {
  setup();
  const firstTrack = fixture.track;
  render().button.onClick({ currentTarget: sourceButton() });
  complete();
  const firstBurst = render().celebration;
  assert.ok(firstBurst);
  assert.equal(fixture.timers.size, 1);

  fixture.track = { id: "66609426", title: "Get Lucky" };
  assert.equal(render().celebration, null);
  assert.equal(fixture.timers.size, 0);
  assert.equal(document.listeners.get("scroll").size, 0);

  // The first burst's expiry has been cancelled. Returning immediately must
  // discard it permanently rather than restart its lifetime and animation.
  fixture.track = firstTrack;
  assert.equal(render().celebration, null);
  assert.equal(render().celebration, null);
  assert.equal(fixture.timers.size, 0);

  // A new deliberate saved like still gets its own fresh burst for A.
  render().button.onClick({ currentTarget: sourceButton() });
  complete();
  const newBurst = render().celebration;
  assert.ok(newBurst);
  assert.notEqual(newBurst.props.burst.id, firstBurst.props.burst.id);
});

test("scroll, resize, hidden pages, timer expiry, and unmount clean up the effect", () => {
  for (const trigger of ["scroll", "resize", "visibilitychange", "timer", "unmount"]) {
    setup();
    render().button.onClick({ currentTarget: sourceButton() });
    complete();
    assert.ok(render().celebration);
    if (trigger === "unmount") unmount();
    else {
      if (trigger === "timer") [...fixture.timers.values()][0].callback();
      else if (trigger === "resize") window.dispatch(trigger);
      else {
        if (trigger === "visibilitychange") document.hidden = true;
        document.dispatch(trigger);
      }
      assert.equal(render().celebration, null, trigger);
    }
    assert.equal(fixture.timers.size, 0, trigger);
    assert.equal(document.listeners.get("scroll").size, 0, trigger);
    assert.equal(window.listeners.get("resize").size, 0, trigger);
    assert.equal(document.listeners.get("visibilitychange").size, 0, trigger);
  }
});

test("mobile edge particles stay inside the viewport and the surface flare is bounded", () => {
  for (const [left, top] of [[0, 0], [354, 0], [0, 808], [354, 808]]) {
    const geometry = getLikeBurstGeometry(sourceButton({ left, top, surface: { left: -80, top: -40, width: 550, height: 920 } }), 390, 844);
    assert.deepEqual(geometry.surface, { left: 0, top: 0, width: 390, height: 844 });
    for (const particle of geometry.particles) {
      const margin = particle.size / 2 + 5;
      assert.ok(geometry.x + particle.x >= margin - .001);
      assert.ok(geometry.x + particle.x <= 390 - margin + .001);
      assert.ok(geometry.y + particle.y >= margin - .001);
      assert.ok(geometry.y + particle.y <= 844 - margin + .001);
    }
  }
  assert.equal(getLikeBurstGeometry(sourceButton({ surface: null }), 390, 844).surface, null);
  assert.throws(() => getLikeBurstGeometry(sourceButton(), 0, 844), /positive, finite viewport/);
});

test("reduced motion replaces all animated decoration with an explicit static heart", async () => {
  const css = await readFile(new URL("../src/components/LikeButton.module.css", import.meta.url), "utf8");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.celebrating \.heart \{ animation: none/);
  assert.match(reduced, /\.surface, \.origin > :not\(\.motionlessFeedback\) \{ display: none; animation: none/);
  assert.match(reduced, /\.motionlessFeedback \{\s*display: grid/);
});
