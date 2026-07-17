import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { decodeListeningStats } from "../src/lib/listeningStats.ts";

const contractUrl = new URL(
  "../../contracts/listening-stats.v2.json",
  import.meta.url,
);
const contract = JSON.parse(await readFile(contractUrl, "utf8"));

test("web decoder passes every shared listening-stats v2 valid fixture", () => {
  assert.equal(contract.$id, "loggerythm.listening-stats.v2");
  assert.equal(contract.version, 2);
  assert.ok(contract.valid.length >= 2);

  for (const fixture of contract.valid) {
    assert.deepEqual(
      decodeListeningStats(fixture.wire),
      fixture.domain,
      fixture.id,
    );
  }
});

test("web decoder rejects every shared listening-stats v2 invalid fixture", () => {
  assert.ok(contract.invalid.length >= 3);

  for (const fixture of contract.invalid) {
    assert.throws(
      () => decodeListeningStats(fixture.wire),
      (error) =>
        error instanceof Error && error.message.includes(fixture.error),
      fixture.id,
    );
  }
});

test("web decoder enforces the shared recent-artist collection bound", () => {
  const populated = contract.valid.find(
    (fixture) => fixture.id === "legacy-ids-and-missing-optional-media",
  );
  assert.ok(populated);
  const wire = structuredClone(populated.wire);
  wire.recent[0].artists = Array.from(
    { length: contract.limits.recent_artists + 1 },
    (_, index) => ({ id: index, name: `Artist ${index}` }),
  );

  assert.throws(
    () => decodeListeningStats(wire),
    /recent\[0\]\.artists/,
  );
});
