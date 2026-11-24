// Custom Next.js server that streams `/api/*` HTTP requests and tunnels
// `/api/*` WebSocket `Upgrade` connections (preserving Cookie and WS headers)
// to the FastAPI backend. Next.js `rewrites()` alone cannot proxy WebSocket
// upgrades in single-container production (`docker/start.sh`).

import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const API_PROXY_TIMEOUT_MS = 300_000;

/**
 * Parse CLI flags (`--hostname`/`-H`, `--port`/`-p`, `--dev`) and environment
 * defaults so `docker/start.sh` (`npm run start -- --hostname 0.0.0.0 --port 3000`)
 * works identically to `next start`.
 */
export function parseServerArgs(argv = process.argv.slice(2), env = process.env) {
  let hostname = env.HOSTNAME || "0.0.0.0";
  let port = Number(env.PORT || 3000);
  let dev = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dev") {
      dev = true;
    } else if (arg === "--hostname" || arg === "-H") {
      const nextVal = argv[++i];
      if (!nextVal) throw new Error(`${arg} requires a hostname argument.`);
      hostname = nextVal;
    } else if (arg.startsWith("--hostname=")) {
      hostname = arg.slice("--hostname=".length);
    } else if (arg === "--port" || arg === "-p") {
      const nextVal = argv[++i];
      if (!nextVal) throw new Error(`${arg} requires a port argument.`);
      port = Number(nextVal);
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
    } else {
      throw new Error(`Unknown server option: ${arg}`);
    }
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid server port: ${port}`);
  }
  return { hostname, port, dev };
}

/**
 * Resolve the upstream API URL (`http://host:port` or `https://host:port`) from
 * `LR_API_PROXY` (which may include `/api/:path*`) or `API_PORT`.
 */
export function resolveApiOrigin(env = process.env) {
  const raw = env.LR_API_PROXY?.trim();
  if (raw) {
    const cleaned = raw.replace(/\/api(?:\/.*)?$/, "");
    let parsed;
    try {
      parsed = new URL(cleaned);
    } catch (cause) {
      throw new Error(`Invalid LR_API_PROXY URL "${raw}": ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`LR_API_PROXY must use http: or https:, received "${parsed.protocol}".`);
    }
    return parsed;
  }
  const apiPort = Number(env.API_PORT || 8000);
  if (!Number.isInteger(apiPort) || apiPort <= 0 || apiPort > 65535) {
    throw new Error(`Invalid API_PORT: ${env.API_PORT}`);
  }
  return new URL(`http://127.0.0.1:${apiPort}`);
}

export function isApiPath(urlPath) {
  return typeof urlPath === "string" && (urlPath === "/api" || urlPath.startsWith("/api/") || urlPath.startsWith("/api?"));
}

/** Stream an HTTP `/api/*` request directly to FastAPI with zero response buffering (SSE/Range safe). */
export function proxyApiHttp(req, res, upstream) {
  const isHttps = upstream.protocol === "https:";
  const transport = isHttps ? https : http;
  const headers = { ...req.headers, host: upstream.host };
  if (req.headers.host && !headers["x-forwarded-host"]) {
    headers["x-forwarded-host"] = req.headers.host;
  }
  if (req.socket.remoteAddress && !headers["x-forwarded-for"]) {
    headers["x-forwarded-for"] = req.socket.remoteAddress;
  }

  const proxyReq = transport.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (isHttps ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
      agent: false,
      timeout: API_PROXY_TIMEOUT_MS,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy(new Error(`Upstream API timed out after ${API_PROXY_TIMEOUT_MS}ms`));
  });

  proxyReq.on("error", (err) => {
    const detail = `API proxy failed (${req.method} ${req.url}): ${err.message}`;
    console.error(`[web/server] ${detail}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail }));
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  res.on("close", () => {
    if (!res.writableEnded) proxyReq.destroy();
  });

  req.pipe(proxyReq);
}

/**
 * Tunnel an HTTP `Upgrade: websocket` request on `/api/*` directly to FastAPI,
 * preserving all raw headers (Cookie, Sec-WebSocket-*, Origin, etc.).
 */
export function proxyApiUpgrade(req, socket, head, upstream) {
  const isHttps = upstream.protocol === "https:";
  const port = Number(upstream.port || (isHttps ? 443 : 80));

  const upstreamSocket = isHttps
    ? tls.connect({ host: upstream.hostname, port, servername: upstream.hostname })
    : net.connect({ host: upstream.hostname, port });

  let connected = false;

  const failSocket = (statusLine, message) => {
    console.error(`[web/server] WS proxy failed (${req.url}): ${message}`);
    if (!socket.destroyed && !connected) {
      socket.write(
        `HTTP/1.1 ${statusLine}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}`,
      );
    }
    socket.destroy();
    upstreamSocket.destroy();
  };

  upstreamSocket.once("connect", () => {
    connected = true;
    const rawLines = [`${req.method || "GET"} ${req.url} HTTP/${req.httpVersion || "1.1"}`];
    let hasForwardedHost = false;
    let hasForwardedFor = false;

    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = req.rawHeaders[i + 1];
      const lower = name.toLowerCase();
      if (lower === "host") {
        rawLines.push(`Host: ${upstream.host}`);
        continue;
      }
      if (lower === "x-forwarded-host") hasForwardedHost = true;
      if (lower === "x-forwarded-for") hasForwardedFor = true;
      rawLines.push(`${name}: ${value}`);
    }
    if (!hasForwardedHost && req.headers.host) {
      rawLines.push(`X-Forwarded-Host: ${req.headers.host}`);
    }
    if (!hasForwardedFor && req.socket.remoteAddress) {
      rawLines.push(`X-Forwarded-For: ${req.socket.remoteAddress}`);
    }

    upstreamSocket.write(`${rawLines.join("\r\n")}\r\n\r\n`);
    if (head && head.length > 0) upstreamSocket.write(head);

    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstreamSocket.on("error", (err) => failSocket("502 Bad Gateway", err.message));
  socket.on("error", () => upstreamSocket.destroy());
  socket.on("close", () => upstreamSocket.destroy());
  upstreamSocket.on("close", () => socket.destroy());
}

/**
 * Create the HTTP + WebSocket server that owns `/api/*` proxying and delegates
 * everything else to Next.js. Locks the `"upgrade"` event to a single
 * dispatcher so Next.js 16's lazy `setupWebSocketHandler` (which calls
 * `req.socket.server.on("upgrade", ...)` on the first page request) cannot
 * attach a duplicate listener that collides with `/api/*` WebSocket tunnels or
 * double-handles `/_next/webpack-hmr`.
 */
export function createCustomServer({ handleRequest, handleUpgrade, upstream }) {
  const server = http.createServer((req, res) => {
    if (isApiPath(req.url)) {
      proxyApiHttp(req, res, upstream);
      return;
    }
    void Promise.resolve(handleRequest(req, res)).catch((err) => {
      console.error("[web/server] Next request failed:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });
  });

  const onUpgrade = (req, socket, head) => {
    if (isApiPath(req.url)) {
      proxyApiUpgrade(req, socket, head, upstream);
      return;
    }
    void Promise.resolve(handleUpgrade(req, socket, head)).catch((err) => {
      console.error("[web/server] Next upgrade failed:", err);
      if (!socket.destroyed) {
        socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
        socket.destroy();
      }
    });
  };

  server.on("upgrade", onUpgrade);

  for (const method of ["on", "addListener", "prependListener"]) {
    const original = server[method].bind(server);
    server[method] = (event, listener) => {
      if (event === "upgrade") return server;
      return original(event, listener);
    };
  }

  return server;
}

async function start() {
  const { default: next } = await import("next");
  const { hostname, port, dev } = parseServerArgs();
  const upstream = resolveApiOrigin();

  const app = next({ dev, hostname, port });
  const handleRequest = app.getRequestHandler();
  await app.prepare();
  const handleUpgrade = app.getUpgradeHandler();

  const server = createCustomServer({ handleRequest, handleUpgrade, upstream });

  server.listen(port, hostname, () => {
    console.log(
      `> LoggeRythm web (${dev ? "dev" : "prod"}) listening on http://${hostname}:${port} -> API ${upstream.origin}`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error("[web/server] Fatal startup error:", err);
    process.exit(1);
  });
}
