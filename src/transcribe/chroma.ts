import FFT from "fft.js";
import { CHORD_TYPES, type Chord } from "../tools/theory";
import type { ChordSpan } from "./analysis";

// Chords of a full mix, read from the sound rather than from notes (the approach of tools like Chordino):
// 1. spectrum over time, 2. drums removed (harmonic/percussive separation), 3. energy per pitch class
// ("chroma"), bass counted apart, 4. most likely chord sequence (Viterbi), so noise cannot flip the chord.

const N = 4096; // ~186 ms at 22 kHz: resolves semitones down to the bass
const HOP = 2048; // ~93 ms: chords last seconds, finer steps only cost time
const KERNEL = 17; // median filter length, in frames (~1.6 s) and in bins
const FMIN = 40; // just under E1, a bass guitar's lowest note
const FMAX = 5500; // harmonics of the notes up to C6 still in range

const tick = () => new Promise((r) => setTimeout(r));

/** Magnitude spectrum per frame, only the bins between FMIN and FMAX. */
async function spectrogram(samples: Float32Array, rate: number, progress: (p: number) => void) {
  const fft = new FFT(N);
  const out = fft.createComplexArray();
  const frame = new Float64Array(N);
  const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const lo = Math.ceil((FMIN * N) / rate);
  const hi = Math.floor((FMAX * N) / rate);
  const frames: Float32Array[] = [];
  const count = Math.max(0, Math.floor((samples.length - N) / HOP) + 1);
  for (let f = 0; f < count; f++) {
    for (let i = 0; i < N; i++) frame[i] = samples[f * HOP + i] * hann[i];
    fft.realTransform(out, frame);
    const mags = new Float32Array(hi - lo);
    for (let k = lo; k < hi; k++) mags[k - lo] = Math.hypot(out[2 * k], out[2 * k + 1]);
    frames.push(mags);
    if (f % 200 === 0) {
      progress((f / count) * 0.5);
      await tick();
    }
  }
  return { frames, lo };
}

/** Median of values[from, to): copied into a typed array, whose native numeric sort is fast. */
function medianOf(values: Float32Array, from: number, to: number, scratch: Float32Array) {
  const a = Math.max(0, from);
  const b = Math.min(values.length, to);
  const window = scratch.subarray(0, b - a);
  window.set(values.subarray(a, b));
  window.sort();
  return window[window.length >> 1] ?? 0;
}

/** Keeps what holds in time (harmony) and drops what spreads over frequencies for an instant (drum hits). */
async function harmonicPart(frames: Float32Array[], progress: (p: number) => void) {
  const bins = frames[0]?.length ?? 0;
  const half = KERNEL >> 1;
  const scratch = new Float32Array(KERNEL);
  const column = new Float32Array(frames.length);
  const harmonic = frames.map(() => new Float32Array(bins));
  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < frames.length; f++) column[f] = frames[f][k];
    for (let f = 0; f < frames.length; f++) harmonic[f][k] = medianOf(column, f - half, f + half + 1, scratch);
    if (k % 40 === 0) {
      progress(0.5 + (k / bins) * 0.3);
      await tick();
    }
  }
  // Soft mask: each bin keeps the share that is harmonic rather than percussive.
  return frames.map((mags, f) => {
    const out = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const h = harmonic[f][k];
      const p = medianOf(mags, k - half, k + half + 1, scratch);
      out[k] = h * h + p * p ? mags[k] * ((h * h) / (h * h + p * p)) : 0;
    }
    return out;
  });
}

const LOW_NOTE = 28; // E1
const HIGH_NOTE = 84; // C6
const BASS_NOTE = 52; // up to E3 counts as bass
const HARMONICS = 6;

/**
 * Energy per pitch class for each frame (and for the bass range alone), by harmonic summation: a note's
 * strength is its fundamental plus its harmonics. Raw spectra mislead: the 5th harmonic of A is a C#, so an
 * A minor chord looks major; summed over harmonics, that C# has little support and the real C wins.
 */
function chromagram(frames: Float32Array[], lo: number, rate: number) {
  const binOf = (f: number) => Math.round((f * N) / rate) - lo;
  const plan = Array.from({ length: HIGH_NOTE - LOW_NOTE + 1 }, (_, i) => {
    const midi = LOW_NOTE + i;
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    const semitoneBins = (f: number) => (f * 0.0595 * N) / rate;
    const bins = Array.from({ length: HARMONICS }, (_, h) => {
      const f = f0 * (h + 1);
      // Read the neighbouring bins too only where a semitone spans 2+ bins: lower down they hold other notes.
      return { bin: binOf(f), wide: semitoneBins(f) >= 2 };
    }).filter((_, h) => h > 0 || semitoneBins(f0) >= 1); // below ~90 Hz semitones share a bin: harmonics decide

    return { pc: midi % 12, bass: midi <= BASS_NOTE, bins };
  });
  return frames.map((mags) => {
    const chroma = new Array(12).fill(0);
    const bass = new Array(12).fill(0);
    // Only real spectral peaks count: the slope of a neighbour's peak is leakage, not a note.
    const isPeak = (b: number) => b > 0 && b < mags.length - 1 && mags[b] >= mags[b - 1] && mags[b] >= mags[b + 1];
    const peak = ({ bin: b, wide }: { bin: number; wide: boolean }) => {
      if (b < 1 || b >= mags.length - 1) return 0;
      const best = wide ? [b - 1, b, b + 1].reduce((x, y) => (mags[y] > mags[x] ? y : x)) : b;
      return isPeak(best) ? mags[best] : 0;
    };
    const saliences = plan.map((p) => p.bins.reduce((a, b, h) => a + peak(b) * 0.8 ** h, 0));
    const loudest = Math.max(...saliences);
    plan.forEach((p, i) => {
      // Relative to the loudest note of the frame, square root so a quiet third still counts (it tells major
      // from minor), with a floor (~-20 dB) so residue and noise count for nothing.
      const e = loudest > 0 ? Math.max(0, Math.sqrt(saliences[i] / loudest) - 0.3) : 0;
      chroma[p.pc] += e;
      if (p.bass) bass[p.pc] += e;
    });
    return { chroma, bass };
  });
}

const STATES: (Chord | null)[] = [
  null, // no chord
  ...["maj", "m", "7"].flatMap((id) => Array.from({ length: 12 }, (_, root) => ({ root, type: CHORD_TYPES.find((t) => t.id === id)! }))),
];

/**
 * How well a frame matches a chord: correlation between its pitch-class energy and the chord's template.
 * A flat noise floor (a rapped voice, cymbals) lifts every pitch class alike, so it barely moves the score.
 */
function templateScore(chord: Chord | null, chroma: number[], bass: number[]) {
  if (!chord) return 0.25; // "no chord" wins only when nothing correlates well
  const template = new Array(12).fill(0);
  chord.type.intervals.forEach((i, n) => (template[(chord.root + i) % 12] = n === 3 ? 0.6 : 1)); // a 7th counts a little less
  const peak = Math.max(...bass);
  const bassBonus = peak > 0 && bass[chord.root] === peak ? 0.1 : 0;
  return pearson(chroma, template) + bassBonus - (chord.type.intervals.length > 3 ? 0.04 : 0);
}

function pearson(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Most likely chord per frame with a cost for every change: short blips do not flip the chord. */
function viterbi(scores: number[][], switchCost: number) {
  const S = STATES.length;
  let prev = scores[0].slice();
  const back: Int16Array[] = [];
  for (let f = 1; f < scores.length; f++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (prev[s] > prev[bestPrev]) bestPrev = s;
    const cur = new Array(S);
    const from = new Int16Array(S);
    for (let s = 0; s < S; s++) {
      const stay = prev[s];
      const move = prev[bestPrev] - switchCost;
      from[s] = stay >= move ? s : bestPrev;
      cur[s] = Math.max(stay, move) + scores[f][s];
    }
    back.push(from);
    prev = cur;
  }
  let s = 0;
  for (let i = 1; i < S; i++) if (prev[i] > prev[s]) s = i;
  const path = [s];
  for (let f = back.length - 1; f >= 0; f--) path.unshift((s = back[f][s]));
  return path;
}

/** Chord timeline of a full mix (mono samples). `progress` goes from 0 to 1. */
export async function songChords(samples: Float32Array, rate: number, progress: (p: number) => void = () => {}): Promise<{ spans: ChordSpan[]; profile: number[] }> {
  const { frames, lo } = await spectrogram(samples, rate, progress);
  if (!frames.length) return { spans: [], profile: new Array(12).fill(0) };
  const harmonic = await harmonicPart(frames, progress);
  const chroma = chromagram(harmonic, lo, rate);
  // Average over ~0.5 s around each frame: chords last, frames jitter.
  const smooth = chroma.map((_, f) => {
    const win = chroma.slice(Math.max(0, f - 3), f + 4);
    const avg = (key: "chroma" | "bass") => Array.from({ length: 12 }, (_, pc) => win.reduce((a, x) => a + x[key][pc], 0) / win.length);
    return { chroma: avg("chroma"), bass: avg("bass") };
  });
  const scores = smooth.map((x) => STATES.map((s) => templateScore(s, x.chroma, x.bass)));
  const path = viterbi(scores, 1.0); // a change needs a few frames (~0.3 s) of evidence
  progress(1);
  const seconds = HOP / rate;
  const spans: ChordSpan[] = [];
  path.forEach((s, f) => {
    const last = spans.at(-1);
    if (last && last.chord === STATES[s]) last.end = (f + 1) * seconds;
    else spans.push({ start: f * seconds, end: (f + 1) * seconds, chord: STATES[s] });
  });
  const profile = new Array(12).fill(0);
  for (const x of chroma) x.chroma.forEach((v, pc) => (profile[pc] += v));
  return { spans: spans.filter((s) => s.end - s.start >= 0.3 || s.chord === null), profile };
}
