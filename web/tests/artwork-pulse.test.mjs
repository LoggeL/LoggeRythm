import assert from "node:assert/strict";
import test from "node:test";
import { artworkPulseTarget, approachArtworkPulse, artworkPulseStyle } from "../src/lib/artworkPulse.ts";

test("artwork follows real bass, ignores treble-only transients and caps expansion at seven percent", () => {
  assert.equal(artworkPulseTarget(0, 1), 0);
  assert.equal(artworkPulseTarget(0, 0), 0);
  assert.ok(artworkPulseTarget(0.8, 0.2) > artworkPulseTarget(0.2, 0.2));
  assert.equal(artworkPulseTarget(1, 1), 1);
  assert.equal(artworkPulseStyle(0).transform, "translateZ(0) scale(1.00000)");
  assert.equal(artworkPulseStyle(1).transform, "translateZ(0) scale(1.07000)");
  assert.match(artworkPulseStyle(0.7).boxShadow, /var\(--cover-primary-rgb/);
});

test("pulse has a fast attack, smooth release and the same envelope at different frame rates", () => {
  assert.ok(approachArtworkPulse(0, 1, 1 / 30) > 0.7);
  assert.ok(approachArtworkPulse(1, 0, 1 / 30) > 0.7);
  let at30 = 0, at60 = 0;
  for (let i = 0; i < 6; i++) at30 = approachArtworkPulse(at30, 0.8, 1 / 30);
  for (let i = 0; i < 12; i++) at60 = approachArtworkPulse(at60, 0.8, 1 / 60);
  assert.ok(Math.abs(at30 - at60) < 0.00001);
  for (let i = 0; i < 60; i++) at30 = approachArtworkPulse(at30, 0, 1 / 30);
  assert.ok(at30 < 0.00001);
});

test("invalid audio input names the bad value and fails visibly", () => {
  assert.throws(() => artworkPulseTarget(NaN, 0), /bass/);
  assert.throws(() => artworkPulseTarget(0.5, 1.5), /onset/);
  assert.throws(() => approachArtworkPulse(0, 1, -1), /duration/);
  assert.throws(() => artworkPulseStyle(-0.1), /display level/);
});
