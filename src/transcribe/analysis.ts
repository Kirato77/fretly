import type { SsTrack } from "../tabs/songsterr";
import { chordName, CHORD_TYPES, type Chord } from "../tools/theory";

/** A note heard in the audio: when, how long, which pitch (MIDI), how loud (0–1). */
export interface Note {
  start: number;
  duration: number;
  midi: number;
  amplitude: number;
}

export interface ChordSpan {
  start: number;
  end: number;
  chord: Chord | null;
}

const OVERTONES = [12, 19, 24, 28, 31, 36]; // octave, 12th, 2 octaves… above a played note

/**
 * Keeps the notes a player would play. The model also reports: a ringing note split in two or doubled at the
 * attack (merged back), overtones of a louder note (dropped), and short quiet blips (dropped).
 */
export function cleanNotes(notes: Note[], tuning: number[]): Note[] {
  const low = Math.min(...tuning) - 1;
  const high = Math.max(...tuning) + 24;
  const sorted = notes
    .filter((n) => n.amplitude >= 0.3 && n.duration >= 0.05 && n.midi >= low && n.midi <= high)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);

  // The same pitch again while it still rings (up to 0.5 s after the model ended it) is the same note when:
  // it is a doubled attack (within 0.2 s), it is much quieter than the first attack, or it pops up with a
  // louder new note of another pitch (the model re-triggers ringing strings then). Not inside a strum
  // (4+ clear notes at once), where every string really is played again.
  const near = (n: Note) => sorted.filter((m) => Math.abs(m.start - n.start) <= 0.15);
  const merged: Note[] = [];
  const ringing = new Map<number, Note>();
  for (const n of sorted) {
    const prev = ringing.get(n.midi);
    const around = near(n);
    const strum = new Set(around.filter((m) => m.amplitude >= 0.4).map((m) => m.midi)).size >= 4;
    const retrigger = !strum && around.some((m) => m.midi !== n.midi && m.amplitude > n.amplitude);
    const sameNote =
      prev &&
      n.start <= prev.start + prev.duration + 0.5 &&
      (n.start - prev.start < 0.2 || n.amplitude < prev.amplitude * 0.7 || retrigger);
    if (prev && sameNote) {
      const end = Math.max(prev.start + prev.duration, n.start + n.duration);
      if (n.amplitude > prev.amplitude && n.start - prev.start < 0.2) prev.start = n.start; // the real attack is the loud one
      prev.duration = end - prev.start;
      prev.amplitude = Math.max(prev.amplitude, n.amplitude);
      continue;
    }
    const copy = { ...n };
    merged.push(copy);
    ringing.set(n.midi, copy);
  }

  const overtone = (n: Note) =>
    merged.some(
      (o) =>
        OVERTONES.includes(n.midi - o.midi) &&
        o.amplitude >= n.amplitude * 1.6 &&
        o.start <= n.start + 0.05 &&
        o.start + o.duration > n.start,
    );
  return merged.filter((n) => !overtone(n) && !(n.duration <= 0.2 && n.amplitude < 0.45));
}

// Chords worth naming in a transcription: richer types get guessed from noise more than heard.
const CANDIDATES = ["maj", "m", "7", "m7", "maj7", "sus2", "sus4", "dim", "5"].map(
  (id) => CHORD_TYPES.find((t) => t.id === id)!,
);

/** Best chord for a pitch-class profile (weights per pitch class), or null when nothing clear is heard. */
export function matchChord(weights: number[], bassPc: number | null): Chord | null {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best: { chord: Chord; score: number } | null = null;
  for (let root = 0; root < 12; root++) {
    if (weights[root] < 0.12 * total) continue; // the root must really be heard
    for (const type of CANDIDATES) {
      const tones = new Set(type.intervals.map((i) => (root + i) % 12));
      let inside = 0;
      for (const pc of tones) inside += weights[pc];
      const outside = total - inside;
      if ([...tones].some((pc) => weights[pc] < 0.04 * total)) continue; // every tone present
      // A 7th (or added) tone must really be heard, not left over from the previous chord still ringing.
      const triad = type.intervals.slice(0, 3).map((i) => weights[(root + i) % 12]);
      const triadMean = triad.reduce((a, b) => a + b, 0) / triad.length;
      if (type.intervals.slice(3).some((i) => weights[(root + i) % 12] < 0.45 * triadMean)) continue;
      // A power chord is just root and fifth: any other clear note means it is something else (or a riff).
      if (type.id === "5" && total - weights[root] - weights[(root + 7) % 12] > 0.15 * total) continue;
      const score = inside - 0.7 * outside + (bassPc === root ? 0.15 * total : 0) - (tones.size - 3) * 0.06 * total;
      if (!best || score > best.score) best = { chord: { root, type }, score };
    }
  }
  return best && best.score > 0.25 * total ? best.chord : null;
}

/** Chord timeline: the harmony every half second, then smoothed so a stray note does not flip the chord. */
export function detectChords(notes: Note[], step = 0.5, minLength = 0.75): ChordSpan[] {
  if (!notes.length) return [];
  const end = Math.max(...notes.map((n) => n.start + n.duration));
  const spans: ChordSpan[] = [];
  for (let t = 0; t < end; t += step) {
    const weights = new Array(12).fill(0);
    let bass: Note | null = null;
    for (const n of notes) {
      const overlap = Math.min(n.start + n.duration, t + step) - Math.max(n.start, t);
      if (overlap <= 0) continue;
      // Squared loudness, fading with time since the attack (as a string does): a fresh strum outweighs
      // strings still ringing from the previous chord.
      const age = Math.max(0, t + step / 2 - n.start);
      weights[n.midi % 12] += overlap * n.amplitude ** 2 * Math.exp(-age / 1.2);
      if (overlap > step * 0.3 && (!bass || n.midi < bass.midi)) bass = n;
    }
    spans.push({ start: t, end: Math.min(t + step, end), chord: matchChord(weights, bass ? bass.midi % 12 : null) });
  }
  return smooth(spans, minLength);
}

const same = (a: Chord | null, b: Chord | null) => (a && b ? chordName(a) === chordName(b) : a === b);

function merge(spans: ChordSpan[]) {
  const out: ChordSpan[] = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && same(last.chord, s.chord)) last.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

/** Folds spans shorter than `minLength` into their neighbour, then joins equal neighbours. */
function smooth(spans: ChordSpan[], minLength: number) {
  let out = merge(spans);
  for (let changed = true; changed; ) {
    changed = false;
    const i = out.length > 1 ? out.findIndex((s) => s.end - s.start < minLength) : -1;
    if (i >= 0) {
      const target = i > 0 ? i - 1 : i + 1;
      out[target] = { ...out[target], start: Math.min(out[target].start, out[i].start), end: Math.max(out[target].end, out[i].end) };
      out.splice(i, 1);
      out = merge(out);
      changed = true;
    }
  }
  return out;
}

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

/** Most likely key of the notes (pitch-class weight against major/minor profiles). */
export function detectKey(notes: Note[]): { root: number; minor: boolean } | null {
  if (!notes.length) return null;
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.midi % 12] += n.duration * n.amplitude;
  let best = { root: 0, minor: false, r: -Infinity };
  for (let root = 0; root < 12; root++) {
    for (const [profile, minor] of [[MAJOR, false], [MINOR, true]] as const) {
      const rotated = profile.map((_, i) => profile[(i - root + 12) % 12]);
      const r = correlation(hist, rotated);
      if (r > best.r) best = { root, minor, r };
    }
  }
  return { root: best.root, minor: best.minor };
}

/** Notes starting together are played together; 120 ms covers a slow strum across six strings. */
export function groupOnsets(notes: Note[], within = 0.12): Note[][] {
  const groups: Note[][] = [];
  for (const n of notes) {
    const g = groups.at(-1);
    if (g && n.start - g[0].start <= within) g.push(n);
    else groups.push([n]);
  }
  return groups;
}

export interface Placed {
  note: Note;
  /** Index in the tuning (lowest string first) and fret. */
  string: number;
  fret: number;
}

/**
 * Puts each group of notes on the strings with as little hand movement as possible: notes sounding together
 * go on different strings, each note goes where its fret is closest to where the hand already is.
 */
export function placeOnStrings(groups: Note[][], tuning: number[], maxFret = 15): Placed[][] {
  let hand = 0;
  return groups.map((group) => {
    const used = new Set<number>();
    const placed: Placed[] = [];
    for (const note of [...group].sort((a, b) => b.midi - a.midi)) {
      let best: { string: number; fret: number; cost: number } | null = null;
      tuning.forEach((open, string) => {
        const fret = note.midi - open;
        if (used.has(string) || fret < 0 || fret > maxFret) return;
        const cost = fret === 0 ? 0.5 : Math.abs(fret - hand) + fret * 0.05;
        if (!best || cost < best.cost) best = { string, fret, cost };
      });
      if (best) {
        const { string, fret } = best;
        used.add(string);
        placed.push({ note, string, fret });
      }
    }
    const fretted = placed.filter((p) => p.fret > 0);
    if (fretted.length) hand = fretted.reduce((a, p) => a + p.fret, 0) / fretted.length;
    return placed;
  });
}

const BEATS_PER_BAR = 8;

/** A track the tab renderer understands: one beat per group, spacing from the gap to the next, chords above. */
export function toTrack(placed: Placed[][], chords: ChordSpan[], tuning: number[]): SsTrack {
  const strings = tuning.length;
  const measures: SsTrack["measures"] = [];
  let shownChord: string | null = null;
  placed.forEach((group, i) => {
    if (!group.length) return;
    const start = group[0].note.start;
    const next = placed[i + 1]?.[0]?.note.start ?? start + 1;
    const gap = next - start;
    const span = chords.find((c) => start >= c.start && start < c.end);
    const name = span?.chord ? chordName(span.chord) : null;
    const beat = {
      notes: group.map((p) => ({ fret: p.fret, string: strings - 1 - p.string })), // tab: highest string on top
      duration: [1, gap >= 0.6 ? 4 : gap >= 0.3 ? 8 : 16] as [number, number],
      ...(name && name !== shownChord ? { chord: { text: name } } : {}),
    };
    if (name) shownChord = name;
    if (!measures.length || measures.at(-1)!.voices[0].beats.length >= BEATS_PER_BAR) measures.push({ voices: [{ beats: [] }] });
    measures.at(-1)!.voices[0].beats.push(beat);
  });
  return { instrument: "Transcription", tuning: [...tuning].reverse(), measures };
}
