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

  it("keeps a recently opened list of tabs that are not favorites", async () => {
    for (let i = 0; i < 10; i++) fav.noteOpened(hit(`r${i}`), doc);
    fav.noteOpened(hit("r3"), doc); // opened again: back to the top, no duplicate
    await new Promise((r) => setTimeout(r));
    await fav.loadFavorites(); // survives a restart
    expect(fav.recentTabs().map((r) => r.id)).toEqual(["ug:r3", "ug:r9", "ug:r8", "ug:r7", "ug:r6", "ug:r5", "ug:r4", "ug:r2"]);
  });

  it("lists favorites by last opened, and opening refreshes what the list shows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    await fav.addFavorite(hit("a"), doc, 0);
    vi.setSystemTime(2000);
    await fav.addFavorite(hit("b"), doc, 0);
    vi.setSystemTime(3000);
    fav.noteOpened(hit("a"), { ...doc, info: ["Capo 3"], tuning: "D A D G A D" });
    vi.useRealTimers();
    expect(fav.favorites().map((f) => [f.id, f.info, f.tuning])).toEqual([
      ["ug:a", ["Capo 3"], "D A D G A D"],
      ["ug:b", [], undefined],
    ]);
    expect(fav.recentTabs()).toEqual([]); // favorites never land in "recently opened"
  });

  it("finds library entries by title or artist, any order, ignoring accents", () => {
    const e = (title: string, artist: string) => ({ id: title, hit: { ...hit(title), title, artist } });
    const lib = [e("Kashmir", "Led Zeppelin"), e("Halo", "Beyoncé"), e("Black Dog", "Led Zeppelin")];
    expect(fav.searchLibrary("zeppelin kashmir", lib).map((x) => x.id)).toEqual(["Kashmir"]);
    expect(fav.searchLibrary("beyonce", lib).map((x) => x.id)).toEqual(["Halo"]);
    expect(fav.searchLibrary("LED", lib).map((x) => x.id)).toEqual(["Kashmir", "Black Dog"]);
    expect(fav.searchLibrary("  ", lib)).toEqual([]);
    expect(fav.searchLibrary("stairway", lib)).toEqual([]);
  });

  it("reads the tuning of tabs saved before it had its own field", async () => {
    const old = { ...doc, info: ["Capo 2", "Tuning Eb Ab Db Gb Bb Eb"] }; // no `tuning`
    expect(fav.docTuning(old)).toBe("D# G# C# F# A# D#");
    await fav.addFavorite(hit("old"), old, 0);
    expect(fav.favorites()[0].tuning).toBe("D# G# C# F# A# D#");
  });

  it("removing deletes the saved tab too", async () => {
    await fav.addFavorite(hit("u1"), doc, 0);
    await fav.removeFavorite("ug:u1");
    expect(fav.favorites()).toEqual([]);
    expect(await fav.loadFavoriteTab("ug:u1")).toBeNull();
    expect([...store.keys()]).toEqual(["favorites"]);
  });
});
