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

const visible = (line: string) => line.replace(CH, "$1");
const isChordLine = (line: string) => line.includes("[ch]") && !line.replace(CH, "").trim();
// Tab staff lines ("e|--3--|", "|-0-2-") are drawings: wrapping them would scramble the strings.
const isStaff = (line: string) => /^\s*[A-Ga-g][#b]?\s*\||\|-|-\|/.test(line);

/** Chords of a chords-only line with the column each one starts at. */
function chordsOf(line: string) {
  const chords: { col: number; name: string }[] = [];
  let col = 0;
  let last = 0;
  for (const m of line.matchAll(CH)) {
    col += m.index - last;
    chords.push({ col, name: m[1] });
    col += m[1].length;
    last = m.index + m[0].length;
  }
  return chords;
}

function chordLine(chords: { col: number; name: string }[], offset: number) {
  let out = "";
  let width = 0;
  for (const c of chords) {
    const pad = Math.max(c.col - offset - width, width ? 1 : 0);
    out += " ".repeat(pad) + `[ch]${c.name}[/ch]`;
    width += pad + c.name.length;
  }
  return out;
}

/** Cuts a chord line and its lyric line at the same columns, so each chord stays above its syllable. */
function wrapPair(chords: string, lyric: string, cols: number): string[] {
  const list = chordsOf(chords);
  const width = Math.max(lyric.length, ...list.map((c) => c.col + c.name.length));
  const text = lyric.padEnd(width);
  const out: string[] = [];
  let start = 0;
  while (start < width) {
    let end = Math.min(start + cols, width);
    if (end < width) {
      const space = text.lastIndexOf(" ", end);
      if (space > start) end = space;
      const cut = list.find((c) => c.col < end && c.col + c.name.length > end); // never split a chord name
      if (cut && cut.col > start) end = cut.col;
    }
    const here = list.filter((c) => c.col >= start && c.col < end);
    if (here.length) out.push(chordLine(here, start));
    out.push(text.slice(start, end).trimEnd());
    start = end;
    while (text[start] === " " && !list.some((c) => c.col === start)) start++;
  }
  return out;
}

/** Wraps a line on spaces, counting only visible characters, so [ch] marks stay whole. */
function wrapWords(line: string, cols: number): string[] {
  const out: string[] = [];
  let current = "";
  for (let word of line.split(/(?<= )/)) {
    if (current && visible(current + word).trimEnd().length > cols) {
      out.push(current.trimEnd());
      current = "";
    }
    // A plain word longer than the line ("*****…", "=======…") can only be cut.
    while (!word.includes("[ch]") && word.trimEnd().length > cols) {
      out.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    current += word;
  }
  out.push(current.trimEnd());
  return out;
}

/**
 * Cuts a block of staff lines (one per string) at the same columns, so the strings stay aligned.
 * Prefers cutting right after a bar line; otherwise where no fret number would be split in two.
 */
function wrapStaff(block: string[], cols: number): string[] {
  const width = Math.max(...block.map((l) => l.length));
  if (width <= cols) return block;
  const label = /^\s*[A-Ga-g][#b]?\s*\|/.exec(block[0])?.[0].length ?? 0; // "e|" repeated on every piece
  const room = cols - label;
  const digitAt = (l: string, i: number) => /\d/.test(l[i] ?? "");
  const out: string[] = [];
  let start = label;
  while (start < width) {
    let end = Math.min(start + room, width);
    if (end < width) {
      const bar = block[0].lastIndexOf("|", end - 1);
      if (bar >= start + room / 2) end = bar + 1;
      else
        while (end > start + 1 && block.some((l) => digitAt(l, end - 1) && digitAt(l, end))) end--;
    }
    // A leftover of just the closing bar or a few dashes ("D||") carries no note: drop it.
    const leftover = start > label && end - start <= 3 && block.every((l) => /^[-|]*$/.test(l.slice(start, end)));
    if (leftover) break;
    if (out.length) out.push("");
    for (const l of block) out.push(l.slice(0, label) + l.slice(start, end));
    start = end;
  }
  return out;
}

/** Fits a chord sheet to `cols` characters: chord/lyric pairs wrap together, staff blocks are cut together. */
export function wrapSheet(lines: string[], cols: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isStaff(line)) {
      let j = i;
      while (j < lines.length && isStaff(lines[j])) j++;
      out.push(...wrapStaff(lines.slice(i, j), cols));
      i = j - 1;
      continue;
    }
    const next = lines[i + 1];
    const isPair = isChordLine(line) && next !== undefined && next.trim() && !next.includes("[ch]") && !isStaff(next);
    if (isPair && Math.max(visible(line).length, next.length) > cols) {
      out.push(...wrapPair(line, next, cols));
      i++;
    } else if (visible(line).length > cols) {
      out.push(...wrapWords(line, cols));
    } else {
      out.push(line);
    }
  }
  return out;
}
