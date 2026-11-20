import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Compile the saver used by the real component. Removing its UI imports and
// components (capitalized functions) keeps these async tests independent of
// browser rendering.
const source = await readFile(
  new URL("../src/components/ImportPanel.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "ImportPanel.tsx",
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
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
                /^[A-Z]/.test(statement.name?.text ?? "")
              ),
          ),
        ),
    ],
  },
}).outputText;
const { createImportSaver } = await import(
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
  const saver = createImportSaver({
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
  return { saver, created, added };
}

test("a finished import is saved as a playlist named after its source", async () => {
  const { saver, created, added } = setup();
  const saved = await saver.save("job-1", result("Road Trip"));
  assert.deepEqual(saved, { playlist: created[0], added: 1 });
  assert.equal(created[0].name, "Road Trip");
  assert.equal(added[0].tracks[0].title, "Road Trip");
  assert.equal(saver.createdPlaylist("job-1").id, "1");
});

test("save guards repeated submissions before any render or response", async () => {
  const creation = deferred();
  let creationCalls = 0;
  const { saver, added } = setup({
    createPlaylist: () => {
      creationCalls += 1;
      return creation.promise;
    },
  });
  const saveRequest = saver.save("job-1", result("Playlist"));
  assert.equal(saver.isSaving, true);
  await assert.rejects(saver.save("job-1", result("Playlist")), /bereits gespeichert/);
  assert.equal(creationCalls, 1);
  creation.resolve({ id: "created", name: "Playlist", track_count: 0 });
  assert.equal((await saveRequest).playlist.id, "created");
  assert.equal(added.length, 1);
  assert.equal(saver.isSaving, false);
});

test("a failed bulk add reports its cause and retries the already created playlist", async () => {
  let attempts = 0;
  const ids = [];
  const { saver, created } = setup({
    addTracks: async (id) => {
      ids.push(id);
      if (attempts++ === 0) throw new Error("Titelspeicher: HTTP 503");
      return { added: 1 };
    },
  });
  await assert.rejects(
    saver.save("job-1", result("Spotify source")),
    /Titel konnten nicht.*Titelspeicher: HTTP 503/,
  );
  assert.equal(saver.createdPlaylist("job-1").id, "1");
  assert.equal(saver.isSaving, false);
  assert.equal((await saver.save("job-1", result("Spotify source"))).playlist.id, "1");
  assert.equal(created.length, 1);
  assert.deepEqual(ids, ["1", "1"]);
});

test("separate imports keep separate playlists when one is revisited", async () => {
  const ids = [];
  const { saver, created } = setup({
    addTracks: async (id) => {
      ids.push(id);
      throw new Error("Add unavailable");
    },
  });
  await assert.rejects(saver.save("first", result("first source")), /Add unavailable/);
  await assert.rejects(saver.save("second", result("second source")), /Add unavailable/);
  assert.equal(saver.createdPlaylist("first").id, "1");
  await assert.rejects(saver.save("first", result("first source")), /Add unavailable/);
  assert.equal(created.length, 2);
  assert.deepEqual(ids, ["1", "2", "1"]);
});

test("playlist creation failures retain their cause and leave no false success", async () => {
  const creation = setup({
    createPlaylist: async () => {
      throw new Error("Playlist: HTTP 403");
    },
  });
  await assert.rejects(
    creation.saver.save("job-1", result("source")),
    /Playlist konnte nicht erstellt werden: Playlist: HTTP 403/,
  );
  assert.equal(creation.saver.createdPlaylist("job-1"), undefined);
  assert.equal(creation.saver.isSaving, false);
  assert.equal(creation.added.length, 0);
});

test("invalid results and empty imports fail before creating a playlist", async () => {
  const { saver, created } = setup();
  await assert.rejects(
    saver.save("job-1", { ...result("Valid"), tracks: null }),
    /keine gültige Titelliste/,
  );
  await assert.rejects(
    saver.save("job-2", { ...result("Valid"), name: "  " }),
    /keinen gültigen Namen/,
  );
  await assert.rejects(saver.save("job-3", { ...result("Empty"), tracks: [] }), /keine Deezer-Titel/);
  assert.equal(created.length, 0);
  assert.equal(saver.isSaving, false);
});
