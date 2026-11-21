import { parseNote, pitchClass } from "./notes";

export type Instrument = "guitar" | "bass" | "ukulele";

export interface Tuning {
  id: string;
  name: string;
  instrument: Instrument;
  /** MIDI numbers, in headstock order: lowest-pitched (thickest) string first. Ukulele is re-entrant. */
  notes: number[];
  custom?: boolean;
}

const preset = (instrument: Instrument, id: string, name: string, notes: string): Tuning => ({
  id: `${instrument}-${id}`,
  name,
  instrument,
  notes: notes.split(" ").map(parseNote),
});

export const PRESETS: Tuning[] = [
  preset("guitar", "standard", "Standard", "E2 A2 D3 G3 B3 E4"),
  preset("guitar", "drop-d", "Drop D", "D2 A2 D3 G3 B3 E4"),
  preset("guitar", "dadgad", "DADGAD", "D2 A2 D3 G3 A3 D4"),
  preset("guitar", "open-g", "Open G", "D2 G2 D3 G3 B3 D4"),
  preset("guitar", "open-d", "Open D", "D2 A2 D3 F#3 A3 D4"),
  preset("guitar", "open-e", "Open E", "E2 B2 E3 G#3 B3 E4"),
  preset("guitar", "half-down", "Half step down", "Eb2 Ab2 Db3 Gb3 Bb3 Eb4"),
  preset("guitar", "d-standard", "D Standard", "D2 G2 C3 F3 A3 D4"),
  preset("guitar", "drop-c", "Drop C", "C2 G2 C3 F3 A3 D4"),
  preset("guitar", "guitalele", "Guitalele", "A2 D3 G3 C4 E4 A4"),
  preset("bass", "standard", "Standard", "E1 A1 D2 G2"),
  preset("bass", "drop-d", "Drop D", "D1 A1 D2 G2"),
  preset("bass", "five", "5-string", "B0 E1 A1 D2 G2"),
  preset("ukulele", "standard", "Standard (high G)", "G4 C4 E4 A4"),
  preset("ukulele", "low-g", "Low G", "G3 C4 E4 A4"),
  preset("ukulele", "baritone", "Baritone", "D3 G3 B3 E4"),
];

export const DEFAULT_TUNING = PRESETS[0];

export const INSTRUMENTS: { id: Instrument; label: string }[] = [
  { id: "guitar", label: "Guitar" },
  { id: "bass", label: "Bass" },
  { id: "ukulele", label: "Ukulele" },
];

const FLAT_TO_SHARP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

/** "Eb Ab Db Gb Bb Eb" or "e a d g b e" → "D# G# C# F# A# D#": low to high, sharps, as the tuner names notes. */
export const normalizeTuning = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((t) => {
      const note = t[0].toUpperCase() + t.slice(1);
      return FLAT_TO_SHARP[note] ?? note;
    })
    .join(" ");

export const tuningKey = (t: Tuning) => t.notes.map(pitchClass).join(" ");

/** The tuner tuning whose notes match a tab's tuning (pitch classes, low to high), if any. */
export const findTuning = (key: string, tunings: Tuning[]) => tunings.find((t) => tuningKey(t) === key);
