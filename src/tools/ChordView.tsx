import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { pitchClass } from "../tuner/notes";
import { playNotes } from "../tuner/tone";
import { PRESETS, type Tuning } from "../tuner/tunings";
import { Icon } from "../ui/Icon";
import { ChordDiagram } from "./ChordDiagram";
import { chordName, chordNotes, findVoicings, type Chord } from "./theory";

/** Bass tunings get guitar shapes: chord boxes are a guitar and ukulele thing. */
export const chordTuning = (t: Tuning) => (t.instrument === "bass" ? PRESETS[0] : t);

/** A chord: name, notes, a strum to hear it, and its shapes for the tuning, swiped one by one. */
export function ChordView(p: { chord: Chord; tuning: Tuning; a4: number }) {
  const tuning = () => chordTuning(p.tuning);
  const voicings = createMemo(() => findVoicings(tuning().notes, p.chord));
  const [index, setIndex] = createSignal(0);
  let track!: HTMLDivElement;

  createEffect(on(voicings, () => {
    setIndex(0);
    track?.scrollTo({ left: 0 });
  }));

  const strum = () => {
    const v = voicings()[index()];
    if (v) playNotes(v.flatMap((f, i) => (f < 0 ? [] : [tuning().notes[i] + f])), p.a4, 0.045);
  };

  return (
    <div class="chord-view">
      <div class="chord-head">
        <div>
          <div class="chord-title">{chordName(p.chord)}</div>
          <div class="chord-notes">{chordNotes(p.chord).join(" · ")}</div>
        </div>
        <Show when={voicings().length}>
          <button class="hear-btn small" onClick={strum} aria-label={`Hear ${chordName(p.chord)}`}>
            <Icon name="play" size={18} filled />
          </button>
        </Show>
      </div>

      <Show when={voicings().length} fallback={<p class="notice">No playable shape for this chord in {tuning().name}.</p>}>
        <div class="shapes" ref={track} onScroll={() => setIndex(Math.round(track.scrollLeft / track.clientWidth))}>
          <For each={voicings()}>
            {(v) => (
              <div class="shape">
                <ChordDiagram voicing={v} tuning={tuning().notes} />
              </div>
            )}
          </For>
        </div>
        <div class="shape-dots" aria-label={`Shape ${index() + 1} of ${voicings().length}`}>
          <For each={voicings()}>
            {(_, i) => (
              <button
                classList={{ on: i() === index() }}
                onClick={() => track.scrollTo({ left: i() * track.clientWidth, behavior: "smooth" })}
                aria-label={`Shape ${i() + 1}`}
              />
            )}
          </For>
        </div>
      </Show>
      <p class="chord-for">
        {p.tuning.instrument === "bass" ? "Guitar shapes (bass selected)" : `Shapes for ${tuning().name}`} ·{" "}
        {tuning().notes.map(pitchClass).join(" ")}
      </p>
    </div>
  );
}
