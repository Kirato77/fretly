import { createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js";
import { load, save } from "../storage";
import type { Instrument } from "../tuner/tunings";
import { favorites } from "./favorites";
import { searchSongsterr } from "./songsterr";
import { SOURCE_NAMES, type SearchHit } from "./types";
import { searchUg } from "./ug";

const RECENT_MAX = 8;
const PER_SONG = 5; // UG often has dozens of near-identical versions; the best rated are enough

// "Grover Washington Jr." on UG is "Grover Washington Jr" on Songsterr: compare letters and digits only.
const songKey = (h: SearchHit) => `${h.artist}|${h.title}`.toLowerCase().replace(/[^\p{L}\p{N}|]+/gu, "");

export function Search(p: { instrument: Instrument; onOpen(hit: SearchHit): void }) {
  const [query, setQuery] = createSignal("");
  const [lastQuery, setLastQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [recent, setRecent] = createSignal<string[]>([]);
  let latest = 0;

  onMount(async () => setRecent(await load("recentSearches", [])));

  const keepRecent = (list: string[]) => {
    setRecent(list);
    void save("recentSearches", list);
  };

  /** Searches typed or tapped by the user (instrument re-runs do not touch the history). */
  function search(q: string) {
    if (!q) return;
    setQuery(q);
    keepRecent([q, ...recent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX));
    void run(q);
  }

  async function run(q: string) {
    if (!q) return;
    const id = ++latest;
    setLoading(true);
    setLastQuery(q);
    const sources = [searchUg, searchSongsterr] as const;
    const results = await Promise.allSettled(sources.map((s) => s(q, p.instrument)));
    if (id !== latest) return; // a newer search (e.g. instrument switched) owns the list now
    setHits(results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
    setErrors(
      results.flatMap((r, i) =>
        r.status === "rejected" ? [`${SOURCE_NAMES[i ? "songsterr" : "ug"]} unavailable (${r.reason})`] : [],
      ),
    );
    setLoading(false);
  }

  // Results are filtered per instrument: switching instrument in the tuner refreshes them.
  createEffect(on(() => p.instrument, () => run(lastQuery()), { defer: true }));

  /** One group per song: best-rated UG songs first, then Songsterr-only songs. */
  const groups = createMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits()) map.set(songKey(h), [...(map.get(songKey(h)) ?? []), h]);
    return [...map.values()].map((g) => [
      ...g.filter((h) => h.source === "ug").slice(0, PER_SONG),
      ...g.filter((h) => h.source !== "ug"),
    ]);
  });

  return (
    <div class="search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query().trim());
        }}
      >
        <input
          type="search"
          placeholder="Song or artist"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          enterkeyhint="search"
          autocapitalize="off"
          autocorrect="off"
        />
        <button class="primary" disabled={loading()}>
          {loading() ? "…" : "Search"}
        </button>
      </form>

      <Show when={!query() && favorites().length}>
        <div class="song">
          <h3>Favorites</h3>
          <For each={favorites()}>
            {(f) => (
              <button class="hit" onClick={() => p.onOpen(f.hit)}>
                <span class={`badge ${f.hit.source}`}>{f.hit.source === "ug" ? "UG" : "Songsterr"}</span>
                <span class="fav-text">
                  {f.hit.title} <span class="muted">— {f.hit.artist}</span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* History shows before the first search, or again once the search box is cleared. */}
      <Show when={(!hits().length || !query()) && !loading() && recent().length}>
        <div class="recent">
          <div class="recent-head">
            <h3>Recent</h3>
            <button class="ghost" onClick={() => keepRecent([])}>
              Clear
            </button>
          </div>
          <For each={recent()}>
            {(r) => (
              <button class="chip" onClick={() => search(r)}>
                {r}
              </button>
            )}
          </For>
        </div>
      </Show>

      <For each={errors()}>{(e) => <p class="error">{e}</p>}</For>
      <Show when={!loading() && lastQuery() && !hits().length}>
        <p class="muted">No free tabs found for “{lastQuery()}”.</p>
      </Show>

      <For each={groups()}>
        {(group) => (
          <div class="song">
            <h3>
              {group[0].title} <span class="muted">— {group[0].artist}</span>
            </h3>
            <For each={group}>
              {(h) => (
                <button class="hit" onClick={() => p.onOpen(h)}>
                  <span class={`badge ${h.source}`}>{h.source === "ug" ? "UG" : "Songsterr"}</span>
                  {h.label}
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
