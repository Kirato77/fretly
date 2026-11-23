import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { Tuning } from "../tuner/tunings";
import { ChordView } from "./ChordView";
import { parseChord } from "./theory";

/** Bottom sheet with a chord's shapes, opened by tapping a chord name in a tab. */
export function ChordSheet(p: { name: string; tuning: Tuning; a4: number; onClose(): void }) {
  return (
    <Portal>
      <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="sheet auto" role="dialog" aria-modal="true" aria-label={`Chord ${p.name}`}>
          <div class="sheet-grip" />
          <Show when={parseChord(p.name)}>{(chord) => <ChordView chord={chord()} tuning={p.tuning} a4={p.a4} />}</Show>
        </div>
      </div>
    </Portal>
  );
}
