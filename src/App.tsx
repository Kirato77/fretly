import { createEffect, createSignal, onMount, Show } from "solid-js";
import { load, save } from "./storage";
import { loadFavorites } from "./tabs/favorites";
import { Search } from "./tabs/Search";
import { TabView } from "./tabs/TabView";
import type { SearchHit } from "./tabs/types";
import { Tuner } from "./tuner/Tuner";
import { DEFAULT_TUNING, PRESETS, type Tuning } from "./tuner/tunings";

export function App() {
  const [view, setView] = createSignal<"tuner" | "tabs">("tuner");
  const [customs, setCustoms] = createSignal<Tuning[]>([]);
  const [tuningId, setTuningId] = createSignal(DEFAULT_TUNING.id);
  const [a4, setA4] = createSignal(440);
  const [openHit, setOpenHit] = createSignal<SearchHit | null>(null);
  const [loaded, setLoaded] = createSignal(false);

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
    setTuningId(PRESETS.find((t) => t.instrument === instrument)!.id);
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
          {/* Search stays mounted under the tab so results survive going back. */}
          <div hidden={!!openHit()}>
            <Search instrument={tuning().instrument} onOpen={setOpenHit} />
          </div>
          <Show when={openHit()}>{(hit) => <TabView hit={hit()} onBack={() => setOpenHit(null)} />}</Show>
        </section>
      </main>
      <nav class="tabbar">
        <button classList={{ on: view() === "tuner" }} onClick={() => setView("tuner")}>
          Tuner
        </button>
        <button classList={{ on: view() === "tabs" }} onClick={() => setView("tabs")}>
          Tabs
        </button>
      </nav>
    </div>
  );
}
