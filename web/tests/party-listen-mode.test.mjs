import assert from "node:assert/strict";
import test from "node:test";
import { partyPlayerAction } from "../src/app/party/listenMode.ts";
import { usePartyStore } from "../src/store/party.ts";

const frame = (code, isHost = false) => ({
  code,
  name: "Friday",
  isHost,
  currentIndex: 0,
  members: [],
  isPlaying: true,
  positionSec: 0,
  playbackUpdatedAt: null,
});

test("a member listening here mirrors the party; at the host it releases the player once", () => {
  assert.equal(partyPlayerAction(false, "device", false), "mirror");
  assert.equal(partyPlayerAction(false, "host", true), "release");
  assert.equal(partyPlayerAction(false, "host", false), "none");
  assert.equal(partyPlayerAction(true, "device", true), "mirror");
});

test("the host cannot be sent to listen elsewhere", () => {
  assert.throws(() => partyPlayerAction(true, "host", true), /host plays the party/);

  usePartyStore.getState().clearParty();
  usePartyStore.getState().setParty(frame("HOST01", true));
  assert.throws(() => usePartyStore.getState().setListenMode("host"), /host plays the party/);
  assert.equal(usePartyStore.getState().listenMode, "device");
});

test("the listen mode survives live frames of the same party and resets for a new one", () => {
  const store = usePartyStore.getState();
  store.clearParty();
  assert.throws(() => store.setListenMode("host"), /No party is open/);

  store.setParty(frame("ABC123"));
  usePartyStore.getState().setListenMode("host");
  usePartyStore.getState().setParty({ ...frame("ABC123"), currentIndex: 1 });
  assert.equal(usePartyStore.getState().listenMode, "host");

  usePartyStore.getState().setParty(frame("ZZZ999"));
  assert.equal(usePartyStore.getState().listenMode, "device");

  usePartyStore.getState().setListenMode("host");
  usePartyStore.getState().clearParty();
  assert.equal(usePartyStore.getState().listenMode, "device");
});
