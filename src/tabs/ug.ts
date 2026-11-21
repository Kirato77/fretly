import type { Instrument } from "../tuner/tunings";
import { getText } from "./http";
import type { SearchHit, TabDoc } from "./types";

// Unofficial: UG ships its page data as JSON in <div class="js-store" data-content="…">.
const TYPES: Record<Instrument, string[]> = {
  guitar: ["Chords", "Tabs"],
  bass: ["Bass Tabs"],
  ukulele: ["Ukulele Chords", "Chords"],
};

interface UgResult {
  song_name: string;
  artist_name: string;
  type?: string;
  rating?: number;
  votes?: number;
  tab_url: string;
  tab_access_type?: string;
  marketing_type?: string;
}

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTITIES[e.toLowerCase()] ?? all),
  );

function readStore(html: string): any {
  const m = /class="js-store" data-content="([^"]*)"/.exec(html);
  if (!m) throw new Error("Ultimate Guitar page format changed");
  return JSON.parse(decodeEntities(m[1])).store.page.data;
}

/** Bayesian rating: a 5★ tab with 3 votes must not beat a 4.8★ one with 2500. */
const score = (rating: number, votes: number) => (votes * rating + 20 * 3.5) / (votes + 20);

export function parseUgSearch(html: string, instrument: Instrument): SearchHit[] {
  const results: UgResult[] = readStore(html).results ?? [];
  return results
    // Pro / Official / Video entries are paid or not tabs.
    .filter((r) => TYPES[instrument].includes(r.type ?? "") && r.tab_access_type === "public" && !r.marketing_type)
    .map((r) => ({
      source: "ug" as const,
      artist: r.artist_name,
      title: r.song_name,
      label: `${r.type} · ★${(r.rating ?? 0).toFixed(1)} (${r.votes ?? 0})`,
      score: score(r.rating ?? 0, r.votes ?? 0),
      ref: r.tab_url,
    }))
    .sort((a, b) => b.score - a.score);
}

export function parseUgTab(html: string): TabDoc {
  const data = readStore(html);
  const meta = data.tab_view?.meta ?? {};
  const content: string = data.tab_view?.wiki_tab?.content ?? "";
  const lines = content.replace(/\r\n?/g, "\n").replace(/\[\/?tab\]/g, "").split("\n");
  return {
    title: data.tab?.song_name ?? "",
    artist: data.tab?.artist_name ?? "",
    source: "ug",
    kind: data.tab?.type ?? "Tab",
    info: [
      meta.capo ? `Capo ${meta.capo}` : "",
      meta.tuning?.value ? `Tuning ${meta.tuning.value}` : "",
      meta.tonality ? `Key ${meta.tonality}` : "",
    ].filter(Boolean),
    transposable: /chords/i.test(data.tab?.type ?? ""),
    lines,
  };
}

export const searchUg = async (query: string, instrument: Instrument) =>
  parseUgSearch(
    await getText(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`),
    instrument,
  );

export const fetchUgTab = async (url: string) => parseUgTab(await getText(url));
