import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../ui/Icon";
import { updateStatus, VERSION } from "../updater";
import { noteName, pitchClass } from "./notes";
import { INSTRUMENTS, PRESETS, type Instrument, type Tuning } from "./tunings";

interface Props {
  tuning: Tuning;
  tunings: Tuning[];
  a4: number;
  onTuning(id: string): void;
  onA4(hz: number): void;
  onSaveCustom(t: Tuning): void;
  onDeleteCustom(id: string): void;
  onClose(): void;
}

const notesOf = (t: Tuning) => t.notes.map(pitchClass).join(" ");

/** Bottom sheet holding everything that is set once: instrument, tuning, custom tunings, A4, version. */
export function TuningSheet(p: Props) {
  const [instrument, setInstrument] = createSignal<Instrument>(p.tuning.instrument);
  const [editing, setEditing] = createSignal<Tuning | null>(null);
  const pick = (id: string) => {
    p.onTuning(id);
    p.onClose();
  };

  // Portal: the sheet must cover the tab bar, outside the tuner's stacking context.
  return (
    <Portal>
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Tuning">
        <div class="sheet-grip" />
        <Show
          when={editing()}
          fallback={
            <>
              <div class="segmented">
                <For each={INSTRUMENTS}>
                  {(i) => (
                    <button classList={{ on: instrument() === i.id }} onClick={() => setInstrument(i.id)}>
                      {i.label}
                    </button>
                  )}
                </For>
              </div>

              <ul class="tuning-list">
                <For each={p.tunings.filter((t) => t.instrument === instrument())}>
                  {(t) => (
                    <li>
                      <button class="tuning-item" classList={{ on: t.id === p.tuning.id }} onClick={() => pick(t.id)}>
                        <span class="tuning-name">{t.name}</span>
                        <span class="tuning-notes">{notesOf(t)}</span>
                        <Show when={t.id === p.tuning.id}>
                          <Icon name="check" size={18} class="tuning-check" />
                        </Show>
                      </button>
                      <Show when={t.custom}>
                        <button class="icon-btn" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>
                          <Icon name="edit" size={18} />
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>

              <button
                class="add-tuning"
                onClick={() => {
                  const base = p.tuning.instrument === instrument() ? p.tuning : PRESETS.find((t) => t.instrument === instrument())!;
                  setEditing({ ...base, notes: [...base.notes], custom: false });
                }}
              >
                <Icon name="plus" size={18} /> Custom tuning
              </button>

              <div class="calibration">
                <div>
                  <div class="calibration-title">Reference pitch</div>
                  <div class="muted small">A4 · 440 Hz is the standard</div>
                </div>
                <div class="stepper">
                  <button onClick={() => p.onA4(Math.max(430, p.a4 - 1))} aria-label="Lower A4">
                    <Icon name="minus" size={18} />
                  </button>
                  <span>{p.a4} Hz</span>
                  <button onClick={() => p.onA4(Math.min(450, p.a4 + 1))} aria-label="Raise A4">
                    <Icon name="plus" size={18} />
                  </button>
                </div>
              </div>

              <div class="version">
                Fretly {VERSION}
                <Show when={updateStatus()}> · {updateStatus()}</Show>
              </div>
            </>
          }
        >
          {(t) => (
            <TuningEditor
              tuning={t()}
              onCancel={() => setEditing(null)}
              onSave={(saved) => {
                p.onSaveCustom(saved);
                p.onClose();
              }}
              onDelete={() => {
                p.onDeleteCustom(t().id);
                setEditing(null);
              }}
            />
          )}
        </Show>
      </div>
    </div>
    </Portal>
  );
}

function TuningEditor(p: { tuning: Tuning; onSave(t: Tuning): void; onCancel(): void; onDelete(): void }) {
  const [notes, setNotes] = createSignal(p.tuning.notes);
  const [name, setName] = createSignal(p.tuning.custom ? p.tuning.name : "");
  const shift = (i: number, d: number) => setNotes((ns) => ns.map((n, j) => (j === i ? n + d : n)));
  const fallbackName = () => notes().map(pitchClass).join(" ");

  return (
    <div class="editor">
      <h2>{p.tuning.custom ? "Edit tuning" : "New tuning"}</h2>
      <input class="field" placeholder={fallbackName()} value={name()} onInput={(e) => setName(e.currentTarget.value)} aria-label="Name" />
      <ul class="editor-strings">
        <For each={notes()}>
          {(n, i) => (
            <li>
              <button onClick={() => shift(i(), -1)} aria-label={`String ${i() + 1} down a semitone`}>
                <Icon name="minus" size={18} />
              </button>
              <span>{noteName(n)}</span>
              <button onClick={() => shift(i(), 1)} aria-label={`String ${i() + 1} up a semitone`}>
                <Icon name="plus" size={18} />
              </button>
            </li>
          )}
        </For>
      </ul>
      <div class="editor-actions">
        <Show when={p.tuning.custom}>
          <button class="text-btn danger" onClick={p.onDelete}>
            Delete
          </button>
        </Show>
        <button class="text-btn" onClick={p.onCancel}>
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
