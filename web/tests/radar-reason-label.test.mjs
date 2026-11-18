import assert from "node:assert/strict";
import test from "node:test";
import { RADAR_RULE, radarReasonLabel } from "../src/lib/radarReason.ts";

const reason = (change) => ({
  kind: "played",
  artist_id: "7",
  artist_name: "Mira Solaris",
  play_count: 4,
  ...change,
});

test("a followed artist is named as the reason, however often they were played", () => {
  for (const playCount of [0, 1, 12]) {
    assert.deepEqual(radarReasonLabel(reason({ kind: "followed", play_count: playCount })), {
      lead: "Du folgst ",
      artistName: "Mira Solaris",
      text: "Du folgst Mira Solaris",
    });
  }
});

test("a played artist is named together with the number of plays", () => {
  assert.deepEqual(radarReasonLabel(reason({ play_count: 2 })), {
    lead: "2× gehört: ",
    artistName: "Mira Solaris",
    text: "2× gehört: Mira Solaris",
  });
  assert.equal(radarReasonLabel(reason({ play_count: 1 })).text, "1× gehört: Mira Solaris");
  // Large counts use German digit grouping.
  assert.equal(radarReasonLabel(reason({ play_count: 1234 })).text, "1.234× gehört: Mira Solaris");
});

test("an unknown artist name is left out instead of being invented", () => {
  for (const artistName of ["", "   "]) {
    assert.deepEqual(radarReasonLabel(reason({ kind: "followed", artist_name: artistName, play_count: 0 })), {
      lead: "Von dir gefolgt",
      artistName: null,
      text: "Von dir gefolgt",
    });
    assert.deepEqual(radarReasonLabel(reason({ artist_name: artistName })), {
      lead: "4× gehört",
      artistName: null,
      text: "4× gehört",
    });
  }
});

test("the label names the watched source artist exactly as the server reports it", () => {
  const label = radarReasonLabel(reason({ artist_name: " Die Leisen Riesen & Co. " }));
  assert.equal(label.artistName, "Die Leisen Riesen & Co.");
  assert.equal(label.text, `${label.lead}${label.artistName}`);
});

test("contradictory or unknown reasons fail loudly instead of rendering nonsense", () => {
  assert.throws(
    () => radarReasonLabel(reason({ play_count: 0 })),
    /Widersprüchlicher Release-Radar-Grund für Künstler-ID 7: "played" mit 0 Wiedergaben\./,
  );
  assert.throws(
    () => radarReasonLabel(reason({ kind: "liked" })),
    /Unbekannter Release-Radar-Grund "liked" für Künstler-ID 7\./,
  );
});

test("the rule sentence names both ways into the radar and its window", () => {
  assert.match(RADAR_RULE, /denen du folgst/);
  assert.match(RADAR_RULE, /in den letzten 90 Tagen mindestens zweimal gehört/);
  assert.equal(RADAR_RULE.split(". ").length, 1);
});
