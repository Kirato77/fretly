import { NOTE_NAMES } from "../tuner/notes";

const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CH = /\[ch\](.*?)\[\/ch\]/g;

function shiftNote(note: string, semis: number, flats: boolean) {
  const pc = NOTE_NAMES.indexOf(note[0]) + (note[1] === "#" ? 1 : note[1] === "b" ? -1 : 0);
  return (flats ? FLATS : NOTE_NAMES)[(((pc + semis) % 12) + 12) % 12];
}

/** "F#m7" +1 → "Gm7", "Bb/D" +2 → "C/E". Names that are not chords come back unchanged. */
export function transposeChord(chord: string, semis: number): string {
  if (!semis || !/^[A-G]/.test(chord)) return chord;
  const flats = /(^|\/)[A-G]b/.test(chord);
  return chord.replace(/(^|\/)([A-G][#b]?)/g, (_, slash, note) => slash + shiftNote(note, semis, flats));
}

/**
 * Transposes every [ch]X[/ch] of a line. On a chords-only line each chord keeps its original
 * column, so it stays above the right syllable even when its name gets longer or shorter.
 */
export function transposeLine(line: string, semis: number): string {
  if (!semis || !line.includes("[ch]")) return line;
  const rename = (c: string) => transposeChord(c, semis);
  // Chords mixed with lyrics on one line: columns cannot be kept, rename in place.
  if (line.replace(CH, "").trim()) return line.replace(CH, (_, c) => `[ch]${rename(c)}[/ch]`);
  let out = "";
  let col = 0; // column reached in the output
  let src = 0; // column in the original line, without tags
  let last = 0;
  for (const m of line.matchAll(CH)) {
    src += m.index - last;
    const name = rename(m[1]);
    const pad = Math.max(src - col, col ? 1 : 0);
    out += " ".repeat(pad) + `[ch]${name}[/ch]`;
    col += pad + name.length;
    src += m[1].length;
    last = m.index + m[0].length;
  }
  return out;
}
