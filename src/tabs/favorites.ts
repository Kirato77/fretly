import { createSignal } from "solid-js";
import { load, remove, save } from "../storage";
import { normalizeTuning } from "../tuner/tunings";
import type { SearchHit, TabDoc } from "./types";

// The library: favorites (kept in full, offline) and recently opened tabs (just the link).
// Lists are small and loaded at start; each favorite's tab (can be large) has its own key, read when opened.
const LIST = "favorites";
const RECENT = "recentTabs";
const RECENT_MAX = 8;
const tabKey = (id: string) => `favorite:${id}`;

/** What the library shows about a tab without loading it. */
export interface Entry {
  id: string;
  hit: SearchHit;
  openedAt?: number;
  /** Capo, tuning, key… from the tab. */
  info?: string[];
  tuning?: string;
}

export interface Favorite extends Entry {
  /** Transposition last used on this tab. */
  semis: number;
}

const [stored, setStored] = createSignal<Favorite[]>([]);
const [recentTabs, setRecentTabs] = createSignal<Entry[]>([]);
export { recentTabs };

const byLastOpened = (a: Entry, b: Entry) => (b.openedAt ?? 0) - (a.openedAt ?? 0);
/** Favorites, most recently played first. */
export const favorites = () => [...stored()].sort(byLastOpened);

export const favoriteId = (hit: SearchHit) => `${hit.source}:${hit.ref}`;
export const findFavorite = (hit: SearchHit) => stored().find((f) => f.id === favoriteId(hit));
export const isFavorite = (id: string) => stored().some((f) => f.id === id);

const keep = (list: Favorite[]) => {
  setStored(list);
  return save(LIST, list);
};
const keepRecent = (list: Entry[]) => {
  setRecentTabs(list);
  return save(RECENT, list);
};

export async function loadFavorites() {
  const list = await load<Favorite[]>(LIST, []);
  // Favorites saved before 0.1.17952925xx carry labels like "Tab · Rhythm Guitar" or "Chords · ★4.8 (12)".
  const label = (l: string) => l.replace(/^Tab · /, "").replace(/ · ★.*$/, "");
  setStored(list.map((f) => ({ ...f, hit: { ...f.hit, label: label(f.hit.label) } })));
  setRecentTabs(await load<Entry[]>(RECENT, []));
}

/** A tab's tuning; copies saved before 0.1.1795294828 only have it as text ("Tuning E A D G B E"). */
export const docTuning = (doc: TabDoc) => {
  const text = doc.info.find((i) => i.startsWith("Tuning "));
  return doc.tuning ?? (text ? normalizeTuning(text.slice("Tuning ".length)) : undefined);
};

const describe = (doc: TabDoc) => ({ info: doc.info, tuning: docTuning(doc) });

export async function addFavorite(hit: SearchHit, doc: TabDoc, semis: number) {
  const id = favoriteId(hit);
  await save(tabKey(id), doc); // tab first: a listed favorite must always have its tab
  await keep([{ id, hit, semis, openedAt: Date.now(), ...describe(doc) }, ...stored().filter((f) => f.id !== id)]);
}

export async function removeFavorite(id: string) {
  await keep(stored().filter((f) => f.id !== id));
  await remove(tabKey(id));
}

/** Called when a tab is shown: a favorite moves to the top, any other tab goes to "Recently opened". */
export function noteOpened(hit: SearchHit, doc: TabDoc) {
  const id = favoriteId(hit);
  const opened = { openedAt: Date.now(), ...describe(doc) };
  if (isFavorite(id)) {
    void keep(stored().map((f) => (f.id === id ? { ...f, ...opened } : f)));
  } else {
    void keepRecent([{ id, hit, ...opened }, ...recentTabs().filter((r) => r.id !== id)].slice(0, RECENT_MAX));
  }
}

export const clearRecentTabs = () => keepRecent([]);

export const loadFavoriteTab = (id: string) => load<TabDoc | null>(tabKey(id), null);

export function setFavoriteSemis(id: string, semis: number) {
  if (stored().some((f) => f.id === id && f.semis !== semis)) {
    void keep(stored().map((f) => (f.id === id ? { ...f, semis } : f)));
  }
}

/** Lowercase, no accents, punctuation as spaces: "Beyoncé — Halo!" → "beyonce halo". */
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Library entries whose title or artist contain every word typed, in any order. */
export function searchLibrary<T extends Entry>(query: string, entries: T[]): T[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  return entries.filter((e) => {
    const text = fold(`${e.hit.title} ${e.hit.artist}`);
    return words.every((w) => text.includes(w));
  });
}
