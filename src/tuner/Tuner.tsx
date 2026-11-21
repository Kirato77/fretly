import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { noteName, pitchClass } from "./notes";
import { nearestString, Smoother, startMic, type Mic } from "./pitch";
import { applyUpdate, updateReady, updateStatus, VERSION } from "../updater";
import { INSTRUMENTS, PRESETS, type Tuning } from "./tunings";

const IN_TUNE = 2; // cents
const CLOSE = 10;
const SILENCE_MS = 400; // keep showing the last reading briefly while the string decays

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
  const [editing, setEditing] = createSignal<Tuning | null>(null);
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
  createEffect(on(() => p.tuning, () => setLocked(null)));

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

  const pickInstrument = (id: string) =>
    p.tuning.instrument !== id && p.onTuning(PRESETS.find((t) => t.instrument === id)!.id);

  return (
    <div class={`tuner ${status()}`}>
      <div class="segmented">
        <For each={INSTRUMENTS}>
          {(i) => (
            <button classList={{ on: p.tuning.instrument === i.id }} onClick={() => pickInstrument(i.id)}>
              {i.label}
            </button>
          )}
        </For>
      </div>

      <div class="tuning-row">
        <select value={p.tuning.id} onChange={(e) => p.onTuning(e.currentTarget.value)} aria-label="Tuning">
          <For each={p.tunings.filter((t) => t.instrument === p.tuning.instrument)}>
            {(t) => <option value={t.id}>{t.name}</option>}
          </For>
        </select>
        <button class="ghost" onClick={() => setEditing({ ...p.tuning, notes: [...p.tuning.notes] })}>
          Edit
        </button>
      </div>

      <div class="readout" aria-live="polite">
        <div class="note">
          <Show when={target() !== null} fallback="–">
            {pitchClass(p.tuning.notes[target()!])}
            <sub>{Math.floor(p.tuning.notes[target()!] / 12) - 1}</sub>
          </Show>
        </div>
        <div class="cents">
          <Show when={cents() !== null} fallback={running() ? "Play a string" : " "}>
            {cents()! > 0 ? "+" : ""}
            {cents()!.toFixed(1)} ¢
          </Show>
        </div>
        <div class="hint">
          <Show when={status() === "in"} fallback={cents() === null ? " " : cents()! < 0 ? "Tune up ↑" : "Tune down ↓"}>
            In tune
          </Show>
        </div>
      </div>

      <div class="gauge" aria-hidden="true">
        <div class="zone" />
        <div class="ticks">
          <span>-50</span>
          <span>-25</span>
          <span>0</span>
          <span>+25</span>
          <span>+50</span>
        </div>
        <Show when={cents() !== null}>
          <div class="needle" style={{ left: `${50 + Math.max(-50, Math.min(50, cents()!))}%` }} />
        </Show>
      </div>
      <div class="heard">
        <Show when={midi() !== null} fallback=" ">
          Heard {noteName(midi()!)}
        </Show>
      </div>

      <div class="strings">
        <For each={p.tuning.notes}>
          {(n, i) => (
            <button
              classList={{ target: target() === i(), locked: locked() === i() }}
              onClick={() => setLocked(locked() === i() ? null : i())}
              aria-pressed={locked() === i()}
            >
              {pitchClass(n)}
              <sub>{Math.floor(n / 12) - 1}</sub>
            </button>
          )}
        </For>
      </div>
      <div class="lock-hint">{locked() === null ? "Auto string detection · tap a string to lock it" : "Locked · tap again for auto"}</div>

      <div class="calibration">
        <span>A4</span>
        <button class="ghost" onClick={() => p.onA4(Math.max(430, p.a4 - 1))} aria-label="Lower A4">
          −
        </button>
        <span>{p.a4} Hz</span>
        <button class="ghost" onClick={() => p.onA4(Math.min(450, p.a4 + 1))} aria-label="Raise A4">
          +
        </button>
      </div>
      <div class="version">
        Fretly {VERSION}
        <Show when={updateStatus()}> · {updateStatus()}</Show>
        <Show when={updateReady()}>
          {" "}
          <button class="ghost" onClick={applyUpdate}>
            Restart now
          </button>
        </Show>
      </div>

      <Show when={!running()}>
        <div class="start">
          <button class="primary" onClick={start}>
            Start tuner
          </button>
          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </div>
      </Show>

      <Show when={editing()}>
        {(t) => (
          <TuningEditor
            tuning={t()}
            onCancel={() => setEditing(null)}
            onSave={(saved) => {
              p.onSaveCustom(saved);
              setEditing(null);
            }}
            onDelete={() => {
              p.onDeleteCustom(t().id);
              setEditing(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

function TuningEditor(p: { tuning: Tuning; onSave(t: Tuning): void; onCancel(): void; onDelete(): void }) {
  const [notes, setNotes] = createSignal(p.tuning.notes);
  const [name, setName] = createSignal(p.tuning.custom ? p.tuning.name : "");
  const shift = (i: number, d: number) => setNotes((ns) => ns.map((n, j) => (j === i ? n + d : n)));
  const fallbackName = () => notes().map(pitchClass).join(" ");

  return (
    <div class="sheet" role="dialog" aria-label="Custom tuning">
      <h2>{p.tuning.custom ? "Edit tuning" : "New custom tuning"}</h2>
      <input placeholder={fallbackName()} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      <ul class="editor-strings">
        <For each={notes()}>
          {(n, i) => (
            <li>
              <button class="ghost" onClick={() => shift(i(), -1)} aria-label="Down a semitone">
                −
              </button>
              <span>{noteName(n)}</span>
              <button class="ghost" onClick={() => shift(i(), 1)} aria-label="Up a semitone">
                +
              </button>
            </li>
          )}
        </For>
      </ul>
      <div class="sheet-actions">
        <Show when={p.tuning.custom}>
          <button class="danger" onClick={p.onDelete}>
            Delete
          </button>
        </Show>
        <button class="ghost" onClick={p.onCancel}>
          Cancel
        </button>
        <button
          class="primary"
          onClick={() =>
            p.onSave({
              id: p.tuning.custom ? p.tuning.id : `custom-${Date.now()}`,
              name: name().trim() || fallbackName(),
              instrument: p.tuning.instrument,
              notes: notes(),
              custom: true,
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
