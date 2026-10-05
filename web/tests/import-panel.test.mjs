import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Compile the session used by the real component. Removing its UI imports and
// default component keeps these async tests independent of browser rendering.
const source = await readFile(
  new URL("../src/components/ImportPanel.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "ImportPanel.tsx",
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  transformers: {
    before: [
      () => (file) =>
        ts.factory.updateSourceFile(
          file,
          file.statements.filter(
            (statement) =>
              !ts.isImportDeclaration(statement) &&
              !(
                ts.isFunctionDeclaration(statement) &&
                statement.name?.text === "ImportPanel"
              ),
          ),
        ),
    ],
  },
}).outputText;
const { createImportSession } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function result(name) {
  return {
    type: "playlist",
    name,
    image: "",
    total: 1,
    source_total: 1,
    matched: 1,
    tracks: [{ id: name, title: name }],
    unmatched: [],
  };
}

function setup(overrides = {}) {
  const created = [];
  const added = [];
  const session = createImportSession({
    resolve: async (link) => result(link),
    createPlaylist: async (input) => {
      const playlist = {
        id: String(created.length + 1),
        name: input.name,
        track_count: 0,
      };
      created.push(playlist);
      return playlist;
    },
    addTracks: async (id, tracks) => {
      added.push({ id, tracks });
      return { added: tracks.length };
    },
    ...overrides,
  });
  return { session, created, added };
}

test("editing an import link invalidates its result and late responses cannot replace the current source", async () => {
  const first = deferred();
  const second = deferred();
  const { session, created, added } = setup({
    resolve: (link) => (link === "first" ? first.promise : second.promise),
  });
  const oldRequest = session.resolve("first");
  session.invalidate();
  const currentRequest = session.resolve("second");
  second.resolve(result("Current playlist"));
  assert.equal((await currentRequest).result.name, "Current playlist");
  first.resolve(result("Obsolete playlist"));
  assert.deepEqual(await oldRequest, { status: "superseded" });
  await session.save();
  assert.equal(created[0].name, "Current playlist");
  assert.equal(added[0].tracks[0].title, "Current playlist");
  session.invalidate();
  await assert.rejects(session.save(), /Löse zuerst einen Spotify-Link auf/);
  assert.equal(created.length, 1);
});

test("an obsolete resolve failure does not end the current link's pending state", async () => {
  const first = deferred();
  const second = deferred();
  const { session } = setup({
    resolve: (link) => (link === "first" ? first.promise : second.promise),
  });
  const oldRequest = session.resolve("first");
  session.invalidate();
  const currentRequest = session.resolve("second");
  first.reject(new Error("Old request: HTTP 502"));
  assert.deepEqual(await oldRequest, { status: "superseded" });
  assert.equal(session.isResolving, true);
  second.resolve(result("Current"));
  assert.equal((await currentRequest).status, "resolved");
  assert.equal(session.isResolving, false);
});

test("resolve and save guard repeated submissions before any render or response", async () => {
  const lookup = deferred();
  let resolveCalls = 0;
  const creation = deferred();
  let creationCalls = 0;
  const { session, added } = setup({
    resolve: () => {
      resolveCalls += 1;
      return lookup.promise;
    },
    createPlaylist: () => {
      creationCalls += 1;
      return creation.promise;
    },
  });
  const lookupRequest = session.resolve("source");
  await assert.rejects(session.resolve("source"), /bereits aufgelöst/);
  assert.equal(resolveCalls, 1);
  lookup.resolve(result("Playlist"));
  await lookupRequest;
  const saveRequest = session.save();
  await assert.rejects(session.save(), /bereits gespeichert/);
  assert.throws(() => session.invalidate(), /während des Speicherns/);
  assert.equal(creationCalls, 1);
  creation.resolve({ id: "created", name: "Playlist", track_count: 0 });
  assert.equal((await saveRequest).playlist.id, "created");
  assert.equal(added.length, 1);
  assert.equal(session.isSaving, false);
});

test("a failed bulk add reports its cause and retries the already created playlist", async () => {
  let attempts = 0;
  const ids = [];
  const { session, created } = setup({
    addTracks: async (id) => {
      ids.push(id);
      if (attempts++ === 0) throw new Error("Titelspeicher: HTTP 503");
      return { added: 1 };
    },
  });
  await session.resolve("Spotify source");
  await assert.rejects(
    session.save(),
    /Titel konnten nicht.*Titelspeicher: HTTP 503/,
  );
  assert.equal(session.createdPlaylist.id, "1");
  assert.equal(session.isSaving, false);
  assert.equal((await session.save()).playlist.id, "1");
  assert.equal(created.length, 1);
  assert.deepEqual(ids, ["1", "1"]);
});

test("partial imports preserve separate playlist identities when a source is revisited", async () => {
  const ids = [];
  const { session, created } = setup({
    addTracks: async (id) => {
      ids.push(id);
      throw new Error("Add unavailable");
    },
  });
  await session.resolve("first source");
  await assert.rejects(session.save(), /Add unavailable/);
  session.invalidate();
  await session.resolve("second source");
  await assert.rejects(session.save(), /Add unavailable/);
  session.invalidate();
  await session.resolve("first source");
  assert.equal(session.createdPlaylist.id, "1");
  await assert.rejects(session.save(), /Add unavailable/);
  assert.equal(created.length, 2);
  assert.deepEqual(ids, ["1", "2", "1"]);
});

test("current resolve and playlist creation failures retain specific causes and leave no false success", async () => {
  const lookup = setup({
    resolve: async () => {
      throw new Error("Spotify: HTTP 429");
    },
  });
  await assert.rejects(
    lookup.session.resolve("source"),
    /Auflösen fehlgeschlagen: Spotify: HTTP 429/,
  );
  assert.equal(lookup.session.isResolving, false);
  await assert.rejects(lookup.session.save(), /Löse zuerst/);
  const creation = setup({
    createPlaylist: async () => {
      throw new Error("Playlist: HTTP 403");
    },
  });
  await creation.session.resolve("source");
  await assert.rejects(
    creation.session.save(),
    /Playlist konnte nicht erstellt werden: Playlist: HTTP 403/,
  );
  assert.equal(creation.session.createdPlaylist, undefined);
  assert.equal(creation.session.isSaving, false);
  assert.equal(creation.added.length, 0);
});

test("invalid results and empty imports fail before creating a playlist", async () => {
  const invalid = setup({
    resolve: async () => ({ ...result("Valid"), tracks: null }),
  });
  await assert.rejects(
    invalid.session.resolve("source"),
    /keine gültige Titelliste/,
  );
  assert.equal(invalid.created.length, 0);
  const empty = setup({
    resolve: async () => ({ ...result("Empty"), tracks: [] }),
  });
  await empty.session.resolve("source");
  await assert.rejects(empty.session.save(), /keine Deezer-Titel/);
  assert.equal(empty.created.length, 0);
});
