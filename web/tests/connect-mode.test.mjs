import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier === "./queuePolicy" && context.parentURL?.endsWith("/store/player.ts")) {
      return nextResolve(new URL("../src/store/queuePolicy.ts", import.meta.url).href, context);
    }
    if (specifier === "./player" && context.parentURL?.endsWith("/store/playerSession.ts")) {
      return nextResolve(new URL("../src/store/player.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const localMap = new Map();
const sessionMap = new Map();
globalThis.localStorage = {
  getItem: (k) => localMap.get(k) ?? null,
  setItem: (k, v) => localMap.set(k, String(v)),
  removeItem: (k) => localMap.delete(k),
};
globalThis.sessionStorage = {
  getItem: (k) => sessionMap.get(k) ?? null,
  setItem: (k, v) => sessionMap.set(k, String(v)),
  removeItem: (k) => sessionMap.delete(k),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
  location: { origin: "http://127.0.0.1:3000" },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  dispatchEvent: () => true,
};

const {
  connectWsUrl,
  detectBrowserDeviceName,
  interpolatedPositionSec,
  normalizeConnectTrack,
  parseConnectServerMessage,
} = await import("../src/lib/connectProtocol.ts");
const { ConnectSocket } = await import("../src/lib/connectSocket.ts");
const {
  buildConnectPlaybackSnapshot,
  executeLocalConnectCommand,
} = await import("../src/lib/connectCommands.ts");
const {
  activeRemoteDevice,
  canControlActiveVolume,
  isControllingRemoteDevice,
  shouldShowPlayerBarDeviceSelector,
  useConnectStore,
} = await import("../src/store/connect.ts");
const { usePartyStore } = await import("../src/store/party.ts");
const { usePlayerStore } = await import("../src/store/player.ts");
const { capturePlayerSession } = await import("../src/store/playerSession.ts");
const {
  createCustomServer,
  isApiPath,
  parseServerArgs,
  proxyApiHttp,
  proxyApiUpgrade,
  resolveApiOrigin,
} = await import("../server.mjs");
resolver.deregister();

const makeTrack = (id) => ({
  id: String(id),
  title: `Track ${id}`,
  artist: "Artist",
  artist_id: "10",
  artists: [{ id: "10", name: "Artist" }],
  album: "Album",
  album_id: "20",
  cover: "/cover.jpg",
  duration_sec: 180,
});

const makeDevice = (id, overrides = {}) => ({
  device_id: id,
  name: `Device ${id}`,
  device_type: "web",
  capabilities: { can_play_audio: true, can_control_volume: true },
  volume: 0.8,
  muted: false,
  is_active: false,
  party_code: null,
  connected_at: "2026-11-24T00:00:00Z",
  last_seen_at: "2026-11-24T00:00:00Z",
  ...overrides,
});

const emptyPlayback = () => ({
  queue: [makeTrack(1)],
  origins: ["context"],
  queue_context: "Mix",
  current_index: 0,
  is_playing: true,
  position_sec: 25,
  duration_sec: 180,
  shuffle: false,
  repeat: "off",
  volume: 0.7,
  muted: false,
  updated_at: "2026-11-24T00:00:00.000Z",
});

beforeEach(() => {
  localMap.clear();
  sessionMap.clear();
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  useConnectStore.setState(useConnectStore.getInitialState(), true);
  usePartyStore.setState(usePartyStore.getInitialState(), true);
});

test("connect protocol parser strictly decodes valid frames and throws loudly on corrupt data", () => {
  const welcome = parseConnectServerMessage(
    JSON.stringify({
      type: "welcome",
      self_device_id: "web-1",
      heartbeat_interval_sec: 20,
      state: {
        revision: 1,
        active_device_id: "web-1",
        devices: [makeDevice("web-1", { is_active: true })],
        playback: emptyPlayback(),
        server_time: "2026-11-24T00:00:05.000Z",
      },
    }),
  );
  assert.equal(welcome.type, "welcome");
  assert.equal(welcome.self_device_id, "web-1");
  assert.equal(welcome.state.devices.length, 1);

  assert.throws(() => parseConnectServerMessage("{"), /ungültiges JSON/);
  assert.throws(() => parseConnectServerMessage(JSON.stringify({ type: "mystery" })), /Unbekannter Nachrichtentyp/);
  assert.throws(
    () =>
      parseConnectServerMessage(
        JSON.stringify({
          type: "command",
          command_id: "c1",
          from_device_id: "m1",
          action: "nuke_everything",
          payload: {},
        }),
      ),
    /Unbekannter Connect-Befehl/,
  );
  assert.throws(
    () =>
      parseConnectServerMessage(
        JSON.stringify({
          type: "state",
          state: {
            revision: 1,
            active_device_id: null,
            devices: [makeDevice("x", { device_type: "fridge" })],
            playback: emptyPlayback(),
          },
        }),
      ),
    /device_type/,
  );
});

test("connect helpers normalize tracks, interpolate playhead, detect browser name, and build WS URL", () => {
  const normalized = normalizeConnectTrack({
    id: "42",
    title: "Song",
    artist: "Band",
    album: "LP",
    cover: "",
    duration_sec: 123.4,
  });
  assert.equal(normalized.duration_sec, 123);
  assert.deepEqual(normalized.artists, []);
  assert.equal(normalized.preview_url, "");

  const pb = emptyPlayback();
  const baseMs = Date.parse(pb.updated_at);
  assert.equal(interpolatedPositionSec(pb, baseMs + 10_000, 0), 35);
  assert.equal(interpolatedPositionSec(pb, baseMs + 500_000, 0), 180);
  assert.equal(interpolatedPositionSec({ ...pb, is_playing: false }, baseMs + 10_000, 0), 25);

  assert.equal(
    detectBrowserDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/131.0 Safari/537.36"),
    "Chrome auf macOS",
  );
  assert.equal(connectWsUrl("https://music.example.com"), "wss://music.example.com/api/connect/ws");
  assert.equal(
    connectWsUrl("http://127.0.0.1:3000", "tok123"),
    "ws://127.0.0.1:3000/api/connect/ws?ticket=tok123",
  );
});

test("device selector visibility strictly follows the locked multi-device / remote / Jam rule", () => {
  const oneDevice = {
    enabled: true,
    status: "connected",
    deviceId: "web-1",
    activeDeviceId: "web-1",
    devices: [makeDevice("web-1", { is_active: true })],
  };
  assert.equal(shouldShowPlayerBarDeviceSelector(oneDevice, false), false);
  assert.equal(shouldShowPlayerBarDeviceSelector(oneDevice, true), true);

  const twoDevices = {
    ...oneDevice,
    devices: [makeDevice("web-1", { is_active: true }), makeDevice("mob-1", { device_type: "mobile" })],
  };
  assert.equal(shouldShowPlayerBarDeviceSelector(twoDevices, false), true);
  assert.equal(isControllingRemoteDevice(twoDevices), false);

  const controllingMobile = {
    ...twoDevices,
    activeDeviceId: "mob-1",
    devices: [
      makeDevice("web-1", { is_active: false }),
      makeDevice("mob-1", {
        device_type: "mobile",
        is_active: true,
        capabilities: { can_play_audio: true, can_control_volume: false },
      }),
    ],
  };
  assert.equal(isControllingRemoteDevice(controllingMobile), true);
  assert.equal(activeRemoteDevice(controllingMobile)?.device_id, "mob-1");
  assert.equal(canControlActiveVolume(controllingMobile), false);
  assert.equal(canControlActiveVolume(twoDevices), true);
});

test("executeLocalConnectCommand runs every action strictly and fails loud on invalid payloads", () => {
  const store = () => usePlayerStore.getState();
  executeLocalConnectCommand(
    "play_tracks",
    { tracks: [makeTrack(1), makeTrack(2)], start_index: 0, queue_context: "Album" },
    store(),
  );
  assert.equal(store().queue.length, 2);
  assert.equal(store().index, 0);
  assert.equal(store().isPlaying, true);

  executeLocalConnectCommand("pause", {}, store());
  assert.equal(store().isPlaying, false);

  executeLocalConnectCommand("seek", { position_sec: 42 }, store());
  assert.equal(store().currentTime, 42);

  executeLocalConnectCommand("set_volume", { volume: 0.45 }, store());
  assert.equal(store().volume, 0.45);

  executeLocalConnectCommand("queue_add", { track: makeTrack(3) }, store());
  assert.deepEqual(store().queue.map((t) => t.id), ["1", "3", "2"]);

  executeLocalConnectCommand("queue_play_next", { track: makeTrack(4) }, store());
  assert.deepEqual(store().queue.map((t) => t.id), ["1", "4", "3", "2"]);

  executeLocalConnectCommand("select_index", { index: 2 }, store());
  assert.equal(store().index, 2);

  executeLocalConnectCommand("clear_queue", {}, store());
  assert.deepEqual(store().queue.map((t) => t.id), ["1", "4", "3"]);

  const snap = buildConnectPlaybackSnapshot(store());
  assert.equal(snap.queue.length, 3);
  assert.equal(snap.origins.length, 3);

  assert.throws(() => executeLocalConnectCommand("seek", { position_sec: -5 }, store()), /position_sec/);
  assert.throws(() => executeLocalConnectCommand("set_volume", { volume: 2 }, store()), /volume/);
  assert.throws(() => executeLocalConnectCommand("play_tracks", { tracks: [], start_index: 0 }, store()), /tracks/);
  assert.throws(() => executeLocalConnectCommand("select_index", { index: 99 }, store()), /außerhalb/);
});

test("player store remoteBridge routes commands, yields to partyBridge, and skips session persistence", () => {
  const calls = [];
  const remoteBridge = {
    playTrack: (t) => calls.push(["playTrack", t.id]),
    playQueue: (ts, idx) => calls.push(["playQueue", ts.length, idx]),
    addToQueue: (t) => calls.push(["addToQueue", t.id]),
    playNext: (t) => calls.push(["playNext", t.id]),
    removeFromQueue: (i) => calls.push(["removeFromQueue", i]),
    clearQueue: () => calls.push(["clearQueue"]),
    reorderQueue: (a, b) => calls.push(["reorderQueue", a, b]),
    jumpTo: (i) => calls.push(["jumpTo", i]),
    toggle: () => calls.push(["toggle"]),
    play: () => calls.push(["play"]),
    pause: () => calls.push(["pause"]),
    next: () => calls.push(["next"]),
    prev: () => calls.push(["prev"]),
    seek: (t) => calls.push(["seek", t]),
    setVolume: (v) => calls.push(["setVolume", v]),
    toggleMute: () => calls.push(["toggleMute"]),
    toggleShuffle: () => calls.push(["toggleShuffle"]),
    cycleRepeat: () => calls.push(["cycleRepeat"]),
  };

  usePlayerStore.getState().setRemoteBridge(remoteBridge);
  usePlayerStore.getState().setSuppressLocalAudio(true);
  usePlayerStore.getState().applyRemotePlaybackState(emptyPlayback(), 30);

  assert.equal(usePlayerStore.getState().index, 0);
  assert.equal(usePlayerStore.getState().currentTime, 30);
  assert.equal(usePlayerStore.getState().seekTo, null);
  assert.equal(capturePlayerSession(usePlayerStore.getState(), "1"), null);

  usePlayerStore.getState().toggle();
  usePlayerStore.getState().seek(55);
  usePlayerStore.getState().next();
  assert.deepEqual(calls, [["toggle"], ["seek", 55], ["next"]]);

  // Activating playback locally restores normal ownership and requests seek to transfer playhead.
  usePlayerStore.getState().activateConnectPlayback(emptyPlayback());
  assert.equal(usePlayerStore.getState().remoteBridge, null);
  assert.equal(usePlayerStore.getState().suppressLocalAudio, false);
  assert.equal(usePlayerStore.getState().seekTo, 25);
});

test("server.mjs CLI parsing, origin resolution, and live HTTP + WS upgrade proxy preserve cookies", async () => {
  assert.deepEqual(
    parseServerArgs(["--hostname", "0.0.0.0", "--port", "3456", "--dev"], {}),
    { hostname: "0.0.0.0", port: 3456, dev: true },
  );
  assert.throws(() => parseServerArgs(["--bogus"], {}), /Unknown server option/);
  assert.throws(() => parseServerArgs(["--port", "0"], {}), /Invalid server port/);

  assert.equal(resolveApiOrigin({ LR_API_PROXY: "http://127.0.0.1:9000/api/:path*" }).origin, "http://127.0.0.1:9000");
  assert.equal(resolveApiOrigin({ API_PORT: "8123" }).origin, "http://127.0.0.1:8123");
  assert.equal(isApiPath("/api/connect/ws"), true);
  assert.equal(isApiPath("/_next/webpack-hmr"), false);

  // Spin up an upstream mock server that echoes HTTP + upgrades WS with Cookie verification.
  const upgradedSockets = new Set();
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie ?? null }));
  });
  upstream.on("upgrade", (req, socket) => {
    upgradedSockets.add(socket);
    socket.on("close", () => upgradedSockets.delete(socket));
    const cookie = req.headers.cookie ?? "";
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Echo-Cookie: ${cookie}\r\n\r\n`,
    );
    socket.on("data", (chunk) => socket.write(chunk));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamOrigin = new URL(`http://127.0.0.1:${upstream.address().port}`);

  const proxy = http.createServer((req, res) => proxyApiHttp(req, res, upstreamOrigin));
  proxy.on("upgrade", (req, socket, head) => {
    upgradedSockets.add(socket);
    socket.on("close", () => upgradedSockets.delete(socket));
    proxyApiUpgrade(req, socket, head, upstreamOrigin);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyPort = proxy.address().port;

  try {
    // 1. HTTP proxy check
    const httpRes = await fetch(`http://127.0.0.1:${proxyPort}/api/connect/state`, {
      headers: { Cookie: "sf_session=abc123", Connection: "close" },
    });
    assert.equal(httpRes.status, 200);
    assert.deepEqual(await httpRes.json(), { path: "/api/connect/state", cookie: "sf_session=abc123" });

    // 2. WebSocket upgrade tunnel + cookie preservation + bidirectional pipe check
    const rawReply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("Timed out waiting for proxied WS upgrade echo"));
      }, 3000);
      let sent = false;
      const client = net.connect({ host: "127.0.0.1", port: proxyPort }, () => {
        client.write(
          "GET /api/connect/ws HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${proxyPort}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Cookie: sf_session=ws-cookie-ok\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n\r\n",
        );
      });
      let data = "";
      client.on("data", (chunk) => {
        data += chunk.toString("utf8");
        if (data.includes("\r\n\r\n") && !sent) {
          sent = true;
          client.write("PING-ECHO");
        }
        if (data.includes("PING-ECHO")) {
          clearTimeout(timer);
          client.destroy();
          resolve(data);
        }
      });
      client.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    assert.match(rawReply, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.match(rawReply, /X-Echo-Cookie: sf_session=ws-cookie-ok/);
    assert.match(rawReply, /PING-ECHO/);
  } finally {
    for (const sock of upgradedSockets) sock.destroy();
    proxy.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});

test("ConnectSocket.sendTransfer resolves only when active_device_id matches target and rejects on error", async () => {
  const sent = [];
  const sockets = [];
  const origWs = globalThis.WebSocket;
  class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    constructor() {
      sockets.push(this);
    }
    send(raw) {
      sent.push(JSON.parse(raw));
    }
    close() {
      this.readyState = 3;
    }
  }
  globalThis.WebSocket = FakeWebSocket;
  try {
    const sock = new ConnectSocket({
      buildRegister: () => ({
        type: "register",
        device_id: "web-1",
        name: "Web",
        device_type: "web",
        capabilities: { can_play_audio: true, can_control_volume: true },
        volume: 0.8,
        muted: false,
        party_code: null,
        take_active: false,
      }),
      onMessage() {},
      onStatusChange() {},
    });
    sock.start();
    const fakeWs = sockets[0];
    fakeWs.onopen();

    // 1. Routine state frame for another active device must NOT falsely resolve a transfer to "mob-1".
    let resolved = false;
    const p1 = sock.sendTransfer("mob-1").then(() => {
      resolved = true;
    });
    fakeWs.onmessage({
      data: JSON.stringify({
        type: "state",
        state: {
          revision: 2,
          active_device_id: "web-1",
          devices: [makeDevice("web-1", { is_active: true }), makeDevice("mob-1")],
          playback: emptyPlayback(),
        },
      }),
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(resolved, false);

    // Matching active_device_id resolves it cleanly.
    fakeWs.onmessage({
      data: JSON.stringify({
        type: "state",
        state: {
          revision: 3,
          active_device_id: "mob-1",
          devices: [makeDevice("web-1"), makeDevice("mob-1", { is_active: true })],
          playback: emptyPlayback(),
        },
      }),
    });
    await p1;
    assert.equal(resolved, true);

    // 2. Server error with matching request_id rejects loudly.
    const p2 = sock.sendTransfer("tv-1");
    const transferMsg = sent.at(-1);
    fakeWs.onmessage({
      data: JSON.stringify({
        type: "error",
        code: "device_unreachable",
        detail: "Zielgerät nicht erreichbar",
        request_id: transferMsg.request_id,
      }),
    });
    await assert.rejects(p2, /device_unreachable/);

    sock.dispose();
  } finally {
    globalThis.WebSocket = origWs;
  }
});

test("ended Jam state is scoped to its endedCode and never blocks joining a subsequent Jam", () => {
  usePartyStore.getState().setActiveCode("AAA111");
  usePartyStore.getState().markEnded("Die Jam wurde vom Host beendet.", "AAA111");
  assert.equal(usePartyStore.getState().ended, true);
  assert.equal(usePartyStore.getState().endedCode, "AAA111");

  // Switching to a brand-new Jam clears the prior Jam's ended marker.
  usePartyStore.getState().setActiveCode("BBB222");
  assert.equal(usePartyStore.getState().ended, false);
  assert.equal(usePartyStore.getState().endedCode, null);
  assert.equal(usePartyStore.getState().code, "BBB222");
});

test("remote volume capability blocks remoteBridge setVolume/toggleMute on mobile devices", async () => {
  // Compile createConnectRemoteBridge directly to verify keyboard shortcut volume guard.
  const { compileSource, moduleUrl } = await import("./support/compile.mjs");
  const connectEngineUrl = await compileSource(
    "src/components/player/ConnectEngine.tsx",
    {
      react: moduleUrl("export function useEffect() {} export function useRef(v) { return { current: v }; }"),
      "@/hooks/useAuth": moduleUrl("export function useMe() { return { data: null }; }"),
      "@/lib/connectSocket": moduleUrl("export class ConnectSocket {}"),
      "@/lib/connectProtocol": new URL("../src/lib/connectProtocol.ts", import.meta.url).href,
      "@/lib/connectCommands": new URL("../src/lib/connectCommands.ts", import.meta.url).href,
      "@/store/connect": new URL("../src/store/connect.ts", import.meta.url).href,
      "@/store/party": new URL("../src/store/party.ts", import.meta.url).href,
      "@/store/player": new URL("../src/store/player.ts", import.meta.url).href,
      "@/store/toast": moduleUrl("export const toast = { info() {}, error() {}, success() {} };"),
    },
    "connect-engine",
  );
  const { createConnectRemoteBridge, isNonHostJamFollower } = await import(connectEngineUrl);

  assert.equal(isNonHostJamFollower({ active: true, isHost: false }), true);
  assert.equal(isNonHostJamFollower({ active: true, isHost: true }), false);
  assert.equal(isNonHostJamFollower({ active: false, isHost: false }), false);

  useConnectStore.setState({
    enabled: true,
    status: "connected",
    deviceId: "web-1",
    activeDeviceId: "mob-1",
    devices: [
      makeDevice("web-1"),
      makeDevice("mob-1", {
        name: "Pixel",
        device_type: "mobile",
        is_active: true,
        capabilities: { can_play_audio: true, can_control_volume: false },
      }),
    ],
  });
  usePlayerStore.setState({ volume: 0.75, muted: false });

  const sent = [];
  const notices = [];
  const bridge = createConnectRemoteBridge(
    (action, payload) => sent.push([action, payload]),
    (name) => notices.push(name),
  );
  usePlayerStore.getState().setRemoteBridge(bridge);

  // Simulates ArrowUp / M keyboard shortcuts hitting usePlayerStore directly.
  usePlayerStore.getState().setVolume(0.2);
  usePlayerStore.getState().toggleMute();
  assert.deepEqual(sent, []);
  assert.deepEqual(notices, ["Pixel", "Pixel"]);
  assert.equal(usePlayerStore.getState().volume, 0.75);
  assert.equal(usePlayerStore.getState().muted, false);
});

test("createCustomServer blocks Next.js lazy duplicate upgrade listener so /api/connect/ws succeeds after a page request", async () => {
  const { createHash } = await import("node:crypto");
  const sockets = new Set();

  // Upstream API on a non-8000 ephemeral port performing a real RFC 6455 WS handshake + welcome JSON frame.
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify({ ok: true }));
  });
  upstream.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const welcome = Buffer.from(
      JSON.stringify({ type: "welcome", self_device_id: "web-1", cookie: req.headers.cookie ?? "" }),
      "utf8",
    );
    const frame = Buffer.concat([Buffer.from([0x81, welcome.length]), welcome]);
    socket.write(frame);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstream.address().port;
  assert.notEqual(upstreamPort, 8000);
  const upstreamOrigin = resolveApiOrigin({ LR_API_PROXY: `http://127.0.0.1:${upstreamPort}/api/:path*` });

  let nextUpgradeCalls = 0;
  let duplicateUpgradeCalls = 0;
  const server = createCustomServer({
    upstream: upstreamOrigin,
    handleRequest: (req, res) => {
      // Simulate Next.js 16's lazy `setupWebSocketHandler`: attaches a second `upgrade` listener on first page GET.
      req.socket.server.on("upgrade", () => {
        duplicateUpgradeCalls += 1;
      });
      res.writeHead(200, { "Content-Type": "text/html", Connection: "close" });
      res.end("<html>ok</html>");
    },
    handleUpgrade: (_req, socket) => {
      nextUpgradeCalls += 1;
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      socket.end();
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = server.address().port;

  try {
    // 1. First page request tries to register a second upgrade listener (like Next.js 16 does).
    const pageRes = await fetch(`http://127.0.0.1:${serverPort}/playlist/1`, {
      headers: { Connection: "close" },
    });
    assert.equal(pageRes.status, 200);
    assert.equal(server.listenerCount("upgrade"), 1);

    // 2. Subsequent WS /api/connect/ws receives a single clean 101 + welcome JSON frame with Cookie preserved.
    const wsBytes = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("Timed out waiting for welcome frame over proxied WS"));
      }, 3000);
      const client = net.connect({ host: "127.0.0.1", port: serverPort }, () => {
        client.write(
          "GET /api/connect/ws HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${serverPort}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Cookie: sf_session=real-cookie\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n\r\n",
        );
      });
      const chunks = [];
      client.on("data", (chunk) => {
        chunks.push(chunk);
        const merged = Buffer.concat(chunks);
        const sep = merged.indexOf("\r\n\r\n");
        if (sep !== -1 && merged.length > sep + 6) {
          const payloadLen = merged[sep + 5] & 0x7f;
          if (merged.length >= sep + 6 + payloadLen) {
            clearTimeout(timer);
            client.destroy();
            resolve(merged);
          }
        }
      });
      client.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const sep = wsBytes.indexOf("\r\n\r\n");
    const headersText = wsBytes.subarray(0, sep).toString("utf8");
    assert.match(headersText, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.equal(headersText.split("101 Switching Protocols").length - 1, 1);
    const payloadLen = wsBytes[sep + 5] & 0x7f;
    const payload = JSON.parse(wsBytes.subarray(sep + 6, sep + 6 + payloadLen).toString("utf8"));
    assert.deepEqual(payload, { type: "welcome", self_device_id: "web-1", cookie: "sf_session=real-cookie" });
    assert.equal(duplicateUpgradeCalls, 0);
    assert.equal(nextUpgradeCalls, 0);

    // 3. Non-API upgrade (e.g. HMR) routes to Next's handleUpgrade exactly once.
    await new Promise((resolve, reject) => {
      const client = net.connect({ host: "127.0.0.1", port: serverPort }, () => {
        client.write(
          "GET /_next/webpack-hmr HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${serverPort}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n\r\n",
        );
      });
      client.resume();
      client.on("end", () => {
        client.destroy();
        resolve();
      });
      client.on("close", resolve);
      client.on("error", reject);
    });
    assert.equal(nextUpgradeCalls, 1);
    assert.equal(duplicateUpgradeCalls, 0);
  } finally {
    for (const sock of sockets) sock.destroy();
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});

test("multiple DeviceSelectorTrigger instances never duplicate dialogs — only single DeviceSelectorHost renders popover", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { compileSource, moduleUrl } = await import("./support/compile.mjs");

  const iconsStub = moduleUrl(`
    export function DevicesIcon() { return null; }
    export const CheckIcon = DevicesIcon;
    export const CloseIcon = DevicesIcon;
    export const EditIcon = DevicesIcon;
    export const LaptopIcon = DevicesIcon;
    export const PhoneIcon = DevicesIcon;
    export const RefreshIcon = DevicesIcon;
    export const SpeakerIcon = DevicesIcon;
    export const SpinnerIcon = DevicesIcon;
    export const TabletIcon = DevicesIcon;
    export const TvIcon = DevicesIcon;
    export const UsersIcon = DevicesIcon;
  `);
  const nullStub = moduleUrl("export default function Null() { return null; }");
  const prevDoc = globalThis.document;
  globalThis.document = { body: {} };
  const connectState = {
    enabled: true,
    status: "connected",
    error: null,
    deviceId: "web-1",
    deviceName: "Chrome auf macOS",
    activeDeviceId: "web-1",
    devices: [
      makeDevice("web-1", { name: "Chrome auf macOS", is_active: true }),
      makeDevice("mob-1", { name: "Pixel 9", device_type: "mobile" }),
    ],
    transferringToId: null,
    selectorOpen: true,
    selectorAnchor: null,
    actions: null,
    setSelectorOpen(open) {
      connectState.selectorOpen = open;
    },
    setEnabled() {},
    setDeviceNameLocal() {},
  };
  globalThis.__deviceSelectorTestConnect = connectState;

  try {
    const connectStub = moduleUrl(`
      export function useConnectStore(selector) { return selector(globalThis.__deviceSelectorTestConnect); }
      useConnectStore.getState = () => globalThis.__deviceSelectorTestConnect;
      export function isControllingRemoteDevice(s) { return s.activeDeviceId !== null && s.activeDeviceId !== s.deviceId; }
      export function activeRemoteDevice(s) { return isControllingRemoteDevice(s) ? s.devices.find((d) => d.device_id === s.activeDeviceId) ?? null : null; }
      export function shouldShowPlayerBarDeviceSelector(s, partyActive) { return partyActive || s.devices.length > 1 || isControllingRemoteDevice(s); }
    `);
    const deviceSelectorUrl = await compileSource(
      "src/components/player/DeviceSelector.tsx",
      {
        react: import.meta.resolve("react"),
        "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
        "react-dom": moduleUrl("export function createPortal(children) { return children; }"),
        "next/navigation": moduleUrl("export function useRouter() { return { push() {} }; }"),
        "@tanstack/react-query": moduleUrl("export function useQueryClient() { return {}; }"),
        "@/lib/api": moduleUrl("export const api = {};"),
        "@/lib/partyExit": moduleUrl("export async function exitPartySession() {}"),
        "@/hooks/useDialogFocus": moduleUrl("export function useDialogFocus() {}"),
        "@/components/ConfirmDialog": nullStub,
        "@/components/EqualizerBars": nullStub,
        "@/components/icons": iconsStub,
        "@/store/connect": connectStub,
        "@/store/party": moduleUrl("export const usePartyStore = (s) => s({ active: false, code: null, name: '', isHost: false, members: [] });"),
        "@/store/player": moduleUrl("export const usePlayerStore = (s) => s({ isPlaying: true });"),
        "@/store/toast": moduleUrl("export const toast = { info() {}, error() {}, success() {} };"),
      },
      "device-selector",
    );
    const { DeviceSelectorTrigger, DeviceSelectorHost } = await import(deviceSelectorUrl);

    // Simulate DesktopBar + MiniPlayer + NowPlaying all mounting triggers alongside ONE DeviceSelectorHost.
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(DeviceSelectorTrigger, { key: "desktop" }),
        createElement(DeviceSelectorTrigger, { key: "mobile", compact: true }),
        createElement(DeviceSelectorTrigger, { key: "nowplaying", forceVisible: true }),
        createElement(DeviceSelectorHost, { key: "host" }),
      ),
    );

    const triggerMatches = html.match(/data-testid="device-selector-trigger"/g) ?? [];
    const popoverMatches = html.match(/data-testid="device-selector-popover"/g) ?? [];
    assert.equal(triggerMatches.length, 3);
    assert.equal(popoverMatches.length, 1);

    // Closed state renders zero popovers.
    connectState.selectorOpen = false;
    const closedHtml = renderToStaticMarkup(
      createElement("div", null, createElement(DeviceSelectorTrigger), createElement(DeviceSelectorHost)),
    );
    assert.equal((closedHtml.match(/data-testid="device-selector-popover"/g) ?? []).length, 0);
  } finally {
    delete globalThis.__deviceSelectorTestConnect;
    globalThis.document = prevDoc;
  }
});
