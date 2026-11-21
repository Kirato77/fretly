import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for Capacitor Preferences.
const store = new Map<string, unknown>();
vi.mock("../src/storage", () => ({
  load: async (k: string, fallback: unknown) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
  save: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
  remove: async (k: string) => void store.delete(k),
}));

const fav = await import("../src/tabs/favorites");
const hit = (ref: string) => ({ source: "ug" as const, artist: "A", title: "T", label: "Chords", ref });
const doc = { title: "T", artist: "A", source: "ug" as const, kind: "Chords", info: [], transposable: true, lines: ["[ch]C[/ch]"] };

describe("favorites", () => {
  beforeEach(async () => {
    store.clear();
    await fav.loadFavorites();
  });

  it("saves the tab with the list and survives a reload", async () => {
    await fav.addFavorite(hit("u1"), doc, 2);
    await fav.loadFavorites(); // app restart
    expect(fav.favorites().map((f) => [f.id, f.semis])).toEqual([["ug:u1", 2]]);
    expect(await fav.loadFavoriteTab("ug:u1")).toEqual(doc);
  });

  it("re-adding moves to the top without a duplicate", async () => {
    await fav.addFavorite(hit("u1"), doc, 0);
    await fav.addFavorite(hit("u2"), doc, 0);
    await fav.addFavorite(hit("u1"), doc, 0);
    expect(fav.favorites().map((f) => f.id)).toEqual(["ug:u1", "ug:u2"]);
  });

  it("remembers the transposition, only for favorites", async () => {
    await fav.addFavorite(hit("u1"), doc, 0);
    fav.setFavoriteSemis("ug:u1", -3);
    fav.setFavoriteSemis("ug:nope", 5);
    await new Promise((r) => setTimeout(r));
    await fav.loadFavorites();
    expect(fav.favorites().map((f) => [f.id, f.semis])).toEqual([["ug:u1", -3]]);
  });

  it("cleans labels saved by older versions", async () => {
    store.set("favorites", [
      { id: "ug:u1", hit: { ...hit("u1"), label: "Chords · ★4.8 (12)" }, semis: 0 },
      { id: "songsterr:1/2", hit: { ...hit("1/2"), source: "songsterr", label: "Tab · Rhythm Guitar" }, semis: 0 },
    ]);
    await fav.loadFavorites();
    expect(fav.favorites().map((f) => f.hit.label)).toEqual(["Chords", "Rhythm Guitar"]);
  });

  it("removing deletes the saved tab too", async () => {
    await fav.addFavorite(hit("u1"), doc, 0);
    await fav.removeFavorite("ug:u1");
    expect(fav.favorites()).toEqual([]);
    expect(await fav.loadFavoriteTab("ug:u1")).toBeNull();
    expect([...store.keys()]).toEqual(["favorites"]);
  });
});
