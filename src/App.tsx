import { createEffect, createSignal, onMount, Show } from "solid-js";
import { keepAwake } from "./awake";
import { load, save } from "./storage";
import { loadFavorites } from "./tabs/favorites";
import { Songs } from "./tabs/Songs";
import { Tools } from "./tools/Tools";
import { Transcribe } from "./transcribe/Transcribe";
import { TabView } from "./tabs/TabView";
import type { SearchHit } from "./tabs/types";
import { Tuner } from "./tuner/Tuner";
import { DEFAULT_TUNING, PRESETS, type Tuning } from "./tuner/tunings";
import { Icon } from "./ui/Icon";
import { applyUpdate, updateReady } from "./updater";

export function App() {
  const [view, setView] = createSignal<"tuner" | "tabs" | "tools" | "transcribe">("tuner");
  const [customs, setCustoms] = createSignal<Tuning[]>([]);
  const [tuningId, setTuningId] = createSignal(DEFAULT_TUNING.id);
  const [a4, setA4] = createSignal(440);
  const [openHit, setOpenHit] = createSignal<SearchHit | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [toastHidden, setToastHidden] = createSignal(false);
  const [songsBack, setSongsBack] = createSignal(0);

  const tunings = () => [...PRESETS, ...customs()];
  const tuning = () => tunings().find((t) => t.id === tuningId()) ?? DEFAULT_TUNING;

  onMount(async () => {
    setCustoms(await load("customTunings", []));
    setTuningId(await load("tuningId", DEFAULT_TUNING.id));
    setA4(await load("a4", 440));
    await loadFavorites();
    setLoaded(true);
  });

  createEffect(() => {
    if (!loaded()) return;
    void save("customTunings", customs());
    void save("tuningId", tuningId());
    void save("a4", a4());
  });

  // Reading a tab while playing: the screen must not lock under your hands.
  createEffect(() => keepAwake("tab", view() === "tabs" && !!openHit()));

  const saveCustom = (t: Tuning) => {
    setCustoms((list) => [...list.filter((c) => c.id !== t.id), t]);
    setTuningId(t.id);
  };

  const deleteCustom = (id: string) => {
    const instrument = tuning().instrument;
    setCustoms((list) => list.filter((c) => c.id !== id));
    // Only deleting the active tuning moves you elsewhere; any other custom tuning just disappears.
    if (id === tuningId()) setTuningId(PRESETS.find((t) => t.instrument === instrument)!.id);
  };

  return (
    <div class="app">
      <main>
        <section class="view" hidden={view() !== "tuner"}>
          <Tuner
            tuning={tuning()}
            tunings={tunings()}
            a4={a4()}
            active={view() === "tuner"}
            onTuning={setTuningId}
            onA4={setA4}
            onSaveCustom={saveCustom}
            onDeleteCustom={deleteCustom}
          />
        </section>
        <section class="view" hidden={view() !== "tabs"}>
          {/* The list stays mounted under an open tab so search results survive going back. */}
          <div hidden={!!openHit()}>
            <Songs instrument={tuning().instrument} tunings={tunings()} onOpen={setOpenHit} back={songsBack()} />
          </div>
          <Show when={openHit()}>
            {(hit) => (
              <TabView
                hit={hit()}
                tunings={tunings()}
                current={tuning()}
                a4={a4()}
                onTune={(id) => {
                  setTuningId(id);
                  setView("tuner"); // the tab stays open: the Songs tab brings you back to it
                }}
                onBack={() => setOpenHit(null)}
              />
            )}
          </Show>
        </section>
        <section class="view" hidden={view() !== "tools"}>
          <Tools tuning={tuning()} a4={a4()} active={view() === "tools"} />
        </section>
        <section class="view" hidden={view() !== "transcribe"}>
          <Transcribe tuning={tuning()} a4={a4()} active={view() === "transcribe"} />
        </section>
      </main>
      {/* "Later" keeps the controls underneath usable; the update still applies when the app is next left. */}
      <Show when={updateReady() && !toastHidden()}>
        <div class="update-toast" role="status">
          <span>New version ready</span>
          <button class="later" onClick={() => setToastHidden(true)}>
            Later
          </button>
          {/* Swaps the bundle and reloads in place: the app is not relaunched. */}
          <button onClick={applyUpdate}>Refresh</button>
        </div>
      </Show>
      <nav class="tabbar">
        <button classList={{ on: view() === "tuner" }} onClick={() => setView("tuner")} aria-current={view() === "tuner" ? "page" : undefined}>
          <Icon name="tuner" />
          <span>Tuner</span>
        </button>
        {/* Tapping Songs while there acts as Back: open tab → search results → library (then scrolls to the top). */}
        <button
          classList={{ on: view() === "tabs" }}
          onClick={() => {
            if (view() !== "tabs") setView("tabs");
            else if (openHit()) setOpenHit(null);
            else setSongsBack(songsBack() + 1);
          }}
          aria-current={view() === "tabs" ? "page" : undefined}
        >
          <Icon name="songs" />
          <span>Songs</span>
        </button>
        <button classList={{ on: view() === "tools" }} onClick={() => setView("tools")} aria-current={view() === "tools" ? "page" : undefined}>
          <Icon name="tools" />
          <span>Tools</span>
        </button>
        <button classList={{ on: view() === "transcribe" }} onClick={() => setView("transcribe")} aria-current={view() === "transcribe" ? "page" : undefined}>
          <Icon name="wave" />
          <span>Transcribe</span>
        </button>
      </nav>
    </div>
  );
}
