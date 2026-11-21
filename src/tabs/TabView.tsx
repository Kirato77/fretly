import { createEffect, createResource, createSignal, For, Index, on, onCleanup, onMount, Show } from "solid-js";
import { load, save } from "../storage";
import { findTuning, INSTRUMENTS, type Tuning } from "../tuner/tunings";
import { Icon } from "../ui/Icon";
import { transposeLine, wrapSheet } from "./chords";
import { addFavorite, favoriteId, findFavorite, loadFavoriteTab, noteOpened, removeFavorite, setFavoriteSemis } from "./favorites";
import { SourceBadge } from "./Songs";
import { fetchSongsterrTab, trackToLines } from "./songsterr";
import type { SearchHit } from "./types";
import { fetchUgTab } from "./ug";

const CHAR_RATIO = 0.6; // monospace glyph width / font size
const SPEEDS = [10, 15, 20, 30, 40, 55, 75, 100]; // auto-scroll, px/s

interface Props {
  hit: SearchHit;
  /** Tunings the tuner knows, and the one it is on: to offer "Tune to DADGAD" when the tab needs it. */
  tunings: Tuning[];
  current: Tuning;
  onTune(id: string): void;
  onBack(): void;
}

export function TabView(p: Props) {
  const id = favoriteId(p.hit);
  // A favorite opens from its saved copy (offline, and even if the site removed it).
  const [doc] = createResource(
    () => p.hit,
    async (h) => (await loadFavoriteTab(id)) ?? (h.source === "ug" ? fetchUgTab(h.ref) : fetchSongsterrTab(h.ref)),
  );
  const [semis, setSemis] = createSignal(findFavorite(p.hit)?.semis ?? 0);
  const isFavorite = () => !!findFavorite(p.hit);
  createEffect(() => setFavoriteSemis(id, semis()));
  // Reading a resource in error throws in Solid: check the error first.
  createEffect(on(() => (doc.error ? undefined : doc()), (d) => d && noteOpened(p.hit, d)));

  /** The tuner tuning this tab is written for, when the tuner is not already on it. */
  const tuneTo = () => {
    const t = !doc.error && doc()?.tuning ? findTuning(doc()!.tuning!, p.tunings) : undefined;
    return t && t.id !== p.current.id ? t : undefined;
  };

  const toggleFavorite = () => {
    const d = doc();
    if (isFavorite()) void removeFavorite(id);
    else if (d) void addFavorite(p.hit, d, semis());
  };

  const [size, setSize] = createSignal(14);
  const [playing, setPlaying] = createSignal(false);
  const [speedIdx, setSpeedIdx] = createSignal(3);
  const [width, setWidth] = createSignal(360);
  let body!: HTMLDivElement;

  // Text size and scroll speed are personal: remembered across tabs.
  onMount(async () => {
    setSize(await load("tabFontSize", 14));
    setSpeedIdx(await load("tabSpeed", 3));
  });
  const changeSize = (d: number) => {
    setSize(Math.min(24, Math.max(9, size() + d)));
    void save("tabFontSize", size());
  };
  const changeSpeed = (d: number) => {
    setSpeedIdx(Math.min(SPEEDS.length - 1, Math.max(0, speedIdx() + d)));
    void save("tabSpeed", speedIdx());
  };

  // Floor only guards the first frame before the width is measured: 20 still fits 24 px text on a phone.
  const cols = () => Math.max(20, Math.floor(width() / (size() * CHAR_RATIO)));
  const lines = () => {
    const d = doc();
    if (!d) return [];
    if (d.track) return trackToLines(d.track, cols());
    // Transpose first (chord names change length), then fit the sheet to the screen width.
    return wrapSheet((d.lines ?? []).map((l) => transposeLine(l, semis())), cols());
  };

  onMount(() => {
    const ro = new ResizeObserver(() => setWidth(body.clientWidth - 32));
    ro.observe(body);
    onCleanup(() => ro.disconnect());
  });

  // Auto-scroll: the frame loop only runs while playing, and restarts when the speed changes.
  createEffect(() => {
    if (!playing()) return;
    const pxPerSec = SPEEDS[speedIdx()];
    let raf = 0;
    let last = 0;
    let pos = body.scrollTop; // scrollTop is rounded to pixels: keep the fraction here
    const tick = (t: number) => {
      if (last) {
        if (Math.abs(pos - body.scrollTop) > 2) pos = body.scrollTop; // user dragged
        pos += (pxPerSec * (t - last)) / 1000;
        body.scrollTop = pos;
        if (body.scrollTop + body.clientHeight >= body.scrollHeight - 1) setPlaying(false); // reached the end
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <div class="tabview">
      <header class="tab-head">
        <button class="icon-btn" onClick={p.onBack} aria-label="Back to search">
          <Icon name="back" />
        </button>
        <div class="tab-title">
          <strong>{p.hit.title}</strong>
          <span>
            {p.hit.artist} · {p.hit.label}
          </span>
        </div>
        <SourceBadge source={p.hit.source} />
        <button
          class="icon-btn star"
          classList={{ on: isFavorite() }}
          disabled={!isFavorite() && (doc.loading || !!doc.error)}
          onClick={toggleFavorite}
          aria-pressed={isFavorite()}
          aria-label={isFavorite() ? "Remove from favorites" : "Save to favorites"}
        >
          <Icon name="star" filled={isFavorite()} />
        </button>
      </header>

      <div class="tab-body" ref={body}>
        <Show when={!doc.loading} fallback={<div class="tab-loading">Loading the tab…</div>}>
          <Show when={!doc.error} fallback={<p class="notice">This tab could not be loaded. Check the connection and try again.</p>}>
            <Show when={doc()?.info.length || tuneTo()}>
              <div class="info-chips">
                <For each={doc()!.info}>{(i) => <span class="info-chip">{i}</span>}</For>
                <Show when={tuneTo()}>
                  {(t) => (
                    <button class="tune-chip" onClick={() => p.onTune(t().id)}>
                      <Icon name="tuner" size={15} />
                      Tune to {t().instrument === p.current.instrument ? "" : `${INSTRUMENTS.find((i) => i.id === t().instrument)!.label} · `}
                      {t().name}
                    </button>
                  )}
                </Show>
              </div>
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

      <div class="tab-toolbar">
        <Show when={!doc.error && doc()?.transposable}>
          <div class="tool" aria-label="Transpose">
            <button onClick={() => setSemis(semis() - 1)} aria-label="Transpose down">
              ♭
            </button>
            <span class="tool-value">{semis() > 0 ? `+${semis()}` : semis() || "Key"}</span>
            <button onClick={() => setSemis(semis() + 1)} aria-label="Transpose up">
              ♯
            </button>
          </div>
        </Show>
        <div class="tool" aria-label="Text size">
          <button onClick={() => changeSize(-1)} aria-label="Smaller text">
            <span class="aa small">A</span>
          </button>
          <button onClick={() => changeSize(1)} aria-label="Larger text">
            <span class="aa">A</span>
          </button>
        </div>
        <div class="tool scroll" classList={{ on: playing() }}>
          <Show when={playing()}>
            <button onClick={() => changeSpeed(-1)} aria-label="Scroll slower">
              <Icon name="minus" size={16} />
            </button>
          </Show>
          <button class="play" onClick={() => setPlaying(!playing())} aria-label={playing() ? "Stop auto-scroll" : "Start auto-scroll"}>
            <Icon name={playing() ? "pause" : "play"} size={18} filled={!playing()} />
            <Show when={playing()} fallback={<span>Scroll</span>}>
              <span>{speedIdx() + 1}</span>
            </Show>
          </button>
          <Show when={playing()}>
            <button onClick={() => changeSpeed(1)} aria-label="Scroll faster">
              <Icon name="plus" size={16} />
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
