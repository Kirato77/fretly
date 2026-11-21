import { describe, expect, it } from "vitest";
import { freqToMidi, midiToFreq, noteName, parseNote } from "../src/tuner/notes";
import { createDetector, nearestString, Smoother, WINDOW } from "../src/tuner/pitch";
import { findTuning, normalizeTuning, PRESETS, tuningToOffer } from "../src/tuner/tunings";

const SR = 48000;

// Seeded noise so the precision tests are not flaky.
let seed = 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;

/** Plucked-string-ish test tone: sawtooth-like harmonics, optional noise. */
function tone(freq: number, noise = 0, amp = 0.2) {
  const buf = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) {
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin((2 * Math.PI * freq * h * i) / SR + h) / h;
    buf[i] = amp * s + noise * rand();
  }
  return buf;
}

const centsOff = (measured: number, expected: number) => 1200 * Math.log2(measured / expected);

describe("notes", () => {
  it("converts between notes, MIDI and Hz", () => {
    expect(midiToFreq(69)).toBe(440);
    expect(midiToFreq(69, 432)).toBe(432);
    expect(parseNote("E2")).toBe(40);
    expect(parseNote("F#3")).toBe(54);
    expect(parseNote("Bb1")).toBe(34);
    expect(parseNote("B0")).toBe(23);
    expect(noteName(40)).toBe("E2");
    expect(freqToMidi(82.4069)).toBeCloseTo(40, 4);
  });

  it("has the presets right", () => {
    const dadgad = PRESETS.find((t) => t.id === "guitar-dadgad")!;
    expect(dadgad.notes.map(noteName).join(" ")).toBe("D2 A2 D3 G3 A3 D4");
    // Guitalele = guitar with a capo at the 5th fret
    const guitalele = PRESETS.find((t) => t.id === "guitar-guitalele")!;
    const standard = PRESETS.find((t) => t.id === "guitar-standard")!;
    expect(guitalele.notes).toEqual(standard.notes.map((n) => n + 5));
  });
});

describe("pitch detector", () => {
  const detect = createDetector(SR);
  // E2 3 cents sharp, ukulele high G, A4, high e
  for (const f of [midiToFreq(40.03), midiToFreq(67), 440, midiToFreq(64)]) {
    it(`is within 0.5 cent on one frame at ${f.toFixed(2)} Hz`, () => {
      const got = detect(tone(f, 0.02));
      expect(got).not.toBeNull();
      expect(Math.abs(centsOff(got!, f))).toBeLessThan(0.5);
    });
  }

  // Bass low E and 5-string low B: one noisy frame can be ~1 cent off, the smoothed needle is not.
  for (const midi of [28, 23]) {
    it(`is within 0.5 cent once smoothed at MIDI ${midi}`, () => {
      const s = new Smoother();
      let v = 0;
      for (let i = 0; i < 12; i++) v = s.push(freqToMidi(detect(tone(midiToFreq(midi), 0.02))!));
      expect(Math.abs(v - midi) * 100).toBeLessThan(0.5);
    });
  }

  it("hears a softly picked high e (≈ -61 dBFS) within half a cent", () => {
    const got = detect(tone(midiToFreq(64), 0.0003, 0.001));
    expect(got).not.toBeNull();
    expect(Math.abs(centsOff(got!, midiToFreq(64)))).toBeLessThan(0.5);
  });

  it("ignores quiet room noise", () => {
    expect(detect(new Float32Array(WINDOW).map(() => 0.001 * rand()))).toBeNull();
  });

  it("ignores silence and noise", () => {
    expect(detect(new Float32Array(WINDOW))).toBeNull();
    const noise = new Float32Array(WINDOW).map(rand);
    expect(detect(noise)).toBeNull();
  });
});

describe("smoother and string pick", () => {
  it("snaps to a new note instead of gliding", () => {
    const s = new Smoother();
    for (let i = 0; i < 10; i++) s.push(40);
    s.push(45.1);
    s.push(45.1);
    expect(s.push(45.1)).toBeCloseTo(45.1);
  });

  it("drops a single octave blip", () => {
    const s = new Smoother();
    [40, 40, 40, 40].forEach((m) => s.push(m));
    expect(s.push(52)).toBeCloseTo(40);
    expect(s.push(40.01)).toBeLessThan(40.05);
  });

  it("picks the nearest string", () => {
    expect(nearestString(45.3, [40, 45, 50, 55, 59, 64])).toBe(1);
  });
});

describe("tab tunings", () => {
  it("normalises the way tab sites write tunings", () => {
    expect(normalizeTuning("Eb Ab Db Gb Bb Eb")).toBe("D# G# C# F# A# D#");
    expect(normalizeTuning(" e a d g b e ")).toBe("E A D G B E");
  });

  it("finds the tuner tuning a tab is written for", () => {
    expect(findTuning(normalizeTuning("D A D G A D"), PRESETS)?.id).toBe("guitar-dadgad");
    expect(findTuning(normalizeTuning("Eb Ab Db Gb Bb Eb"), PRESETS)?.id).toBe("guitar-half-down");
    expect(findTuning("G C E A", PRESETS)?.id).toBe("ukulele-standard");
    expect(findTuning("C G D G B D", PRESETS)).toBeUndefined();
  });
});

describe("tuning to offer for a tab", () => {
  const byId = (id: string) => PRESETS.find((t) => t.id === id)!;

  it("offers the tab's tuning when the tuner is elsewhere", () => {
    expect(tuningToOffer("D A D G A D", byId("guitar-standard"), PRESETS)?.id).toBe("guitar-dadgad");
  });

  it("offers nothing when the tuner already plays those notes, whatever the octave", () => {
    expect(tuningToOffer("G C E A", byId("ukulele-low-g"), PRESETS)).toBeUndefined(); // not pushed to high G
    expect(tuningToOffer("E A D G B E", byId("guitar-standard"), PRESETS)).toBeUndefined();
    expect(tuningToOffer(undefined, byId("guitar-standard"), PRESETS)).toBeUndefined();
  });
});
