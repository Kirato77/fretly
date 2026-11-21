import { createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js";
import { load, save } from "../storage";
import type { Instrument } from "../tuner/tunings";
import { Icon } from "../ui/Icon";
import { favorites } from "./favorites";
import { searchSongsterr } from "./songsterr";
import { SOURCE_NAMES, type SearchHit } from "./types";
import { searchUg } from "./ug";

const RECENT_MAX = 8;
const PER_SONG = 5; // UG often has dozens of near-identical versions; the best rated are enough

// "Grover Washington Jr." on UG is "Grover Washington Jr" on Songsterr: compare letters and digits only.
const songKey = (h: SearchHit) => `${h.artist}|${h.title}`.toLowerCase().replace(/[^\p{L}\p{N}|]+/gu, "");
const shortCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function SourceBadge(p: { source: SearchHit["source"] }) {
  return (
    <span class={`badge ${p.source}`} title={SOURCE_NAMES[p.source]}>
      {p.source === "ug" ? "UG" : "SR"}
    </span>
  );
}

export function Search(p: { instrument: Instrument; onOpen(hit: SearchHit): void }) {
  const [query, setQuery] = createSignal("");
  const [lastQuery, setLastQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [recent, setRecent] = createSignal<string[]>([]);
  let latest = 0;
  let input!: HTMLInputElement;

  onMount(async () => setRecent(await load("recentSearches", [])));

  const keepRecent = (list: string[]) => {
    setRecent(list);
    void save("recentSearches", list);
  };

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
        r.status === "rejected" ? [`${SOURCE_NAMES[i ? "songsterr" : "ug"]} is unreachable right now.`] : [],
      ),
    );
    setLoading(false);
  }

  /** Searches typed or tapped by the user (instrument re-runs do not touch the history). */
  function search(q: string) {
    if (!q) return;
    setQuery(q);
    input.blur(); // hide the keyboard to show the results
    keepRecent([q, ...recent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX));
    void run(q);
  }

  // Results are filtered per instrument: switching instrument in the tuner refreshes them.
  createEffect(on(() => p.instrument, () => run(lastQuery()), { defer: true }));

  /** One card per song: best-rated UG songs first, then Songsterr-only songs. */
  const groups = createMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits()) map.set(songKey(h), [...(map.get(songKey(h)) ?? []), h]);
    return [...map.values()].map((g) => [
      ...g.filter((h) => h.source === "ug").slice(0, PER_SONG),
      ...g.filter((h) => h.source !== "ug"),
    ]);
  });
  const showHome = () => !query() || (!hits().length && !loading());

  return (
    <div class="search">
      <header class="search-head">
        <h1>Tabs</h1>
        <form
          class="search-field"
          classList={{ loading: loading() }}
          onSubmit={(e) => {
            e.preventDefault();
            search(query().trim());
          }}
        >
          <Icon name="search" size={20} />
          <input
            ref={input}
            type="search"
            placeholder="Song or artist"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            enterkeyhint="search"
            autocapitalize="off"
            autocorrect="off"
            aria-label="Search tabs"
          />
          <span class="spinner" aria-hidden="true" />
        </form>
        <p class="search-scope">Free {p.instrument} tabs from Ultimate Guitar and Songsterr</p>
      </header>

      <For each={errors()}>{(e) => <p class="notice">{e}</p>}</For>
      <Show when={query() && !loading() && lastQuery() === query() && !hits().length && !errors().length}>
        <p class="notice">No free tabs found for “{lastQuery()}”.</p>
      </Show>

      <Show when={showHome()}>
        <Show when={favorites().length}>
          <section class="block">
            <h2>
              <Icon name="star" size={16} filled /> Favorites
            </h2>
            <div class="card">
              <For each={favorites()}>
                {(f) => (
                  <button class="row" onClick={() => p.onOpen(f.hit)}>
                    <SourceBadge source={f.hit.source} />
                    <span class="row-main">
                      <span class="row-title">{f.hit.title}</span>
                      <span class="row-sub">
                        {f.hit.artist} · {f.hit.label}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={recent().length}>
          <section class="block">
            <h2>
              <Icon name="clock" size={16} /> Recent
              <button class="text-btn" onClick={() => keepRecent([])}>
                Clear
              </button>
            </h2>
            <div class="chips">
              <For each={recent()}>
                {(r) => (
                  <button class="chip" onClick={() => search(r)}>
                    {r}
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={!favorites().length && !recent().length}>
          <div class="empty">
            <Icon name="tabs" size={36} />
            <p>Search a song to find its chords and tabs. Star the ones you play to keep them offline.</p>
          </div>
        </Show>
      </Show>

      <Show when={!showHome()}>
        <For each={groups()}>
          {(group) => (
            <section class="block">
              <div class="song-head">
                <span class="song-title">{group[0].title}</span>
                <span class="song-artist">{group[0].artist}</span>
              </div>
              <div class="card">
                <For each={group}>
                  {(h) => (
                    <button class="row" onClick={() => p.onOpen(h)}>
                      <SourceBadge source={h.source} />
                      <span class="row-main">
                        <span class="row-title">{h.label}</span>
                      </span>
                      <Show when={h.rating !== undefined}>
                        <span class="rating">
                          <Icon name="star" size={13} filled /> {h.rating!.toFixed(1)}
                          <span class="votes">{shortCount(h.votes ?? 0)}</span>
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
