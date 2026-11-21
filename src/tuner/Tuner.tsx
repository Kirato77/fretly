import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Icon } from "../ui/Icon";
import { Dial } from "./Dial";
import { noteName, octave, pitchClass } from "./notes";
import { nearestString, Smoother, startMic, type Mic } from "./pitch";
import { TuningSheet } from "./TuningSheet";
import { INSTRUMENTS, type Tuning } from "./tunings";

const IN_TUNE = 2; // cents
const CLOSE = 10;
const SILENCE_MS = 400; // keep showing the last reading briefly while the string decays
const TUNED_AFTER_MS = 600; // held in tune this long = string ticked as tuned

interface Props {
  tuning: Tuning;
  tunings: Tuning[];
  a4: number;
  active: boolean;
  onTuning(id: string): void;
  onA4(hz: number): void;
  onSaveCustom(t: Tuning): void;
  onDeleteCustom(id: string): void;
}

export function Tuner(p: Props) {
  const [midi, setMidi] = createSignal<number | null>(null);
  const [locked, setLocked] = createSignal<number | null>(null);
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal("");
  const [sheet, setSheet] = createSignal(false);
  const [tuned, setTuned] = createSignal<number[]>([]);
  const smoother = new Smoother();
  let mic: Mic | undefined;
  let starting = false;
  let lastHeard = 0;

  async function start() {
    if (starting || mic) return; // a double tap would open a second mic that nothing stops
    starting = true;
    setError("");
    try {
      const opened = await startMic(
        (m) => {
          const now = performance.now();
          if (m !== null) {
            lastHeard = now;
            setMidi(smoother.push(m));
          } else if (now - lastHeard > SILENCE_MS) {
            smoother.reset();
            setMidi(null);
          }
        },
        () => p.a4,
      );
      // The tab or the app may have been left while the mic was opening.
      if (!p.active || document.hidden) {
        opened.stop();
      } else {
        mic = opened;
        setRunning(true);
      }
    } catch (e) {
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setError(denied ? "Microphone access denied. Allow it in Settings › Fretly › Microphone." : String(e));
    } finally {
      starting = false;
    }
  }

  function stop() {
    mic?.stop();
    mic = undefined;
    setRunning(false);
    smoother.reset();
    setMidi(null);
  }

  // Release the mic when leaving the tab or the app: battery, and the iOS mic indicator.
  createEffect(() => !p.active && stop());
  const onVisibility = () => document.hidden && stop();
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
  });
  createEffect(
    on(
      () => p.tuning,
      () => {
        setLocked(null);
        setTuned([]);
      },
    ),
  );

  const target = () => {
    const m = midi();
    return locked() ?? (m === null ? null : nearestString(m, p.tuning.notes));
  };
  const cents = () => {
    const m = midi();
    const t = target();
    return m === null || t === null ? null : (m - p.tuning.notes[t]) * 100;
  };
  const status = () => {
    const c = cents();
    if (c === null) return "idle";
    return Math.abs(c) <= IN_TUNE ? "in" : Math.abs(c) <= CLOSE ? "close" : "off";
  };

  // Tick a string once it has stayed in tune for a moment: shows tuning progress across the strings.
  let inTuneSince = 0;
  let inTuneString: number | null = null;
  createEffect(() => {
    const t = target();
    if (status() !== "in" || t === null) return void (inTuneSince = 0);
    const now = performance.now();
    if (t !== inTuneString || !inTuneSince) {
      inTuneString = t;
      inTuneSince = now;
    } else if (now - inTuneSince > TUNED_AFTER_MS && !tuned().includes(t)) {
      setTuned([...tuned(), t]);
    }
  });

  const hint = () => {
    const c = cents();
    if (error()) return error();
    if (!running()) return "Tap to tune, then play a string";
    if (c === null) return "Play a string";
    if (status() === "in") return "In tune";
    return c < 0 ? "Too low · tune up" : "Too high · tune down";
  };

  return (
    <div class={`tuner ${status()}`}>
      <div class="tuner-glow" aria-hidden="true" />

      <button class="tuning-pill" onClick={() => setSheet(true)} aria-label={`Tuning: ${p.tuning.name}. Change`}>
        <span class="pill-instrument">{INSTRUMENTS.find((i) => i.id === p.tuning.instrument)!.label}</span>
        <span class="pill-name">{p.tuning.name}</span>
        <span class="pill-notes">{p.tuning.notes.map(pitchClass).join(" ")}</span>
        <Icon name="chevronDown" size={18} />
      </button>

      <Dial cents={cents()} inTune={IN_TUNE}>
        <Show
          when={running()}
          fallback={
            <button class="listen" onClick={start}>
              <Icon name="mic" size={30} />
              <span>Tap to tune</span>
            </button>
          }
        >
          <div class="note" aria-live="polite">
            <Show when={target() !== null} fallback={<span class="note-idle">·</span>}>
              {pitchClass(p.tuning.notes[target()!])}
              <sub>{octave(p.tuning.notes[target()!])}</sub>
            </Show>
          </div>
          <div class="cents">
            <Show when={cents() !== null} fallback={" "}>
              {cents()! > 0 ? "+" : ""}
              {cents()!.toFixed(1)}
              <span class="unit">¢</span>
            </Show>
          </div>
        </Show>
      </Dial>

      <div class="hint" classList={{ error: !!error() }}>
        <Show when={status() === "in"}>
          <Icon name="check" size={18} />
        </Show>
        {hint()}
      </div>
      <div class="heard">
        <Show when={midi() !== null} fallback={" "}>
          Hearing {noteName(midi()!)}
        </Show>
      </div>

      <div class="strings" role="group" aria-label="Strings">
        <For each={p.tuning.notes}>
          {(n, i) => (
            <button
              class="string"
              classList={{ target: target() === i(), locked: locked() === i(), tuned: tuned().includes(i()) }}
              onClick={() => setLocked(locked() === i() ? null : i())}
              aria-pressed={locked() === i()}
              aria-label={`${noteName(n)}${tuned().includes(i()) ? ", tuned" : ""}${locked() === i() ? ", locked" : ""}`}
            >
              {pitchClass(n)}
              <sub>{octave(n)}</sub>
              <span class="string-badge" aria-hidden="true">
                <Show when={locked() === i()} fallback={<Icon name="check" size={11} />}>
                  <Icon name="lock" size={11} />
                </Show>
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="lock-hint">{locked() === null ? "Auto string detection · tap a string to lock it" : "Locked · tap it again for auto"}</div>

      <Show when={sheet()}>
        <TuningSheet
          tuning={p.tuning}
          tunings={p.tunings}
          a4={p.a4}
          onTuning={p.onTuning}
          onA4={p.onA4}
          onSaveCustom={p.onSaveCustom}
          onDeleteCustom={p.onDeleteCustom}
          onClose={() => setSheet(false)}
        />
      </Show>
    </div>
  );
}
