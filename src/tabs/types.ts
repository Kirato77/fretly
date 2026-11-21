export type Source = "ug" | "songsterr";

export interface SearchHit {
  source: Source;
  artist: string;
  title: string;
  /** e.g. "Chords · ★4.8 (412)" */
  label: string;
  /** UG only: vote-weighted rating used to rank versions. */
  score?: number;
  /** UG: tab page URL. Songsterr: "songId/trackIndex". */
  ref: string;
}

export interface TabDoc {
  title: string;
  artist: string;
  source: Source;
  kind: string;
  /** Capo, tuning, key… */
  info: string[];
  /** Chord sheets can be transposed; note-by-note tabs cannot. */
  transposable: boolean;
  /** Text lines with chords marked as [ch]X[/ch], wrapped to `cols` characters where possible. */
  render(cols: number): string[];
}

export const SOURCE_NAMES: Record<Source, string> = { ug: "Ultimate Guitar", songsterr: "Songsterr" };
