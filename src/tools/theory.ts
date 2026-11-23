import { NOTE_NAMES } from "../tuner/notes";

export const ROOTS = NOTE_NAMES; // C, C#, D… (sharps, as the tuner names notes)
const INTERVAL_NAMES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7", "1", "b9", "9"];
export const intervalName = (semitones: number) => INTERVAL_NAMES[semitones % 12 === semitones ? semitones : semitones % 12];

export interface ChordType {
  id: string;
  /** Suffix as written after the root: "", "m", "maj7"… */
  suffix: string;
  label: string;
  /** Semitones from the root. */
  intervals: number[];
}

export const CHORD_TYPES: ChordType[] = [
  { id: "maj", suffix: "", label: "Major", intervals: [0, 4, 7] },
  { id: "m", suffix: "m", label: "Minor", intervals: [0, 3, 7] },
  { id: "7", suffix: "7", label: "7", intervals: [0, 4, 7, 10] },
  { id: "maj7", suffix: "maj7", label: "maj7", intervals: [0, 4, 7, 11] },
  { id: "m7", suffix: "m7", label: "m7", intervals: [0, 3, 7, 10] },
  { id: "sus2", suffix: "sus2", label: "sus2", intervals: [0, 2, 7] },
  { id: "sus4", suffix: "sus4", label: "sus4", intervals: [0, 5, 7] },
  { id: "7sus4", suffix: "7sus4", label: "7sus4", intervals: [0, 5, 7, 10] },
  { id: "add9", suffix: "add9", label: "add9", intervals: [0, 4, 7, 14] },
  { id: "6", suffix: "6", label: "6", intervals: [0, 4, 7, 9] },
  { id: "m6", suffix: "m6", label: "m6", intervals: [0, 3, 7, 9] },
  { id: "9", suffix: "9", label: "9", intervals: [0, 4, 7, 10, 14] },
  { id: "m9", suffix: "m9", label: "m9", intervals: [0, 3, 7, 10, 14] },
  { id: "dim", suffix: "dim", label: "dim", intervals: [0, 3, 6] },
  { id: "dim7", suffix: "dim7", label: "dim7", intervals: [0, 3, 6, 9] },
  { id: "m7b5", suffix: "m7b5", label: "m7b5", intervals: [0, 3, 6, 10] },
  { id: "aug", suffix: "aug", label: "aug", intervals: [0, 4, 8] },
  { id: "5", suffix: "5", label: "5 (power)", intervals: [0, 7] },
];

/** Other ways tab sites write the same suffixes. */
const ALIASES: Record<string, string> = {
  min: "m", "-": "m", M7: "maj7", Maj7: "maj7", "Δ": "maj7", "Δ7": "maj7", min7: "m7", "-7": "m7",
  sus: "sus4", "°": "dim", o: "dim", "°7": "dim7", o7: "dim7", "ø": "m7b5", "ø7": "m7b5", "m7-5": "m7b5",
  "+": "aug", add2: "add9", "2": "sus2", "4": "sus4", "7sus": "7sus4", maj: "",
};

const FLAT_TO_SHARP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
const pcOf = (note: string) => ROOTS.indexOf(FLAT_TO_SHARP[note] ?? note);

export interface Chord {
  root: number; // pitch class 0–11
  type: ChordType;
  /** Slash chord bass, e.g. D in "G/D". */
  bass?: number;
}

/** "F#m7", "Bb/D", "Cadd9", "Asus" → a chord, or null when the name is not in the dictionary. */
export function parseChord(name: string): Chord | null {
  const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(name.trim());
  if (!m) return null;
  const suffix = ALIASES[m[2]] ?? m[2];
  const type = CHORD_TYPES.find((t) => t.suffix === suffix);
  const root = pcOf(m[1]);
  if (!type || root < 0) return null;
  return { root, type, bass: m[3] ? pcOf(m[3]) : undefined };
}

export const chordName = (c: Chord) => `${ROOTS[c.root]}${c.type.suffix}${c.bass !== undefined ? `/${ROOTS[c.bass]}` : ""}`;
export const chordNotes = (c: Chord) => c.type.intervals.map((i) => ROOTS[(c.root + i) % 12]);

/** A way to play a chord: one fret per string, low to high, -1 = muted. */
export type Voicing = number[];

const SPAN = 3; // frets the hand covers above the lowest fretted note
const MAX_FRET = 12;

/**
 * Finds playable shapes for a chord in any tuning (MIDI notes, lowest string first), best first.
 * Rules: every chord tone present (the 5th may go on 4+ note chords), the chord's bass note lowest
 * (skipped for re-entrant tunings like the ukulele), muted strings only on the low side, at most 4 fingers
 * (a barre counts as one). Low positions, open strings, compact hands and fuller chords rank first.
 */
export function findVoicings(tuning: number[], chord: Chord, limit = 6): Voicing[] {
  const pcs = new Set(chord.type.intervals.map((i) => (chord.root + i) % 12));
  const fifth = (chord.root + 7) % 12;
  const bass = chord.bass ?? chord.root;
  if (chord.bass !== undefined) pcs.add(chord.bass);
  const reentrant = tuning.some((n, i) => i > 0 && n < tuning[i - 1]);
  const minStrings = tuning.length > 4 ? 4 : tuning.length; // ukulele chords use every string
  const found = new Map<string, { v: Voicing; score: number }>();

  for (let base = 1; base <= MAX_FRET; base++) {
    const options = tuning.map((open) => {
      const o = [-1];
      if (base <= 3 && pcs.has(open % 12)) o.push(0);
      for (let f = base; f <= base + SPAN; f++) if (pcs.has((open + f) % 12)) o.push(f);
      return o;
    });
    const walk = (i: number, v: number[]) => {
      if (i === tuning.length) return consider(v);
      for (const f of options[i]) {
        if (f >= 0 || v.every((x) => x < 0)) walk(i + 1, [...v, f]); // no muted string above a played one
      }
    };
    walk(0, []);
  }

  function consider(v: Voicing) {
    const played = v.map((f, i) => (f < 0 ? null : tuning[i] + f)).filter((n): n is number => n !== null);
    if (played.length < minStrings) return;
    const present = new Set(played.map((n) => n % 12));
    const missing = [...pcs].filter((p) => !present.has(p));
    // Only the 5th may be left out: on 4+ note chords (as players do with 7ths) or when strings run short.
    const canDropFifth = pcs.size >= 4 || played.length <= pcs.size;
    if (missing.length > 1 || (missing.length === 1 && !(missing[0] === fifth && canDropFifth))) return;
    if (!reentrant && Math.min(...played) % 12 !== bass) return;
    const fretted = v.filter((f) => f > 0);
    const low = fretted.length ? Math.min(...fretted) : 0;
    const atLow = v.flatMap((f, i) => (f === low ? [i] : []));
    // One finger can barre the lowest fret, unless an open string sits under the barre.
    const barre = atLow.length > 1 && !v.slice(atLow[0], atLow.at(-1)! + 1).includes(0);
    const fingers = fretted.length - (barre ? atLow.length - 1 : 0);
    if (fingers > 4) return;
    const muted = v.filter((f) => f < 0).length;
    const open = v.filter((f) => f === 0).length;
    const stretch = fretted.length ? Math.max(...fretted) - low : 0; // wide hand = hard shape
    const score = low * 2 + muted * 1.5 - open * 0.5 + fingers * 0.3 + stretch * 0.8 + missing.length * 2;
    const key = v.join(",");
    if (!found.has(key) || found.get(key)!.score > score) found.set(key, { v, score });
  }

  return [...found.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.v);
}

export interface Scale {
  id: string;
  label: string;
  intervals: number[];
}

export const SCALES: Scale[] = [
  { id: "major", label: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "penta-major", label: "Major pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "penta-minor", label: "Minor pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "harmonic-minor", label: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor", label: "Melodic minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
];

/** Semitones above the scale root for a pitch class, or -1 when the note is not in the scale. */
export const degreeOf = (pc: number, root: number, scale: Scale) => {
  const d = (pc - root + 12) % 12;
  return scale.intervals.includes(d) ? d : -1;
};

export const TEMPO_MIN = 30;
export const TEMPO_MAX = 240;

/** Average of the last taps, in BPM, or null until two taps less than 2 s apart. */
export function tapTempo(times: number[]) {
  const recent = times.slice(-5);
  const gaps = recent.slice(1).map((t, i) => t - recent[i]).filter((g) => g < 2000);
  if (!gaps.length) return null;
  const bpm = 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
  return Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm)));
}
