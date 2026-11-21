export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const midiToFreq = (midi: number, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);

/** Fractional MIDI number, e.g. 40.03 = E2 three cents sharp. */
export const freqToMidi = (freq: number, a4 = 440) => 69 + 12 * Math.log2(freq / a4);

export const pitchClass = (midi: number) => NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];

export const octave = (midi: number) => Math.floor(Math.round(midi) / 12) - 1;

export const noteName = (midi: number) => pitchClass(midi) + octave(midi);

/** "E2", "F#3", "Bb1" → MIDI number. */
export function parseNote(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const pc = NOTE_NAMES.indexOf(m[1]) + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + pc;
}
