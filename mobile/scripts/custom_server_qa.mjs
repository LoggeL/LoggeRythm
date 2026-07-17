#!/usr/bin/env node

import crypto from 'node:crypto';
import http from 'node:http';
import { Buffer } from 'node:buffer';

const port = Number.parseInt(process.env.LOGGERYTHM_QA_PORT ?? '18765', 10);
const expectedEmail = process.env.LOGGERYTHM_QA_EMAIL;
const expectedPassword = process.env.LOGGERYTHM_QA_PASSWORD;
const redirectTarget = process.env.LOGGERYTHM_QA_REDIRECT_TARGET;

if (
  !Number.isSafeInteger(port)
  || port < 1024
  || port > 65535
  || !expectedEmail
  || !expectedPassword
) {
  throw new Error(
    'Set a valid LOGGERYTHM_QA_PORT plus non-empty LOGGERYTHM_QA_EMAIL and '
      + 'LOGGERYTHM_QA_PASSWORD',
  );
}

const sessionToken = crypto.randomBytes(32).toString('base64url');
const user = Object.freeze({
  id: 1,
  email: expectedEmail,
  display_name: 'RC2 Emulator QA',
  is_admin: true,
  is_approved: true,
  avatar_url: null,
});
const emptyCollectionPaths = new Set([
  '/api/me/likes',
  '/api/playlists',
]);

function json(response, status, body, headers = {}) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': String(encoded.length),
    'Content-Type': 'application/json',
    ...headers,
  });
  response.end(encoded);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16 * 1024) throw new Error('request-too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function hasSession(request) {
  return request.headers.cookie
    ?.split(';')
    .some((part) => part.trim() === `sf_session=${sessionToken}`) ?? false;
}

const server = http.createServer(async (request, response) => {
  const method = request.method ?? '';
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  let status = 500;
  try {
    if (method === 'GET' && path === '/api/version') {
      if (redirectTarget) {
        status = 302;
        response.writeHead(status, {
          'Cache-Control': 'no-store',
          Location: redirectTarget,
        });
        response.end();
        return;
      }
      status = 200;
      json(response, status, {
        api_version: '1.1.0',
        current_contract_version: 'v2',
        compatible_contract_versions: ['v2'],
      });
      return;
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const body = await readJson(request);
      if (
        body?.email !== expectedEmail
        || body?.password !== expectedPassword
      ) {
        status = 401;
        json(response, status, { detail: 'Invalid credentials' });
        return;
      }
      status = 200;
      json(response, status, user, {
        'Set-Cookie':
          `sf_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      });
      return;
    }

    if (method === 'GET' && path === '/api/auth/me') {
      if (!hasSession(request)) {
        status = 401;
        json(response, status, { detail: 'Not authenticated' });
        return;
      }
      status = 200;
      json(response, status, user);
      return;
    }

    if (method === 'GET' && emptyCollectionPaths.has(path)) {
      if (!hasSession(request)) {
        status = 401;
        json(response, status, { detail: 'Not authenticated' });
        return;
      }
      status = 200;
      json(response, status, []);
      return;
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      status = 200;
      json(response, status, { ok: true }, {
        'Set-Cookie':
          'sf_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      });
      return;
    }

    status = 404;
    json(response, status, { detail: 'Not Found' });
  } catch {
    status = 400;
    json(response, status, { detail: 'Invalid request' });
  } finally {
    // Intentionally record only the route and status. Never log headers or bodies.
    process.stdout.write(`${method} ${path} ${status}\n`);
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`LoggeRythm QA server listening on 127.0.0.1:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
