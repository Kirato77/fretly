import { createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js";
import { load, save } from "../storage";
import { findTuning, type Instrument, type Tuning } from "../tuner/tunings";
import { Icon } from "../ui/Icon";
import { clearRecentTabs, favoriteId, favorites, isFavorite, recentTabs, searchLibrary } from "./favorites";
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

interface Props {
  instrument: Instrument;
  tunings: Tuning[];
  onOpen(hit: SearchHit): void;
  /** Bumped when the Songs tab button is tapped again: leave search, or scroll the library to the top. */
  back: number;
}

/**
 * The Songs tab: your library first (favorites, recently opened), search as a mode on top of it.
 * Tapping the field enters search; Cancel goes back to the library.
 */
export function Songs(p: Props) {
  const [searching, setSearching] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [lastQuery, setLastQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [recentQueries, setRecentQueries] = createSignal<string[]>([]);
  const [sortAZ, setSortAZ] = createSignal(false);
  let latest = 0;
  let input!: HTMLInputElement;
  let root!: HTMLDivElement;

  onMount(async () => {
    setRecentQueries(await load("recentSearches", []));
    setSortAZ(await load("favoritesSortAZ", false));
  });
  const toggleSort = (az: boolean) => {
    setSortAZ(az);
    void save("favoritesSortAZ", az);
  };

  const keepRecentQueries = (list: string[]) => {
    setRecentQueries(list);
    void save("recentSearches", list);
  };

  async function run(q: string) {
    if (!q) return;
    const id = ++latest;
    setLoading(true);
    setLastQuery(q);
    const sources = [searchUg, searchSongsterr] as const;
    const results = await Promise.allSettled(sources.map((s) => s(q, p.instrument)));
    if (id !== latest) return; // a newer search (or Cancel) owns the screen now
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
    setSearching(true);
    setQuery(q);
    input.blur(); // hide the keyboard to show the results
    keepRecentQueries([q, ...recentQueries().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX));
    void run(q);
  }

  function cancel() {
    latest++; // drop any search still running
    setSearching(false);
    setQuery("");
    setLastQuery("");
    setHits([]);
    setErrors([]);
    setLoading(false);
    input.blur();
  }

  createEffect(
    on(
      () => p.back,
      () => (searching() ? cancel() : root.closest(".view")?.scrollTo({ top: 0, behavior: "smooth" })),
      { defer: true },
    ),
  );

  // Results are filtered per instrument: switching instrument in the tuner refreshes them.
  createEffect(on(() => p.instrument, () => run(lastQuery()), { defer: true }));

  const saved = (h: SearchHit) => isFavorite(favoriteId(h));

  /** One card per song: best-rated UG songs first, then Songsterr-only songs; a version you saved leads its card. */
  const groups = createMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits()) map.set(songKey(h), [...(map.get(songKey(h)) ?? []), h]);
    return [...map.values()].map((g) => {
      const shown = [...g.filter((h) => h.source === "ug").slice(0, PER_SONG), ...g.filter((h) => h.source !== "ug")];
      const yours = g.filter((h) => saved(h) && !shown.includes(h)); // kept even if beyond the first 5
      return [...g.filter((h) => saved(h) && shown.includes(h)), ...yours, ...shown.filter((h) => !saved(h))];
    });
  });

  /** "Chords · Capo 2 · DADGAD": what to prepare before opening a tab. Standard tunings are not worth a mention. */
  const details = (e: { hit: SearchHit; info?: string[]; tuning?: string }) => {
    const capo = e.info?.find((i) => i.startsWith("Capo"));
    const tuning = e.tuning ? findTuning(e.tuning, p.tunings) : undefined;
    const tuningText = !e.tuning || tuning?.id.endsWith("-standard") ? "" : (tuning?.name ?? e.tuning);
    return [e.hit.artist, e.hit.label, capo, tuningText].filter(Boolean).join(" · ");
  };
  const recentOnly = () => recentTabs().filter((r) => !isFavorite(r.id));
  const sortedFavorites = () =>
    sortAZ() ? [...favorites()].sort((a, b) => a.hit.title.localeCompare(b.hit.title)) : favorites();
  /** Live, offline matches from your own songs while typing: your version comes before anything online. */
  const libraryMatches = createMemo(() => searchLibrary(query(), [...favorites(), ...recentOnly()]));

  return (
    <div class="search" ref={root}>
      <header class="search-head">
        <h1>Songs</h1>
        <div class="search-bar">
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
              placeholder="Find a song or an artist"
              value={query()}
              onFocus={() => setSearching(true)}
              onInput={(e) => setQuery(e.currentTarget.value)}
              enterkeyhint="search"
              autocapitalize="off"
              autocorrect="off"
              aria-label="Search tabs"
            />
            <span class="spinner" aria-hidden="true" />
          </form>
          <Show when={searching()}>
            <button class="text-btn cancel" type="button" onClick={cancel}>
              Cancel
            </button>
          </Show>
        </div>
      </header>

      <Show
        when={searching()}
        fallback={
          <>
            <Show when={favorites().length}>
              <section class="block">
                <h2>
                  <Icon name="star" size={16} filled /> Favorites
                  <Show when={favorites().length > 3}>
                    <span class="sort" role="group" aria-label="Sort favorites">
                      <button classList={{ on: !sortAZ() }} onClick={() => toggleSort(false)} aria-pressed={!sortAZ()}>
                        Recent
                      </button>
                      <button classList={{ on: sortAZ() }} onClick={() => toggleSort(true)} aria-pressed={sortAZ()}>
                        A–Z
                      </button>
                    </span>
                  </Show>
                </h2>
                <div class="card">
                  <For each={sortedFavorites()}>
                    {(f) => (
                      <button class="row" onClick={() => p.onOpen(f.hit)}>
                        <SourceBadge source={f.hit.source} />
                        <span class="row-main">
                          <span class="row-title">{f.hit.title}</span>
                          <span class="row-sub">{details(f)}</span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={recentOnly().length}>
              <section class="block">
                <h2>
                  <Icon name="clock" size={16} /> Recently opened
                  <button class="text-btn" onClick={() => void clearRecentTabs()}>
                    Clear
                  </button>
                </h2>
                <div class="card">
                  <For each={recentOnly()}>
                    {(r) => (
                      <button class="row" onClick={() => p.onOpen(r.hit)}>
                        <SourceBadge source={r.hit.source} />
                        <span class="row-main">
                          <span class="row-title">{r.hit.title}</span>
                          <span class="row-sub">{details(r)}</span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={!favorites().length && !recentOnly().length}>
              <div class="empty">
                <Icon name="songs" size={36} />
                <p>Your songs will live here. Find a tab, then tap the star to keep it, even offline.</p>
                <button class="primary" onClick={() => input.focus()}>
                  Find a song
                </button>
              </div>
            </Show>
          </>
        }
      >
        <Show when={libraryMatches().length}>
          <section class="block">
            <h2>In your library</h2>
            <div class="card">
              <For each={libraryMatches()}>
                {(e) => (
                  <button class="row" onClick={() => p.onOpen(e.hit)}>
                    <span class="row-icon" classList={{ saved: isFavorite(e.id) }}>
                      <Icon name={isFavorite(e.id) ? "star" : "clock"} size={16} filled={isFavorite(e.id)} />
                    </span>
                    <span class="row-main">
                      <span class="row-title">{e.hit.title}</span>
                      <span class="row-sub">{details(e)}</span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <p class="search-scope">Free {p.instrument} tabs from Ultimate Guitar and Songsterr</p>
        <For each={errors()}>{(e) => <p class="notice">{e}</p>}</For>
        <Show when={query() && !loading() && lastQuery() === query() && !hits().length && !errors().length}>
          <p class="notice">No free tabs found for “{lastQuery()}”.</p>
        </Show>

        <Show when={!query() && !hits().length && !loading() && recentQueries().length}>
          <section class="block">
            <h2>
              <Icon name="clock" size={16} /> Recent searches
              <button class="text-btn" onClick={() => keepRecentQueries([])}>
                Clear
              </button>
            </h2>
            <div class="chips">
              <For each={recentQueries()}>
                {(r) => (
                  <button class="chip" onClick={() => search(r)}>
                    {r}
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

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
                      {/* A word, not a second star: next to the rating star it read as a glitch. */}
                      <Show when={saved(h)}>
                        <span class="saved-tag">Saved</span>
                      </Show>
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
