import type { JSX } from "solid-js";

// Small stroke icon set (24×24, currentColor), drawn for Fretly.
const PATHS = {
  tuner: "M9 3v6a3 3 0 0 0 6 0V3M12 12v9M8 21h8",
  songs: "M9 18V6l11-2.5v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 15.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 9.5l11-2.5",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14ZM20 20l-4-4",
  back: "M15 5l-7 7 7 7",
  chevronDown: "M6 9l6 6 6-6",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z",
  play: "M8 5.5v13l10.5-6.5Z",
  pause: "M8 5v14M16 5v14",
  minus: "M6 12h12",
  plus: "M12 6v12M6 12h12",
  check: "M5 12.5l4.5 4.5L19 7.5",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM6 11.5a6 6 0 0 0 12 0M12 17.5V21",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6Z",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18ZM12 7v5l3 2",
  tools: "M6 3.5h12M7 3.5v17M12 3.5v17M17 3.5v17M5 9h14M5 14.5h14M12 11.75h.01M7 6.25h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(p: { name: IconName; size?: number; filled?: boolean } & JSX.SvgSVGAttributes<SVGSVGElement>) {
  const size = () => p.size ?? 22;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill={p.filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={p.class}
    >
      <path d={PATHS[p.name]} />
    </svg>
  );
}
