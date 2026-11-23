import { PitchDetector } from "pitchy";
import { CHORD_TYPES, type Chord } from "../tools/theory";
import { freqToMidi } from "../tuner/notes";
import type { ChordSpan, Note } from "./analysis";

const WINDOW = 2048; // ~93 ms at 22 kHz: two periods of a low male voice (~80 Hz)
const HOP = 256; // ~12 ms between readings
const MIN_CLARITY = 0.85;
const MIN_RMS = 0.01;
const MIN_NOTE_S = 0.09;

interface Track {
  hop: number;
  midi: (number | null)[];
  /** Loudness around each reading (short window), to split a note sung twice in a row. */
  rms: number[];
}

/** Pitch every ~12 ms (fractional MIDI), or null where nothing clearly pitched is heard. */
export function pitchTrack(samples: Float32Array, rate: number): Track {
  const detector = PitchDetector.forFloat32Array(WINDOW);
  detector.minVolumeAbsolute = MIN_RMS;
  const midi: (number | null)[] = [];
  const rms: number[] = [];
  for (let i = 0; i + WINDOW <= samples.length; i += HOP) {
    const [freq, clarity] = detector.findPitch(samples.subarray(i, i + WINDOW), rate);
    midi.push(clarity >= MIN_CLARITY && freq > 65 && freq < 1400 ? freqToMidi(freq) : null);
    const mid = samples.subarray(i + WINDOW / 2 - HOP, i + WINDOW / 2 + HOP);
    rms.push(Math.sqrt(mid.reduce((a, x) => a + x * x, 0) / mid.length));
  }
  return { hop: HOP / rate, midi, rms };
}

/** Readings where the voice dips and comes back (a new syllable on the same pitch). */
function dips(rms: number[]): Set<number> {
  const out = new Set<number>();
  const max = (a: number, b: number) => Math.max(0, ...rms.slice(Math.max(0, a), b));
  for (let i = 1; i < rms.length - 1; i++) {
    const local = rms.slice(Math.max(0, i - 4), i + 5);
    if (rms[i] > Math.min(...local)) continue;
    if (rms[i] < 0.5 * Math.min(max(i - 16, i), max(i + 1, i + 17))) out.add(i);
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/**
 * Cuts a pitch curve into notes: a note lasts while the pitch stays within ~half a semitone of where it
 * settled, so vibrato and scoops stay inside one note, and its pitch is the median (vibrato averages out).
 */
export function segmentMelody(track: Track): Note[] {
  const syllables = dips(track.rms);
  const notes: Note[] = [];
  let run: number[] = [];
  let runStart = 0;
  let unvoiced = 0;

  const close = (endFrame: number) => {
    const duration = (endFrame - runStart) * track.hop;
    if (run.length && duration >= MIN_NOTE_S) {
      notes.push({ start: runStart * track.hop, duration, midi: Math.round(median(run)), amplitude: 1 });
    }
    run = [];
  };

  track.midi.forEach((m, i) => {
    if (m === null) {
      if (++unvoiced === 3 && run.length) close(i - 2); // a short breath ends the note
      return;
    }
    unvoiced = 0;
    if (!run.length) {
      runStart = i;
      run.push(m);
      return;
    }
    if (syllables.has(i)) {
      close(i);
      runStart = i;
      run.push(m);
      return;
    }
    const center = median(run.slice(-15));
    // A new note once the pitch has clearly moved and stays there (3 readings), not on a single wobble.
    const ahead = track.midi.slice(i, i + 3);
    if (Math.abs(m - center) > 0.6 && ahead.every((x) => x !== null && Math.abs(x - center) > 0.6)) {
      close(i);
      runStart = i;
    }
    run.push(m);
  });
  close(track.midi.length);

  // The same pitch again right after a tiny gap is one held note the tracker dropped for an instant, unless
  // the voice dipped in between (sung again).
  const merged: Note[] = [];
  const frame = (t: number) => Math.round(t / track.hop);
  for (const n of notes) {
    const last = merged.at(-1);
    const gap = last ? n.start - (last.start + last.duration) : Infinity;
    const resung = last && [...syllables].some((d) => d >= frame(last.start + last.duration) - 3 && d <= frame(n.start) + 3);
    if (last && last.midi === n.midi && gap < 0.06 && !resung) last.duration = n.start + n.duration - last.start;
    else merged.push({ ...n });
  }
  return merged;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const type = (id: string) => CHORD_TYPES.find((t) => t.id === id)!;

/** The key's own chords, most used first: I IV V vi (major) or i iv v/V VI III VII (minor). */
function diatonic(root: number, minor: boolean): { chord: Chord; prior: number }[] {
  const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
  const qualities = minor ? ["m", "dim", "maj", "m", "m", "maj", "maj"] : ["maj", "m", "m", "maj", "maj", "m", "dim"];
  const common = minor ? [0, 3, 4, 5, 2, 6] : [0, 3, 4, 5, 1, 2]; // degrees, by how often songs use them
  const chords = steps.map((s, d) => ({ chord: { root: (root + s) % 12, type: type(qualities[d]) }, prior: 0 }));
  if (minor) chords[4] = { chord: { root: (root + 7) % 12, type: type("maj") }, prior: 0 }; // harmonic-minor V
  common.forEach((d, i) => (chords[d].prior = 1 - i * 0.12));
  return chords.filter((c) => c.prior > 0);
}

/**
 * Chords to play under a sung melody: for each stretch (~2 s), the key's chord whose notes cover the
 * melody best, weighted by how long each note lasts; common chords (I, IV, V, vi) win ties.
 */
export function harmonize(notes: Note[], key: { root: number; minor: boolean }, block = 2): ChordSpan[] {
  if (!notes.length) return [];
  const options = diatonic(key.root, key.minor);
  const end = Math.max(...notes.map((n) => n.start + n.duration));
  const spans: ChordSpan[] = [];
  for (let t = notes[0].start; t < end; t += block) {
    const weights = new Array(12).fill(0);
    for (const n of notes) {
      const overlap = Math.min(n.start + n.duration, t + block) - Math.max(n.start, t);
      if (overlap > 0) weights[n.midi % 12] += overlap;
    }
    const total = weights.reduce((a, b) => a + b, 0);
    if (!total) continue;
    let best = options[0];
    let bestScore = -Infinity;
    for (const o of options) {
      const tones = o.chord.type.intervals.map((i) => (o.chord.root + i) % 12);
      const score = tones.reduce((a, pc) => a + weights[pc], 0) / total + 0.15 * o.prior;
      if (score > bestScore) [best, bestScore] = [o, score];
    }
    const last = spans.at(-1);
    if (last?.chord && last.chord.root === best.chord.root && last.chord.type.id === best.chord.type.id) last.end = t + block;
    else spans.push({ start: t, end: Math.min(t + block, end), chord: best.chord });
  }
  return spans;
}
