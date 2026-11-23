import { For, Show } from "solid-js";
import { pitchClass } from "../tuner/notes";
import type { Voicing } from "./theory";

const SW = 26; // string spacing
const FH = 30; // fret height
const ROWS = 5;
const LEFT = 30;
const TOP = 26;

/** Chord box: strings vertical (lowest on the left), frets down, × muted, ○ open, barre drawn as a bar. */
export function ChordDiagram(p: { voicing: Voicing; tuning: number[] }) {
  const fretted = () => p.voicing.filter((f) => f > 0);
  const base = () => (Math.max(0, ...fretted()) <= ROWS ? 1 : Math.min(...fretted()));
  const width = () => LEFT + SW * (p.tuning.length - 1) + 16;
  const x = (i: number) => LEFT + i * SW;
  const y = (f: number) => TOP + (f - base() + 0.5) * FH;
  const barre = () => {
    const low = Math.min(...fretted());
    const at = p.voicing.flatMap((f, i) => (f === low ? [i] : []));
    const ok = at.length > 1 && !p.voicing.slice(at[0], at.at(-1)! + 1).includes(0);
    return ok ? { fret: low, from: at[0], to: at.at(-1)! } : null;
  };

  return (
    <svg class="chord-box" viewBox={`0 0 ${width()} ${TOP + ROWS * FH + 22}`} role="img" aria-label={p.voicing.map((f) => (f < 0 ? "x" : f)).join(" ")}>
      <Show when={base() === 1} fallback={<text class="cb-base" x={LEFT - 12} y={y(base()) + 4} text-anchor="end">{base()}fr</text>}>
        <line class="cb-nut" x1={x(0)} x2={x(p.tuning.length - 1)} y1={TOP} y2={TOP} />
      </Show>
      <For each={Array.from({ length: ROWS + 1 }, (_, r) => r)}>
        {(r) => <line class="cb-fret" x1={x(0)} x2={x(p.tuning.length - 1)} y1={TOP + r * FH} y2={TOP + r * FH} />}
      </For>
      <For each={p.tuning}>
        {(note, i) => (
          <>
            <line class="cb-string" x1={x(i())} x2={x(i())} y1={TOP} y2={TOP + ROWS * FH} />
            <text class="cb-name" x={x(i())} y={TOP + ROWS * FH + 16} text-anchor="middle">
              {pitchClass(note)}
            </text>
          </>
        )}
      </For>
      <Show when={barre()}>
        {(b) => <rect class="cb-dot" x={x(b().from) - 9} y={y(b().fret) - 9} width={x(b().to) - x(b().from) + 18} height={18} rx={9} />}
      </Show>
      <For each={p.voicing}>
        {(f, i) => (
          <Show
            when={f > 0}
            fallback={
              <text class="cb-mark" x={x(i())} y={TOP - 9} text-anchor="middle">
                {f < 0 ? "×" : "○"}
              </text>
            }
          >
            <circle class="cb-dot" cx={x(i())} cy={y(f)} r={9} />
          </Show>
        )}
      </For>
    </svg>
  );
}
