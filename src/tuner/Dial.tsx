import { For, type JSX } from "solid-js";

// Semicircle meter: ±50 cents mapped to -90°…+90° (0° = top). A dot rides the arc and a trail
// grows from the centre, so the reading is a position and a colour, readable from a distance.
const CX = 150;
const CY = 158;
const R = 128;
const RANGE = 50;

const point = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)] as const;
};
const angle = (cents: number) => (Math.max(-RANGE, Math.min(RANGE, cents)) / RANGE) * 90;
const arc = (from: number, to: number) => {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1} ${y1}A${R} ${R} 0 0 ${to > from ? 1 : 0} ${x2} ${y2}`;
};

const TICKS = Array.from({ length: 21 }, (_, i) => i * 5 - RANGE);

export function Dial(p: { cents: number | null; inTune: number; children: JSX.Element }) {
  return (
    <div class="dial">
      <svg viewBox="0 0 300 172" aria-hidden="true">
        <path class="dial-track" d={arc(-90, 90)} />
        <path class="dial-zone" d={arc(angle(-p.inTune), angle(p.inTune))} />
        <For each={TICKS}>
          {(c) => {
            const major = c % 25 === 0;
            const [x1, y1] = point(angle(c), R + 10);
            const [x2, y2] = point(angle(c), R + (major ? 22 : 16));
            return <line class={major ? "dial-tick major" : "dial-tick"} x1={x1} y1={y1} x2={x2} y2={y2} />;
          }}
        </For>
        <text class="dial-label" x={point(-90, R)[0] + 4} y={CY + 14} text-anchor="middle">
          −50
        </text>
        <text class="dial-label" x={point(90, R)[0] - 4} y={CY + 14} text-anchor="middle">
          +50
        </text>
        {p.cents !== null && (
          <>
            <path class="dial-trail" d={arc(0, angle(p.cents!) || 0.01)} />
            <circle class="dial-dot" cx={point(angle(p.cents!))[0]} cy={point(angle(p.cents!))[1]} r="9" />
          </>
        )}
      </svg>
      <div class="dial-center">{p.children}</div>
    </div>
  );
}
