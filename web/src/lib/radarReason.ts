import type { RadarReason } from "@/types";

/** The rule that puts a track into the Release Radar, as one sentence. */
export const RADAR_RULE =
  "Neue Releases von Künstler:innen, denen du folgst oder die du in den letzten 90 Tagen mindestens zweimal gehört hast.";

/**
 * Why one track is in the Release Radar, as short German text. Split so the
 * watched artist's name can be rendered as a link to that artist.
 */
export interface RadarReasonLabel {
  /** Everything before the artist name; the whole label when the name is unknown. */
  lead: string;
  /** The watched source artist's name, or null when the server has none. */
  artistName: string | null;
  /** The complete label: `lead` followed by `artistName`. */
  text: string;
}

function label(lead: string, artistName: string): RadarReasonLabel {
  return { lead, artistName, text: `${lead}${artistName}` };
}

function namelessLabel(text: string): RadarReasonLabel {
  return { lead: text, artistName: null, text };
}

/**
 * Formats a track's radar reason. The named artist is the watched source
 * artist, who may differ from the track's primary artist. A name the server
 * does not know ("") is left out, never invented.
 */
export function radarReasonLabel(reason: RadarReason): RadarReasonLabel {
  const name = reason.artist_name.trim();
  const { kind } = reason;

  if (kind === "followed") {
    return name ? label("Du folgst ", name) : namelessLabel("Von dir gefolgt");
  }
  if (kind === "played") {
    if (reason.play_count < 1) {
      throw new Error(
        `Widersprüchlicher Release-Radar-Grund für Künstler-ID ${reason.artist_id}: "played" mit ${reason.play_count} Wiedergaben.`,
      );
    }
    const plays = `${reason.play_count.toLocaleString("de-DE")}× gehört`;
    return name ? label(`${plays}: `, name) : namelessLabel(plays);
  }
  throw new Error(
    `Unbekannter Release-Radar-Grund "${String(kind satisfies never)}" für Künstler-ID ${reason.artist_id}.`,
  );
}
