import { createSignal, For, Index, Show } from "solid-js";
import { load, save } from "../storage";
import { pitchClass } from "../tuner/notes";
import { playNotes } from "../tuner/tone";
import type { Tuning } from "../tuner/tunings";
import { Icon } from "../ui/Icon";
import { degreeOf, intervalName, ROOTS, SCALES } from "./theory";

/** Scrolls each chip row so its selected chip is visible (a remembered "A" or "Minor pentatonic" sits off-screen). */
export const revealSelected = (el: HTMLElement) =>
  requestAnimationFrame(() =>
    el.querySelectorAll(".chip-row .chip.on").forEach((c) => c.scrollIntoView({ inline: "center", block: "nearest" })),
  );

const FRETS = 15;
const MARKERS = new Set([3, 5, 7, 9, 12, 15]);

/** A scale on a vertical neck (lowest string on the left, open strings on top), in the tuner's tuning. */
export function Scales(p: { tuning: Tuning; a4: number }) {
  const [root, setRoot] = createSignal(9); // A
  const [scaleId, setScaleId] = createSignal("penta-minor");
  const [intervals, setIntervals] = createSignal(false);
  let body!: HTMLDivElement;
  void load("scale", { root: 9, scaleId: "penta-minor" }).then((s) => {
    setRoot(s.root);
    setScaleId(s.scaleId);
    revealSelected(body);
  });
  const remember = () => void save("scale", { root: root(), scaleId: scaleId() });

  const scale = () => SCALES.find((s) => s.id === scaleId()) ?? SCALES[0];
  const lowest = () => Math.min(...p.tuning.notes);
  /** One octave up from the lowest root the instrument can play. */
  const walk = () => {
    const start = lowest() + ((root() - lowest()) % 12 + 12) % 12;
    return [...scale().intervals.map((i) => start + i), start + 12];
  };

  return (
    <div class="tool-body" ref={body}>
      <div class="chip-row" role="group" aria-label="Root">
        <For each={ROOTS}>
          {(n, i) => (
            <button class="chip" classList={{ on: i() === root() }} onClick={() => (setRoot(i()), remember())}>
              {n}
            </button>
          )}
        </For>
      </div>
      <div class="chip-row" role="group" aria-label="Scale">
        <For each={SCALES}>
          {(s) => (
            <button class="chip" classList={{ on: s.id === scaleId() }} onClick={() => (setScaleId(s.id), remember())}>
              {s.label}
            </button>
          )}
        </For>
      </div>

      <div class="chord-head">
        <div>
          <div class="chord-title">
            {ROOTS[root()]} {scale().label.toLowerCase()}
          </div>
          <div class="chord-notes">
            {scale()
              .intervals.map((i) => (intervals() ? intervalName(i) : ROOTS[(root() + i) % 12]))
              .join(" · ")}
          </div>
        </div>
        <button class="hear-btn small" onClick={() => playNotes(walk(), p.a4, 0.32)} aria-label="Hear the scale">
          <Icon name="play" size={18} filled />
        </button>
      </div>

      <div class="segmented small" role="group" aria-label="Show">
        <button classList={{ on: !intervals() }} onClick={() => setIntervals(false)}>
          Notes
        </button>
        <button classList={{ on: intervals() }} onClick={() => setIntervals(true)}>
          Intervals
        </button>
      </div>

      <div class="neck" style={{ "--strings": p.tuning.notes.length }}>
        <span />
        <Index each={p.tuning.notes}>{(n) => <span class="neck-name">{pitchClass(n())}</span>}</Index>
        <For each={Array.from({ length: FRETS + 1 }, (_, f) => f)}>
          {(f) => (
            <>
              <span class="neck-fret" classList={{ marker: MARKERS.has(f) }}>
                {f || ""}
              </span>
              <Index each={p.tuning.notes}>
                {(n) => {
                  const d = () => degreeOf((n() + f) % 12, root(), scale());
                  return (
                    <span class="neck-cell" classList={{ open: f === 0 }}>
                      <Show when={d() >= 0}>
                        <span class="neck-dot" classList={{ root: d() === 0 }}>
                          {intervals() ? intervalName(d()) : pitchClass(n() + f)}
                        </span>
                      </Show>
                    </span>
                  );
                }}
              </Index>
            </>
          )}
        </For>
      </div>
      <p class="chord-for">
        {p.tuning.name} · {p.tuning.notes.map(pitchClass).join(" ")}
      </p>
    </div>
  );
}
