import { pitchClass } from "../tuner/notes";
import type { Instrument } from "../tuner/tunings";
import { getJson } from "./http";
import type { SearchHit, TabDoc } from "./types";

// Unofficial Songsterr endpoints, as used by their web player.
const API = "https://www.songsterr.com/api";
const CDN = "https://dqsljvtekg760.cloudfront.net";

export interface SsTrackInfo {
  instrumentId: number;
  instrument: string;
  name?: string;
  tuning?: number[];
  views?: number;
}

export interface SsSong {
  songId: number;
  artist: string;
  title: string;
  tracks: SsTrackInfo[];
}

interface SsNote {
  fret: number;
  string: number;
  tie?: boolean;
  dead?: boolean;
  rest?: boolean;
}

interface SsBeat {
  notes?: SsNote[];
  duration: [number, number];
  chord?: { text: string };
}

interface SsMeasure {
  voices: { beats: SsBeat[] }[];
  marker?: { text: string };
}

export interface SsTrack {
  name?: string;
  instrument: string;
  capo?: number;
  /** MIDI notes, string 0 = highest-pitched string (top line of a tab). */
  tuning: number[];
  measures: SsMeasure[];
}

/** General MIDI program numbers: 24–31 guitars, 32–39 basses. GM has no ukulele. */
export function fitsInstrument(t: SsTrackInfo, instrument: Instrument) {
  const strings = t.tuning?.length ?? 0;
  if (instrument === "bass") return t.instrumentId >= 32 && t.instrumentId <= 39;
  if (instrument === "ukulele") return strings === 4 && Math.min(...t.tuning!) >= 55;
  return t.instrumentId >= 24 && t.instrumentId <= 31 && strings >= 6;
}

/** "Noel Gallagher | Takamine FP460SC | Rhythm Guitar" → "Rhythm Guitar". */
const trackName = (t: { name?: string; instrument: string }) => (t.name || t.instrument).split("|").pop()!.trim();

export function parseSongsterrSearch(songs: SsSong[], instrument: Instrument): SearchHit[] {
  return songs.flatMap((song) =>
    song.tracks
      .map((t, index) => ({ t, index }))
      .filter(({ t }) => fitsInstrument(t, instrument))
      .sort((a, b) => (b.t.views ?? 0) - (a.t.views ?? 0))
      .slice(0, 3)
      .map(({ t, index }) => ({
        source: "songsterr" as const,
        artist: song.artist,
        title: song.title,
        label: `Tab · ${trackName(t)}`,
        ref: `${song.songId}/${index}`,
      })),
  );
}

interface Rendered {
  width: number;
  chords: { col: number; text: string }[];
  lines: string[];
}

function renderMeasure(m: SsMeasure, strings: number): Rendered {
  const lines: string[] = Array(strings).fill("");
  const chords: Rendered["chords"] = [];
  // First voice only and no rhythm notation (spacing hints durations): alphaTab would be the upgrade.
  for (const beat of m.voices[0]?.beats ?? []) {
    const cells: string[] = Array(strings).fill("");
    for (const n of beat.notes ?? []) {
      if (!n.rest && !n.tie && n.string < strings) cells[n.string] = n.dead ? "x" : String(n.fret);
    }
    const w = Math.max(1, ...cells.map((c) => c.length));
    const gap = beat.duration[1] <= 4 ? 3 : beat.duration[1] <= 8 ? 2 : 1;
    if (beat.chord?.text) chords.push({ col: lines[0].length + 1, text: beat.chord.text });
    for (let i = 0; i < strings; i++) lines[i] += "-" + cells[i].padEnd(w, "-") + "-".repeat(gap);
  }
  if (!lines[0]) lines.fill("--------");
  return { width: lines[0].length + 1, chords, lines };
}

/** ASCII tab, measures packed into rows of at most `cols` characters, a new row at each section. */
export function trackToLines(track: SsTrack, cols: number): string[] {
  const strings = track.tuning.length;
  const names = track.tuning.map(pitchClass);
  const labelW = Math.max(...names.map((n) => n.length)) + 1;
  const labels = names.map((n) => n.padEnd(labelW - 1) + "|");
  const out: string[] = [];
  let row: Rendered[] = [];

  const flush = () => {
    if (!row.length) return;
    let chordLine = "";
    let plain = 0;
    let x = labelW;
    for (const r of row) {
      for (const c of r.chords) {
        const pad = Math.max(x + c.col - plain, plain > labelW ? 1 : 0);
        chordLine += " ".repeat(pad) + `[ch]${c.text}[/ch]`;
        plain += pad + c.text.length;
      }
      x += r.width;
    }
    if (chordLine) out.push(chordLine);
    for (let s = 0; s < strings; s++) out.push(labels[s] + row.map((r) => r.lines[s] + "|").join(""));
    out.push("");
    row = [];
  };

  let width = labelW;
  for (const m of track.measures) {
    const r = renderMeasure(m, strings);
    if (m.marker || width + r.width > cols) {
      flush();
      width = labelW;
    }
    if (m.marker) out.push(`[${m.marker.text}]`);
    row.push(r);
    width += r.width;
  }
  flush();
  return out;
}

/** Keeps only what trackToLines reads: a big track JSON shrinks a lot before being saved as a favorite. */
export function compactTrack(t: SsTrack): SsTrack {
  return {
    name: t.name,
    instrument: t.instrument,
    capo: t.capo,
    tuning: t.tuning,
    measures: t.measures.map((m) => ({
      ...(m.marker && { marker: { text: m.marker.text } }),
      voices: (m.voices[0] ? [m.voices[0]] : []).map((v) => ({
        beats: v.beats.map((b) => ({
          duration: b.duration,
          ...(b.chord?.text && { chord: { text: b.chord.text } }),
          notes: (b.notes ?? []).map(({ fret, string, tie, dead, rest }) => ({ fret, string, tie, dead, rest })),
        })),
      })),
    })),
  };
}

export function trackToDoc(song: { artist: string; title: string }, track: SsTrack): TabDoc {
  return {
    title: song.title,
    artist: song.artist,
    source: "songsterr",
    kind: trackName(track),
    info: [
      track.capo ? `Capo ${track.capo}` : "",
      `Tuning ${[...track.tuning].reverse().map(pitchClass).join(" ")}`,
    ].filter(Boolean),
    transposable: false,
    track: compactTrack(track),
  };
}

export const searchSongsterr = async (query: string, instrument: Instrument) =>
  parseSongsterrSearch(
    await getJson<SsSong[]>(`${API}/songs?pattern=${encodeURIComponent(query)}&size=20`),
    instrument,
  );

export async function fetchSongsterrTab(ref: string): Promise<TabDoc> {
  const [songId, index] = ref.split("/");
  const meta = await getJson<{ artist: string; title: string; revisionId: number; image: string }>(
    `${API}/meta/${songId}`,
  );
  const track = await getJson<SsTrack>(`${CDN}/${songId}/${meta.revisionId}/${meta.image}/${index}.json`);
  return trackToDoc(meta, track);
}
