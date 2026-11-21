import { createEffect, createResource, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { transposeLine } from "./chords";
import { addFavorite, favoriteId, findFavorite, loadFavoriteTab, removeFavorite, setFavoriteSemis } from "./favorites";
import { fetchSongsterrTab, trackToLines } from "./songsterr";
import { SOURCE_NAMES, type SearchHit } from "./types";
import { fetchUgTab } from "./ug";

const CHAR_RATIO = 0.6; // monospace glyph width / font size

export function TabView(p: { hit: SearchHit; onBack(): void }) {
  const id = favoriteId(p.hit);
  // A favorite opens from its saved copy (offline, and even if the site removed it).
  const [doc] = createResource(
    () => p.hit,
    async (h) => (await loadFavoriteTab(id)) ?? (h.source === "ug" ? fetchUgTab(h.ref) : fetchSongsterrTab(h.ref)),
  );
  const [semis, setSemis] = createSignal(findFavorite(p.hit)?.semis ?? 0);
  const isFavorite = () => !!findFavorite(p.hit);
  createEffect(() => setFavoriteSemis(id, semis()));

  const toggleFavorite = () => {
    const d = doc();
    if (isFavorite()) void removeFavorite(id);
    else if (d) void addFavorite(p.hit, d, semis());
  };
  const [size, setSize] = createSignal(14);
  const [speed, setSpeed] = createSignal(0); // px/s, 0 = autoscroll off
  const [width, setWidth] = createSignal(360);
  let body!: HTMLDivElement;

  const cols = () => Math.max(30, Math.floor(width() / (size() * CHAR_RATIO)));
  const lines = () => {
    const d = doc();
    if (!d) return [];
    return (d.track ? trackToLines(d.track, cols()) : (d.lines ?? [])).map((l) => transposeLine(l, semis()));
  };

  onMount(() => {
    const ro = new ResizeObserver(() => setWidth(body.clientWidth - 24));
    ro.observe(body);
    onCleanup(() => ro.disconnect());
  });

  // Auto-scroll: the frame loop only runs while a speed is set, and restarts when it changes.
  createEffect(() => {
    const pxPerSec = speed();
    if (!pxPerSec) return;
    let raf = 0;
    let last = 0;
    let pos = body.scrollTop; // scrollTop is rounded to pixels: keep the fraction here
    const tick = (t: number) => {
      if (last) {
        if (Math.abs(pos - body.scrollTop) > 2) pos = body.scrollTop; // user dragged
        pos += (pxPerSec * (t - last)) / 1000;
        body.scrollTop = pos;
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <div class="tabview">
      <header>
        <button class="ghost" onClick={p.onBack}>
          ‹ Back
        </button>
        <div class="title">
          <strong>{p.hit.title}</strong>
          <span class="muted">
            {p.hit.artist} · <Show when={!doc.error && doc()?.kind}>{(kind) => `${kind()} · `}</Show>
            {SOURCE_NAMES[p.hit.source]}
          </span>
        </div>
        <button
          class="ghost star"
          classList={{ on: isFavorite() }}
          disabled={!isFavorite() && (doc.loading || !!doc.error)}
          onClick={toggleFavorite}
          aria-pressed={isFavorite()}
          aria-label={isFavorite() ? "Remove from favorites" : "Add to favorites"}
        >
          {isFavorite() ? "★" : "☆"}
        </button>
      </header>

      <div class="tools">
        <Show when={!doc.error && doc()?.transposable}>
          <span class="group">
            <button class="ghost" onClick={() => setSemis(semis() - 1)} aria-label="Transpose down">
              ♭
            </button>
            <span>{semis() > 0 ? `+${semis()}` : semis()}</span>
            <button class="ghost" onClick={() => setSemis(semis() + 1)} aria-label="Transpose up">
              ♯
            </button>
          </span>
        </Show>
        <span class="group">
          <button class="ghost" onClick={() => setSize(Math.max(9, size() - 1))} aria-label="Smaller text">
            A−
          </button>
          <button class="ghost" onClick={() => setSize(Math.min(24, size() + 1))} aria-label="Larger text">
            A+
          </button>
        </span>
        <span class="group">
          <button class="ghost" onClick={() => setSpeed(Math.max(0, speed() - 10))} aria-label="Scroll slower">
            −
          </button>
          <button classList={{ ghost: true, on: speed() > 0 }} onClick={() => setSpeed(speed() ? 0 : 30)}>
            {speed() ? `Scroll ${speed()}` : "Scroll"}
          </button>
          <button class="ghost" onClick={() => setSpeed(Math.min(200, speed() + 10))} aria-label="Scroll faster">
            +
          </button>
        </span>
      </div>

      <div class="tab-body" ref={body}>
        <Show when={!doc.loading} fallback={<p class="muted">Loading…</p>}>
          <Show when={!doc.error} fallback={<p class="error">Could not load this tab ({String(doc.error)}).</p>}>
            <Show when={doc()?.info.length}>
              <p class="info">{doc()!.info.join(" · ")}</p>
            </Show>
            <pre style={{ "font-size": `${size()}px` }}>
              <Index each={lines()}>
                {(line) => (
                  <div>
                    {/* split() with a capture group alternates text / chord name */}
                    <For each={line().split(/\[ch\](.*?)\[\/ch\]/)}>
                      {(part, i) => (i() % 2 ? <span class="chord">{part}</span> : part)}
                    </For>
                  </div>
                )}
              </Index>
            </pre>
          </Show>
        </Show>
      </div>
    </div>
  );
}
