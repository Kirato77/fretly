import type { LayersModel } from "@tensorflow/tfjs";
import { CHORD_TYPES, type Chord } from "../tools/theory";
import type { ChordSpan, Note } from "./analysis";

// The voice is followed by CREPE (a neural pitch tracker, MIT, "tiny" size: 2 MB), far steadier than a
// classic detector on humming, breath, room echo and a phone mic. It reads 1024 samples at 16 kHz every 10 ms.
export const VOICE_RATE = 16000;
const FRAME = 1024;
const STEP = 160; // 10 ms
const MIN_CONFIDENCE = 0.5; // the model's own "this is a pitched sound" score
// The iPhone mic, without automatic gain, records quietly: the floor is the tuner's, and the real gate is
// relative to the recording (a tenth of its loud parts), so room noise between phrases is still ignored.
const MIN_RMS = 0.0008;
const RELATIVE_GATE = 0.1;
const MIN_NOTE_S = 0.09;
const BATCH = 256;

export interface Track {
  hop: number;
  /** Pitch per reading (fractional MIDI), or null where nothing clearly pitched is heard. */
  midi: (number | null)[];
  /** Loudness around each reading (short window), to split a note sung twice in a row. */
  rms: number[];
}

// CREPE's 360 outputs are 20-cent steps from ~C1; the pitch is the weighted mean around the strongest one.
const CENTS = Array.from({ length: 360 }, (_, i) => 1997.3794084376191 + (7180 / 359) * i);
function toMidi(act: Float32Array, offset: number): { midi: number; confidence: number } {
  let best = 0;
  for (let i = 1; i < 360; i++) if (act[offset + i] > act[offset + best]) best = i;
  let sum = 0;
  let weight = 0;
  for (let i = Math.max(0, best - 4); i < Math.min(360, best + 5); i++) {
    sum += act[offset + i] * CENTS[i];
    weight += act[offset + i];
  }
  const hz = 10 * 2 ** (sum / weight / 1200);
  return { midi: 69 + 12 * Math.log2(hz / 440), confidence: act[offset + best] };
}

/** Pitch every 10 ms of mono 16 kHz samples. `model` is CREPE, loaded by the caller. */
export async function voiceTrack(samples: Float32Array, model: LayersModel, progress: (p: number) => void = () => {}): Promise<Track> {
  const tf = await import("@tensorflow/tfjs");
  // Centered frames, as the model was trained: pad half a frame on each side.
  const padded = new Float32Array(samples.length + FRAME);
  padded.set(samples, FRAME / 2);
  const count = Math.max(0, Math.floor(samples.length / STEP));
  const level = (a: number, b: number) => {
    const part = padded.subarray(Math.max(0, a), Math.min(padded.length, b));
    return part.length ? Math.sqrt(part.reduce((s, x) => s + x * x, 0) / part.length) : 0;
  };
  const rms = Array.from({ length: count }, (_, f) => level(f * STEP + FRAME / 2 - STEP, f * STEP + FRAME / 2 + STEP));
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)] ?? 0;
  const gate = Math.max(MIN_RMS, loud * RELATIVE_GATE);

  const midi: (number | null)[] = new Array(count).fill(null);
  const heard = Array.from({ length: count }, (_, f) => f).filter((f) => level(f * STEP, f * STEP + FRAME) >= gate);
  for (let b = 0; b < heard.length; b += BATCH) {
    const batch = heard.slice(b, b + BATCH);
    const frames = new Float32Array(batch.length * FRAME);
    batch.forEach((f, k) => {
      const frame = padded.subarray(f * STEP, f * STEP + FRAME);
      const mean = frame.reduce((a, x) => a + x, 0) / FRAME;
      const std = Math.sqrt(frame.reduce((a, x) => a + (x - mean) ** 2, 0) / FRAME) || 1e-8;
      for (let i = 0; i < FRAME; i++) frames[k * FRAME + i] = (frame[i] - mean) / std; // the model expects normalized frames
    });
    const out = tf.tidy(() => model.predict(tf.tensor2d(frames, [batch.length, FRAME])) as import("@tensorflow/tfjs").Tensor);
    const act = (await out.data()) as Float32Array;
    out.dispose();
    batch.forEach((f, k) => {
      const { midi: m, confidence } = toMidi(act, k * 360);
      if (confidence >= MIN_CONFIDENCE && m > 36 && m < 96) midi[f] = m;
    });
    progress(Math.min(1, (b + BATCH) / heard.length));
  }
  return { hop: STEP / VOICE_RATE, midi, rms };
}

/**
 * Readings where the voice dips and comes back (a new syllable on the same pitch). A syllable dips deep
 * (a consonant, a breath); vibrato in a room only makes the level wobble, so it must fall below a third.
 */
function dips(rms: number[]): Set<number> {
  const out = new Set<number>();
  const max = (a: number, b: number) => Math.max(0, ...rms.slice(Math.max(0, a), b));
  for (let i = 1; i < rms.length - 1; i++) {
    const local = rms.slice(Math.max(0, i - 4), i + 5);
    if (rms[i] > Math.min(...local)) continue;
    if (rms[i] < 0.33 * Math.min(max(i - 16, i), max(i + 1, i + 17))) out.add(i);
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/**
 * Cuts a pitch curve into notes: a note lasts while the pitch stays within ~half a semitone of where it
 * settled, so vibrato and scoops stay inside one note, and its pitch is the median (vibrato averages out).
 */
/**
 * Folds brief octave jumps back: the model sometimes reads a held note an octave off for a few readings.
 * Compared with the readings around (±150 ms), an off-by-octaves reading is that note; a real leap lasts.
 */
export function foldOctaves(midi: (number | null)[]): (number | null)[] {
  return midi.map((m, i) => {
    if (m === null) return m;
    const around = midi.slice(Math.max(0, i - 15), i + 16).filter((x): x is number => x !== null);
    const offset = m - median(around);
    const octaves = Math.round(offset / 12);
    return octaves !== 0 && Math.abs(offset - 12 * octaves) < 0.7 ? m - 12 * octaves : m;
  });
}

export function segmentMelody(raw: Track): Note[] {
  const track = { ...raw, midi: foldOctaves(raw.midi) };
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
