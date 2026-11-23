import { createSignal, For, Show } from "solid-js";
import { load, save } from "../storage";
import type { Tuning } from "../tuner/tunings";
import { ChordView } from "./ChordView";
import { Metronome } from "./Metronome";
import { revealSelected, Scales } from "./Scales";
import { CHORD_TYPES, ROOTS } from "./theory";

type Tool = "chords" | "scales" | "metronome";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "chords", label: "Chords" },
  { id: "scales", label: "Scales" },
  { id: "metronome", label: "Metronome" },
];

/** The guitarist's toolbox: chord dictionary, scales on the neck, metronome. */
export function Tools(p: { tuning: Tuning; a4: number; active: boolean }) {
  const [tool, setTool] = createSignal<Tool>("chords");
  const [root, setRoot] = createSignal(0);
  const [typeId, setTypeId] = createSignal("maj");
  let page!: HTMLDivElement;
  void load("tools", { tool: "chords" as Tool, root: 0, typeId: "maj" }).then((s) => {
    setTool(s.tool);
    setRoot(s.root);
    setTypeId(s.typeId);
    revealSelected(page);
  });
  const remember = () => void save("tools", { tool: tool(), root: root(), typeId: typeId() });
  const type = () => CHORD_TYPES.find((t) => t.id === typeId()) ?? CHORD_TYPES[0];

  return (
    <div class="tools-page" ref={page}>
      <header class="search-head">
        <h1>Tools</h1>
        <div class="segmented">
          <For each={TOOLS}>
            {(t) => (
              <button classList={{ on: tool() === t.id }} onClick={() => (setTool(t.id), remember(), revealSelected(page))}>
                {t.label}
              </button>
            )}
          </For>
        </div>
      </header>

      <Show when={tool() === "chords"}>
        <div class="tool-body">
          <div class="chip-row" role="group" aria-label="Root">
            <For each={ROOTS}>
              {(n, i) => (
                <button class="chip" classList={{ on: i() === root() }} onClick={() => (setRoot(i()), remember())}>
                  {n}
                </button>
              )}
            </For>
          </div>
          <div class="chip-row" role="group" aria-label="Chord type">
            <For each={CHORD_TYPES}>
              {(t) => (
                <button class="chip" classList={{ on: t.id === typeId() }} onClick={() => (setTypeId(t.id), remember())}>
                  {t.label}
                </button>
              )}
            </For>
          </div>
          <ChordView chord={{ root: root(), type: type() }} tuning={p.tuning} a4={p.a4} />
        </div>
      </Show>
      <Show when={tool() === "scales"}>
        <Scales tuning={p.tuning} a4={p.a4} />
      </Show>
      {/* Kept mounted (hidden) so a running metronome is not cut by a glance at a chord. */}
      <div hidden={tool() !== "metronome"}>
        <Metronome active={p.active} />
      </div>
    </div>
  );
}
