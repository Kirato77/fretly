import type { SsTrack } from "./songsterr";

export type Source = "ug" | "songsterr";

export interface SearchHit {
  source: Source;
  artist: string;
  title: string;
  /** Tab type or track, e.g. "Chords", "Rhythm Guitar". */
  label: string;
  /** UG only: average rating out of 5 and number of votes. */
  rating?: number;
  votes?: number;
  /** UG only: vote-weighted rating used to rank versions. */
  score?: number;
  /** UG: tab page URL. Songsterr: "songId/trackIndex". */
  ref: string;
}

/** Plain data (no functions), so a tab can be saved as a favorite and opened offline. */
export interface TabDoc {
  title: string;
  artist: string;
  source: Source;
  kind: string;
  /** Capo, tuning, key… */
  info: string[];
  /** Chord sheets can be transposed; note-by-note tabs cannot. */
  transposable: boolean;
  /** UG: text lines with chords marked as [ch]X[/ch]. */
  lines?: string[];
  /** Songsterr: the track, laid out as ASCII tab for the screen width when shown (trackToLines). */
  track?: SsTrack;
}

export const SOURCE_NAMES: Record<Source, string> = { ug: "Ultimate Guitar", songsterr: "Songsterr" };
