import { describe, expect, it } from "vitest";
import { chordName, chordNotes, degreeOf, findVoicings, parseChord, SCALES, tapTempo } from "../src/tools/theory";
import { PRESETS } from "../src/tuner/tunings";

const tuning = (id: string) => PRESETS.find((t) => t.id === id)!.notes;
const shapes = (name: string, id = "guitar-standard") =>
  findVoicings(tuning(id), parseChord(name)!).map((v) => v.map((f) => (f < 0 ? "x" : f)).join(""));

describe("chord names", () => {
  it("reads the way tab sites write chords", () => {
    expect(chordName(parseChord("F#m7")!)).toBe("F#m7");
    expect(chordName(parseChord("Bb/D")!)).toBe("A#/D");
    expect(chordName(parseChord("Asus")!)).toBe("Asus4");
    expect(chordName(parseChord("Cmaj")!)).toBe("C");
    expect(chordName(parseChord("EbM7")!)).toBe("D#maj7");
    expect(chordNotes(parseChord("Cadd9")!)).toEqual(["C", "E", "G", "D"]);
    expect(parseChord("N.C.")).toBeNull();
    expect(parseChord("Cfoo")).toBeNull();
  });
});

describe("chord shapes", () => {
  it("finds the classic open shapes first in standard tuning", () => {
    expect(shapes("C")[0]).toBe("x32010");
    expect(shapes("Am")[0]).toBe("x02210");
    expect(shapes("E")[0]).toBe("022100");
    expect(shapes("D")[0]).toBe("xx0232");
    expect(shapes("Dm")[0]).toBe("xx0231");
    expect(shapes("F")[0]).toBe("133211");
    expect(shapes("E7")[0]).toBe("020100");
    expect(shapes("C7")).toContain("x32310"); // the 5th may go on a 7th chord
    expect(["320003", "320033"]).toContain(shapes("G")[0]);
  });

  it("keeps the slash chord's bass note lowest", () => {
    for (const s of shapes("G/B")) expect(s.startsWith("x2") || s.startsWith("7")).toBe(true);
  });

  it("works in other tunings and on ukulele", () => {
    expect(shapes("D", "guitar-dadgad")[0]).toBe("000204"); // D A D open, then A on G, open A, F# on top
    expect(shapes("C", "ukulele-standard")[0]).toBe("0003");
    expect(shapes("Am", "ukulele-standard")[0]).toBe("2000");
  });

  it("never asks for a barre over an open string", () => {
    expect(shapes("F")).not.toContain("103211");
  });

  it("every shape is playable: at most 4 fingers, chord tones only", () => {
    const t = tuning("guitar-standard");
    for (const name of ["C", "F#m7", "Bb", "Gmaj7", "Ddim7", "Esus4", "A9"]) {
      const chord = parseChord(name)!;
      const tones = new Set(chord.type.intervals.map((i) => (chord.root + i) % 12));
      for (const v of findVoicings(t, chord)) {
        v.forEach((f, i) => f >= 0 && expect(tones.has((t[i] + f) % 12)).toBe(true));
        const fretted = v.filter((f) => f > 0);
        expect(Math.max(...fretted, 0) - Math.min(...fretted, 99)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("scales", () => {
  it("places notes by degree", () => {
    const minorPenta = SCALES.find((s) => s.id === "penta-minor")!;
    const a = 9;
    expect([9, 0, 2, 4, 7].map((pc) => degreeOf(pc, a, minorPenta))).toEqual([0, 3, 5, 7, 10]);
    expect(degreeOf(1, a, minorPenta)).toBe(-1); // C# is not in A minor pentatonic
  });
});

describe("tap tempo", () => {
  it("averages the last taps, ignores long pauses", () => {
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 5000, 5600])).toBe(100); // the 5 s pause does not count
    expect(tapTempo([0, 100])).toBe(240); // clamped to the slider range
  });
});
