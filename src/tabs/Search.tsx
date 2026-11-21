import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { Instrument } from "../tuner/tunings";
import { searchSongsterr } from "./songsterr";
import { SOURCE_NAMES, type SearchHit } from "./types";
import { searchUg } from "./ug";

const PER_SONG = 5; // UG often has dozens of near-identical versions; the best rated are enough

// "Grover Washington Jr." on UG is "Grover Washington Jr" on Songsterr: compare letters and digits only.
const songKey = (h: SearchHit) => `${h.artist}|${h.title}`.toLowerCase().replace(/[^\p{L}\p{N}|]+/gu, "");

export function Search(p: { instrument: Instrument; onOpen(hit: SearchHit): void }) {
  const [query, setQuery] = createSignal("");
  const [lastQuery, setLastQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);

  async function run(q: string) {
    if (!q) return;
    setLoading(true);
    setLastQuery(q);
    const sources = [searchUg, searchSongsterr] as const;
    const results = await Promise.allSettled(sources.map((s) => s(q, p.instrument)));
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
          void run(query().trim());
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
