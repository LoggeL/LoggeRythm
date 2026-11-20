import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The pure helpers of the import-job hooks; React and API imports are dropped
// because only the hook functions (never called here) use them.
const source = await readFile(new URL("../src/hooks/useImportJobs.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: "useImportJobs.ts",
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  transformers: {
    before: [
      () => (file) =>
        ts.factory.updateSourceFile(file, file.statements.filter((statement) => !ts.isImportDeclaration(statement))),
    ],
  },
}).outputText;
const { importJobSummary, importJobTitle, isActiveImport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function job(overrides) {
  return {
    id: "j1",
    url: "https://open.spotify.com/playlist/abc",
    status: "running",
    type: "playlist",
    name: "",
    image: "",
    total: 0,
    source_total: 0,
    processed: 0,
    matched: 0,
    failed_lookups: 0,
    lookup_error: null,
    error: null,
    created_at: "2026-11-20T10:00:00+00:00",
    updated_at: "2026-11-20T10:00:00+00:00",
    finished_at: null,
    ...overrides,
  };
}

test("queued and running imports are active, finished ones are not", () => {
  assert.equal(isActiveImport(job({ status: "queued" })), true);
  assert.equal(isActiveImport(job({ status: "running" })), true);
  assert.equal(isActiveImport(job({ status: "done" })), false);
  assert.equal(isActiveImport(job({ status: "failed" })), false);
});

test("the summary names each phase of an import", () => {
  assert.equal(importJobSummary(job({ status: "queued" })), "Wartet auf Start…");
  assert.equal(importJobSummary(job({ total: 0 })), "Liest die Titel von Spotify…");
  assert.equal(importJobSummary(job({ total: 1200, processed: 300, matched: 280 })), "300/1200 abgeglichen · 280 gefunden");
  assert.equal(importJobSummary(job({ status: "done", total: 1200, matched: 1100 })), "Fertig · 1100/1200 Titel gefunden");
  assert.equal(importJobSummary(job({ status: "failed", error: "Spotify-Ressource nicht gefunden." })), "Fehlgeschlagen: Spotify-Ressource nicht gefunden.");
});

test("an import is titled by its source name once Spotify answered, by its link before", () => {
  assert.equal(importJobTitle(job({})), "https://open.spotify.com/playlist/abc");
  assert.equal(importJobTitle(job({ name: "Road Trip" })), "Road Trip");
});
