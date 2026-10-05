import assert from "node:assert/strict";
import test from "node:test";
import {
  createPartySearchRequests,
  leavePartyAndNavigate,
  partyFailureMessage,
} from "../src/app/party/requests.ts";

test("a failed party leave preserves the route and reports the server failure", async () => {
  const failure = new Error("Host cannot leave while guests remain");
  let navigated = false;

  await assert.rejects(
    leavePartyAndNavigate(
      async () => { throw failure; },
      () => { navigated = true; },
    ),
    (error) => error === failure,
  );
  assert.equal(navigated, false);
});

test("party navigation waits for confirmed membership removal", async () => {
  let confirmLeave;
  const confirmation = new Promise((resolve) => { confirmLeave = resolve; });
  const events = [];
  const leaving = leavePartyAndNavigate(
    async () => {
      await confirmation;
      events.push("left");
    },
    () => { events.push("navigated"); },
  );

  assert.deepEqual(events, []);
  confirmLeave();
  await leaving;
  assert.deepEqual(events, ["left", "navigated"]);
});

test("a superseded search cannot commit results or clear the new request's loading state", () => {
  const searches = createPartySearchRequests();
  const first = searches.start();
  const second = searches.start();

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.signal.aborted, false);
  assert.equal(second.isCurrent(), true);
});

test("editing the term or leaving the route invalidates pending search responses", () => {
  const searches = createPartySearchRequests();
  const request = searches.start();

  searches.cancel();
  assert.equal(request.signal.aborted, true);
  assert.equal(request.isCurrent(), false);

  const retry = searches.start();
  assert.equal(retry.signal.aborted, false);
  assert.equal(retry.isCurrent(), true);
});

test("party failure messages retain the attempted action and upstream cause", () => {
  assert.equal(
    partyFailureMessage('"Song" konnte nicht entfernt werden', new Error("API /party: HTTP 403")),
    '"Song" konnte nicht entfernt werden: API /party: HTTP 403',
  );
  assert.equal(partyFailureMessage("Suche fehlgeschlagen", "Verbindung getrennt"), "Suche fehlgeschlagen: Verbindung getrennt");
});
