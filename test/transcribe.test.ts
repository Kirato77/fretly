import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trackToLines } from "../src/tabs/songsterr";
import { chordName } from "../src/tools/theory";
import {
  cleanNotes,
  detectChords,
  detectKey,
  groupOnsets,
  matchChord,
  placeOnStrings,
  toTrack,
  type Note,
} from "../src/transcribe/analysis";
import { parseNote } from "../src/tuner/notes";
import { PRESETS } from "../src/tuner/tunings";

const STANDARD = PRESETS[0].notes;
const note = (name: string, start: number, duration = 0.4, amplitude = 0.8): Note => ({ midi: parseNote(name), start, duration, amplitude });
const strum = (names: string, start: number, duration: number) => names.split(" ").map((n) => note(n, start, duration));
const profile = (pcs: Record<number, number>) => Array.from({ length: 12 }, (_, i) => pcs[i] ?? 0);

describe("chord matching", () => {
  it("names clear triads and sevenths", () => {
    expect(chordName(matchChord(profile({ 0: 1, 4: 1, 7: 1 }), 0)!)).toBe("C");
    expect(chordName(matchChord(profile({ 9: 1, 0: 1, 4: 1 }), 9)!)).toBe("Am");
    expect(chordName(matchChord(profile({ 7: 1, 11: 1, 2: 1, 5: 1 }), 7)!)).toBe("G7");
  });

  it("says nothing for noise or silence", () => {
    expect(matchChord(new Array(12).fill(1), null)).toBeNull();
    expect(matchChord(new Array(12).fill(0), null)).toBeNull();
  });
});

describe("chord timeline", () => {
  it("follows a progression and ignores a stray note", () => {
    const notes = [
      ...strum("C3 E3 G3 C4", 0, 2),
      note("D#4", 1.0, 0.15), // a slip between two strums
      ...strum("G2 B2 D3 G3", 2, 2),
      ...strum("A2 E3 A3 C4", 4, 2),
    ];
    const spans = detectChords(cleanNotes(notes, STANDARD));
    expect(spans.map((s) => (s.chord ? chordName(s.chord) : "-"))).toEqual(["C", "G", "Am"]);
    expect(spans[1].start).toBeCloseTo(2, 0);
  });
});

describe("key", () => {
  it("finds major and minor keys from the notes played", () => {
    const scale = (names: string) => names.split(" ").map((n, i) => note(n, i * 0.5, 0.5));
    expect(detectKey(scale("C3 D3 E3 F3 G3 A3 B3 C4 G3 E3 C3"))).toEqual({ root: 0, minor: false });
    expect(detectKey(scale("A2 C3 D3 E3 G3 A3 E3 C3 A2 E3"))).toEqual({ root: 9, minor: true });
  });
});

describe("notes on the strings", () => {
  it("keeps a riff in one hand position and splits a chord across strings", () => {
    const riff = groupOnsets([note("E2", 0), note("G2", 0.5), note("A2", 1), ...strum("C3 E3 G3", 1.5, 1)]);
    const placed = placeOnStrings(riff, STANDARD);
    // E open, G 3rd fret, then A on the open A string: first position, as a player would
    expect(placed.slice(0, 3).map((g) => [g[0].string, g[0].fret])).toEqual([[0, 0], [0, 3], [1, 0]]);
    const chord = placed[3];
    expect(new Set(chord.map((p) => p.string)).size).toBe(3); // three different strings
    for (const p of chord) expect(STANDARD[p.string] + p.fret).toBe(p.note.midi); // right pitch
  });

  it("renders as a tab with each chord named once", () => {
    const notes = [...strum("C3 E3 G3", 0, 1), ...strum("C3 E3 G3", 1, 1), ...strum("G2 B2 D3", 2, 1)];
    const groups = groupOnsets(notes);
    const track = toTrack(placeOnStrings(groups, STANDARD), detectChords(notes, 0.5, 0.5), STANDARD);
    const text = trackToLines(track, 60).join("\n");
    expect(text.match(/\[ch\]C\[\/ch\]/g)!.length).toBe(1);
    expect(text).toContain("[ch]G[/ch]");
    expect(text.split("\n").filter((l) => /^[A-G]#? ?\|/.test(l)).length).toBe(6);
  });
});

describe("on real model output", () => {
  // Basic Pitch's notes for a synthesized clip: C, C, G, G, Am, Am strummed once a second, then the riff
  // E2 G2 A2 G2 E2 from 6.5 s. Raw: doubled attacks, overtones, ringing strings picked up again.
  const raw: Note[] = JSON.parse(readFileSync(new URL("./fixtures/basic-pitch-progression.json", import.meta.url), "utf8"));
  const notes = cleanNotes(raw, STANDARD);

  it("removes doubles and overtones", () => {
    expect(notes.length).toBeLessThan(raw.length * 0.6);
    // the first C chord: one of each string, no octave ghosts
    const first = notes.filter((n) => n.start < 0.3).map((n) => n.midi).sort((a, b) => a - b);
    expect(first).toEqual([48, 52, 55, 60, 64]); // C3 E3 G3 C4 E4
  });

  it("finds the progression, and no chord for the single-note riff", () => {
    const names = detectChords(notes).map((s) => (s.chord ? chordName(s.chord) : "-"));
    expect(names.slice(0, 3)).toEqual(["C", "G", "Am"]);
    expect(names.slice(3).every((n) => n === "-" || n === "Em")).toBe(true);
  });

  it("keeps the riff notes in order", () => {
    const riff = groupOnsets(notes.filter((n) => n.start > 6.4 && n.midi < 46)).map((g) => g.map((n) => n.midi));
    expect(riff.map((g) => g[0])).toEqual([40, 43, 45, 43, 40]); // E2 G2 A2 G2 E2
  });
});
