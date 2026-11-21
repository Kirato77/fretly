import { createSignal } from "solid-js";
import { load, remove, save } from "../storage";
import type { SearchHit, TabDoc } from "./types";

// The list (small) is kept in one key and loaded at start; each tab (can be large) in its own key,
// read only when opened. Tabs are stored in full so favorites open offline and survive removal upstream.
const LIST = "favorites";
const tabKey = (id: string) => `favorite:${id}`;

export interface Favorite {
  id: string;
  hit: SearchHit;
  /** Transposition last used on this tab. */
  semis: number;
}

const [favorites, setFavorites] = createSignal<Favorite[]>([]);
export { favorites };

export const favoriteId = (hit: SearchHit) => `${hit.source}:${hit.ref}`;
export const findFavorite = (hit: SearchHit) => favorites().find((f) => f.id === favoriteId(hit));

const keep = (list: Favorite[]) => {
  setFavorites(list);
  return save(LIST, list);
};

export async function loadFavorites() {
  const list = await load<Favorite[]>(LIST, []);
  // Favorites saved before 0.1.17952925xx carry labels like "Tab · Rhythm Guitar" or "Chords · ★4.8 (12)".
  const label = (l: string) => l.replace(/^Tab · /, "").replace(/ · ★.*$/, "");
  setFavorites(list.map((f) => ({ ...f, hit: { ...f.hit, label: label(f.hit.label) } })));
}

export async function addFavorite(hit: SearchHit, doc: TabDoc, semis: number) {
  const id = favoriteId(hit);
  await save(tabKey(id), doc); // tab first: a listed favorite must always have its tab
  await keep([{ id, hit, semis }, ...favorites().filter((f) => f.id !== id)]);
}

export async function removeFavorite(id: string) {
  await keep(favorites().filter((f) => f.id !== id));
  await remove(tabKey(id));
}

export const loadFavoriteTab = (id: string) => load<TabDoc | null>(tabKey(id), null);

export function setFavoriteSemis(id: string, semis: number) {
  if (favorites().some((f) => f.id === id && f.semis !== semis)) {
    void keep(favorites().map((f) => (f.id === id ? { ...f, semis } : f)));
  }
}
