import { createEffect, createSignal, onMount, Show } from "solid-js";
import { load, save } from "./storage";
import { loadFavorites } from "./tabs/favorites";
import { Songs } from "./tabs/Songs";
import { TabView } from "./tabs/TabView";
import type { SearchHit } from "./tabs/types";
import { Tuner } from "./tuner/Tuner";
import { DEFAULT_TUNING, PRESETS, type Tuning } from "./tuner/tunings";
import { Icon } from "./ui/Icon";
import { applyUpdate, updateReady } from "./updater";

export function App() {
  const [view, setView] = createSignal<"tuner" | "tabs">("tuner");
  const [customs, setCustoms] = createSignal<Tuning[]>([]);
  const [tuningId, setTuningId] = createSignal(DEFAULT_TUNING.id);
  const [a4, setA4] = createSignal(440);
  const [openHit, setOpenHit] = createSignal<SearchHit | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [toastHidden, setToastHidden] = createSignal(false);

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
            <Songs instrument={tuning().instrument} tunings={tunings()} onOpen={setOpenHit} />
          </div>
          <Show when={openHit()}>
            {(hit) => (
              <TabView
                hit={hit()}
                tunings={tunings()}
                current={tuning()}
                onTune={(id) => {
                  setTuningId(id);
                  setView("tuner"); // the tab stays open: the Songs tab brings you back to it
                }}
                onBack={() => setOpenHit(null)}
              />
            )}
          </Show>
        </section>
      </main>
      {/* "Later" keeps the controls underneath usable; the update still applies when the app is next left. */}
      <Show when={updateReady() && !toastHidden()}>
        <div class="update-toast" role="status">
          <span>New version ready</span>
          <button class="later" onClick={() => setToastHidden(true)}>
            Later
          </button>
          <button onClick={applyUpdate}>Restart</button>
        </div>
      </Show>
      <nav class="tabbar">
        <button classList={{ on: view() === "tuner" }} onClick={() => setView("tuner")} aria-current={view() === "tuner" ? "page" : undefined}>
          <Icon name="tuner" />
          <span>Tuner</span>
        </button>
        {/* Tapping Songs while already there goes back to the list (iOS convention). */}
        <button
          classList={{ on: view() === "tabs" }}
          onClick={() => (view() === "tabs" ? setOpenHit(null) : setView("tabs"))}
          aria-current={view() === "tabs" ? "page" : undefined}
        >
          <Icon name="songs" />
          <span>Songs</span>
        </button>
      </nav>
    </div>
  );
}
