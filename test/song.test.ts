import process from "node:process";
import { describe, expect, it } from "vitest";
import { chordName } from "../src/tools/theory";
import { cleanNotes, joinFragments, melodyLine, type Note } from "../src/transcribe/analysis";
import { PRESETS } from "../src/tuner/tunings";
import { songChords } from "../src/transcribe/chroma";
import { harmonize, pitchTrack, segmentMelody } from "../src/transcribe/melody";
import { midiToFreq, parseNote } from "../src/tuner/notes";

const RATE = 22050;
let seed = 3;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;

/** Adds a plucked/keyboard-like note: harmonics, quick attack, decay. */
function addNote(buf: Float32Array, midi: number, start: number, dur: number, amp: number) {
  const f = midiToFreq(midi);
  const s0 = Math.floor(start * RATE);
  for (let i = 0; i < dur * RATE && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.01) * Math.exp(-t / (dur * 0.7));
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h ** 1.2;
    buf[s0 + i] += amp * env * v;
  }
}

describe("full song chords", () => {
  it("finds C G Am F through drums, bass and a rapped voice", async () => {
    const seconds = 16;
    const buf = new Float32Array(seconds * RATE);
    const prog = [["C3 E3 G3 C4", "C2"], ["G2 B2 D3 G3", "G1"], ["A2 C3 E3 A3", "A1"], ["F2 A2 C3 F3", "F1"]];
    "E5 G5 C6 G5 D5 G5 B5 G5 C5 E5 A5 E5 C5 F5 A5 F5".split(" ").forEach((n, i) => addNote(buf, parseNote(n), i * 0.5, 0.45, 0.12));
    for (let bar = 0; bar < 8; bar++) {
      const [chord, bass] = prog[bar % 4];
      for (let beat = 0; beat < 4; beat++) for (const n of chord.split(" ")) addNote(buf, parseNote(n), bar * 2 + beat * 0.5, 0.5, 0.08);
      addNote(buf, parseNote(bass), bar * 2, 1, 0.25);
      addNote(buf, parseNote(bass), bar * 2 + 1, 1, 0.25);
    }
    for (let i = 0; i < buf.length; i++) {
      const t = i / RATE;
      const beat = t % 0.5;
      // kick (low thump) and hats (noise bursts), and a "rap": noise in the voice band, syllable-shaped
      buf[i] += (beat < 0.08 ? Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.03) * 0.5 : 0) + (t % 0.25 < 0.03 ? rand() * 0.25 : 0);
      buf[i] += rand() * 0.12 * Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * (t > 4 ? 1 : 0);
    }
    const { spans } = await songChords(buf, RATE);
    if (process.env.PEEK) console.log(spans.map((x) => `${x.start.toFixed(1)}-${x.end.toFixed(1)} ${x.chord ? chordName(x.chord) : "-"}`).join("  "));
    const named = spans.filter((s) => s.end - s.start >= 1).map((s) => (s.chord ? chordName(s.chord) : "-"));
    expect(named.slice(0, 8)).toEqual(["C", "G", "Am", "F", "C", "G", "Am", "F"]);
  }, 30000);
});

describe("sung melody", () => {
  it("reads notes through vibrato and scoops", () => {
    const tune = ["C4", "D4", "E4", "E4", "G4", "E4"].map(parseNote);
    const buf = new Float32Array(Math.ceil(tune.length * 0.4 * RATE));
    let phase = 0;
    for (let i = 0; i < buf.length; i++) {
      const t = i / RATE;
      const k = Math.min(tune.length - 1, Math.floor(t / 0.4));
      const inNote = t - k * 0.4;
      const scoop = inNote < 0.03 && k > 0 ? (tune[k - 1] - tune[k]) * (1 - inNote / 0.03) : 0; // slide in
      const vibrato = 0.3 * Math.sin(2 * Math.PI * 5.5 * t); // ±30 cents
      phase += (2 * Math.PI * midiToFreq(tune[k] + scoop + vibrato)) / RATE;
      const syllable = Math.min(1, inNote / 0.04, (0.4 - inNote) / 0.04); // each note sung as its own syllable
      buf[i] = 0.4 * syllable * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) + 0.01 * rand();
    }
    const notes = segmentMelody(pitchTrack(buf, RATE));
    expect(notes.map((n) => n.midi)).toEqual(tune);
  });

  it("suggests chords that fit the melody in its key", () => {
    const m = (names: string, start: number) => names.split(" ").map((n, i): Note => ({ midi: parseNote(n), start: start + i * 0.5, duration: 0.5, amplitude: 1 }));
    const melody = [...m("C4 E4 G4 E4", 0), ...m("F4 A4 C5 A4", 2), ...m("G4 B4 D5 B4", 4), ...m("C5 G4 E4 C4", 6)];
    const spans = harmonize(melody, { root: 0, minor: false });
    expect(spans.map((s) => chordName(s.chord!))).toEqual(["C", "F", "G", "C"]);
  });
});

describe("melody of a mix", () => {
  it("keeps the top note of each group, not the bass or the chord", () => {
    const n = (name: string, start: number): Note => ({ midi: parseNote(name), start, duration: 0.4, amplitude: 0.8 });
    const notes = [n("C2", 0), n("E3", 0), n("G3", 0), n("E5", 0), n("C4", 0.2), n("D5", 0.5), n("C2", 1), n("G3", 1), n("C5", 1)];
    expect(melodyLine(notes).map((x) => x.midi)).toEqual(["E5", "D5", "C5"].map(parseNote));
  });

  it("joins a melody note split by a drum hit, keeps a louder repeat", () => {
    const n = (start: number, amplitude: number): Note => ({ midi: parseNote("A4"), start, duration: 0.25, amplitude });
    expect(melodyLine([n(0, 0.6), n(0.25, 0.58)]).map((x) => x.duration)).toEqual([0.5]);
    expect(melodyLine([n(0, 0.6), n(0.25, 0.7)])).toHaveLength(2);
  });
});

describe("fragments of a mix", () => {
  it("glues a held note the model chopped into pieces, keeps separate notes apart", () => {
    const n = (start: number, midi = 76): Note => ({ midi, start, duration: 0.08, amplitude: 0.5 });
    const joined = joinFragments([n(0.58), n(0.67), n(0.75), n(0.84), n(1.4), n(0.7, 69)]);
    expect(joined.map((x) => [x.midi, x.start, +x.duration.toFixed(2)])).toEqual([[76, 0.58, 0.34], [69, 0.7, 0.08], [76, 1.4, 0.08]]);
  });
});

describe("melody over a loud bass", () => {
  it("keeps a melody note two octaves above the bass in a mix", () => {
    const bass: Note = { midi: parseNote("E3"), start: 4.35, duration: 1, amplitude: 0.9 };
    const tune: Note = { midi: parseNote("E5"), start: 4.38, duration: 0.44, amplitude: 0.47 };
    expect(cleanNotes([bass, tune], PRESETS[0].notes, true)).toHaveLength(2);
    expect(cleanNotes([bass, tune], PRESETS[0].notes)).toHaveLength(1); // solo instrument: that is an overtone
  });
});
