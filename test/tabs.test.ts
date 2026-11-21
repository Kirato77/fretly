import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { transposeChord, transposeLine, wrapSheet } from "../src/tabs/chords";
import { compactTrack, parseSongsterrSearch, trackToDoc, trackToLines, type SsSong, type SsTrack } from "../src/tabs/songsterr";
import { decodeEntities, parseUgSearch, parseUgTab } from "../src/tabs/ug";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("chords", () => {
  it("transposes chord names", () => {
    expect(transposeChord("F#m7", 1)).toBe("Gm7");
    expect(transposeChord("Bb/D", 2)).toBe("C/E");
    expect(transposeChord("Am", -2)).toBe("Gm");
    expect(transposeChord("Eb", 1)).toBe("E");
    expect(transposeChord("Ab", 1)).toBe("A");
    expect(transposeChord("Db", -1)).toBe("C");
    expect(transposeChord("Bbm", 2)).toBe("Cm");
    expect(transposeChord("N.C.", 3)).toBe("N.C.");
  });

  it("keeps chord columns on a chords-only line", () => {
    const line = "[ch]C[/ch]      [ch]G[/ch]   [ch]Am[/ch]";
    expect(transposeLine(line, 1)).toBe("[ch]C#[/ch]     [ch]G#[/ch]  [ch]A#m[/ch]");
    expect(transposeLine("[ch]Em[/ch][ch]C[/ch]", 6)).toBe("[ch]A#m[/ch] [ch]F#[/ch]");
  });

  it("renames in place when chords sit inside lyrics", () => {
    expect(transposeLine("Hello [ch]C[/ch] world", 2)).toBe("Hello [ch]D[/ch] world");
  });
});

describe("Ultimate Guitar", () => {
  it("decodes entities", () => {
    expect(decodeEntities("&quot;a&amp;b&#039;&#x41;")).toBe(`"a&b'A`);
  });

  it("keeps free chords/tabs, best rated first", () => {
    const hits = parseUgSearch(fixture("ug-search.html"), "guitar");
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every((h) => /^(Chords|Tabs)( · v\d+)?$/.test(h.label))).toBe(true);
    expect(hits.some((h) => h.ref.includes("/pro/"))).toBe(false);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score!).toBeGreaterThanOrEqual(hits[i].score!);
    expect(hits.some((h) => h.ref.endsWith("-10"))).toBe(false); // private
    expect(hits.some((h) => h.ref.endsWith("-9"))).toBe(false); // video
    expect(hits[0].ref.endsWith("-chords-4")).toBe(true); // 4.87★ with 412 votes beats 5★ with 3
    expect(hits[0].label).toBe("Chords · v2");
    expect(parseUgSearch(fixture("ug-search.html"), "bass").map((h) => [h.label, h.rating, h.votes])).toEqual([["Bass Tabs", 4.4, 80]]);
  });

  it("parses a chord sheet", () => {
    const doc = parseUgTab(fixture("ug-tab.html"));
    expect(doc.title).toBe("Test Song");
    expect(doc.artist).toBe("Test Artist");
    expect(doc.transposable).toBe(true);
    expect(doc.info).toEqual(["Capo 2", "Tuning E A D G B E", "Key F#m"]);
    const lines = doc.lines!;
    expect(lines).toContain("[Intro]");
    expect(lines.join("\n")).toContain("[ch]F#m7[/ch]");
    expect(lines.join("\n")).not.toContain("[tab]");
  });
});

describe("Songsterr", () => {
  const songs: SsSong[] = JSON.parse(fixture("songsterr-search.json"));
  const track: SsTrack = JSON.parse(fixture("songsterr-track.json"));

  it("lists guitar tracks only, not vocals or drums", () => {
    const hits = parseSongsterrSearch(songs, "guitar");
    expect(hits[0]).toMatchObject({ artist: "Test Artist", title: "Test Song", ref: "2/3", label: "Rhythm Guitar" });
    expect(hits.map((h) => h.ref)).toEqual(["2/3", "2/2", "5/0"]);
    expect(hits.every((h) => !/vocal|drum/i.test(h.label))).toBe(true);
    expect(parseSongsterrSearch(songs, "bass").length).toBeGreaterThan(0);
  });

  it("renders an ASCII tab within the width", () => {
    const lines = trackToLines(track, 60);
    expect(lines[0]).toBe("[Intro]");
    expect(lines[1]).toContain("[ch]Em7[/ch]");
    expect(lines[2]).toMatch(/^E\|-3-/); // high e, first beat fret 3
    expect(lines[7]).toMatch(/^E\|-0-/); // low E
    const tabLines = lines.filter((l) => /^[A-G]#?\s?\|/.test(l));
    expect(tabLines.every((l) => l.length <= 60)).toBe(true);
    // The chord name sits right above its fret
    expect(lines[1].indexOf("[ch]Em7")).toBe(lines[2].indexOf("3"));
  });

  it("renders a compacted track exactly like the full one, from plain JSON", () => {
    const stored = JSON.parse(JSON.stringify(compactTrack(track))); // as saved and reloaded
    expect(trackToLines(stored, 50)).toEqual(trackToLines(track, 50));
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(track).length);
  });

  it("builds the doc header", () => {
    const doc = trackToDoc({ artist: "Test Artist", title: "Test Song" }, track);
    expect(doc.info).toEqual(["Capo 2", "Tuning E A D G B E"]);
    expect(doc.kind).toBe("Rhythm Guitar");
  });
});

describe("wrapSheet", () => {
  const col = (line: string, word: string) => line.replace(/\[ch\](.*?)\[\/ch\]/g, "$1").indexOf(word);

  it("wraps a chord line and its lyrics together, chords staying above their syllable", () => {
    const chords = "[ch]Bm[/ch]                                     [ch]F#7[/ch]";
    const lyric = "  On a dark desert highway, cool wind in my hair";
    const out = wrapSheet([chords, lyric], 30);
    expect(out.length).toBe(4);
    expect(out.every((l) => l.replace(/\[ch\](.*?)\[\/ch\]/g, "$1").length <= 30)).toBe(true);
    // F#7 sat at column 39 of the original line: on the wrapped line it sits over the same character
    const [, , chords2, lyric2] = out;
    expect(col(chords2, "F#7")).toBe(39 - lyric.indexOf(lyric2));
    expect(lyric2[col(chords2, "F#7")]).toBe(lyric[39]);
    expect(out[1]).toBe("  On a dark desert highway,");
  });

  it("keeps chord marks whole when wrapping a mixed line", () => {
    const out = wrapSheet(["[ch]Bm[/ch] [ch]F#7[/ch] [ch]A[/ch] [ch]E[/ch] [ch]G[/ch] [ch]D[/ch] [ch]Em[/ch] [ch]F#7[/ch] x2"], 12);
    expect(out.join("\n").match(/\[ch\]/g)!.length).toBe(8);
    expect(out.every((l) => !/\[ch\][^[]*$/.test(l))).toBe(true);
    expect(out.length).toBeGreaterThan(1);
  });

  it("leaves tab staffs and short lines alone", () => {
    const staff = "e|-------0-----0-----0-----0-----3-----3-----3-----3-----|";
    expect(wrapSheet([staff, "short"], 20)).toEqual([staff, "short"]);
  });
});
