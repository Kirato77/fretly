import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { keepAwake } from "../awake";
import { load, save } from "../storage";
import { trackToLines } from "../tabs/songsterr";
import { ChordSheet } from "../tools/ChordSheet";
import { chordTuning } from "../tools/ChordView";
import { chordName, parseChord, ROOTS } from "../tools/theory";
import { noteName } from "../tuner/notes";
import { playNotes } from "../tuner/tone";
import type { Tuning } from "../tuner/tunings";
import { Icon } from "../ui/Icon";
import {
  cleanNotes,
  detectChords,
  detectKey,
  groupOnsets,
  keyFromProfile,
  melodyLine,
  placeOnStrings,
  toTrack,
  type ChordSpan,
  type Note,
} from "./analysis";
import { songChords } from "./chroma";
import { decodeAudio, MAX_SECONDS, MODEL_RATE, monoSamples, transcribeSamples } from "./engine";
import { harmonize, pitchTrack, segmentMelody } from "./melody";

type View = "chords" | "notes" | "tab";
type Mode = "instrument" | "voice" | "song";
interface Saved {
  name: string;
  duration: number;
  mode?: Mode; // absent: saved before modes existed (instrument)
  notes: Note[];
  /** Full song: chords read from the sound, and its energy per pitch class (for the key). */
  chords?: ChordSpan[];
  profile?: number[];
}

const MODES: { id: Mode; label: string; record: string; working: string; hint: string }[] = [
  {
    id: "instrument",
    label: "Instrument",
    record: "Your guitar, a riff, a progression",
    working: "Listening for every note…",
    hint: "One instrument: a riff, a chord progression, a solo.",
  },
  {
    id: "voice",
    label: "Voice",
    record: "Sing, hum or whistle a tune",
    working: "Following the melody…",
    hint: "A tune sung, hummed or whistled. You get its notes, and chords that fit under it.",
  },
  {
    id: "song",
    label: "Full song",
    record: "A song playing nearby",
    working: "Reading the chords, then the melody…",
    hint: "A whole mix with drums and vocals. Chords come from the sound; the notes follow the top line (a lead, a sample, the voice).",
  },
];

const clock = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const CHAR_RATIO = 0.6;

/** Record or import a clip, get its chords, notes and a suggested tab. */
export function Transcribe(p: { tuning: Tuning; a4: number; active: boolean }) {
  const [result, setResult] = createSignal<Saved | null>(null);
  const [audio, setAudio] = createSignal<AudioBuffer | null>(null); // original, for playback (not kept across launches)
  const [phase, setPhase] = createSignal<"idle" | "recording" | "working">("idle");
  const [progress, setProgress] = createSignal(0);
  const [elapsed, setElapsed] = createSignal(0);
  const [error, setError] = createSignal("");
  const [view, setView] = createSignal<View>("chords");
  const [mode, setMode] = createSignal<Mode>("instrument");
  const modeInfo = () => MODES.find((m) => m.id === mode())!;
  const [openChord, setOpenChord] = createSignal<string | null>(null);
  const [playhead, setPlayhead] = createSignal<number | null>(null);
  const [width, setWidth] = createSignal(340);
  let fileInput!: HTMLInputElement;
  let tabBox: HTMLDivElement | undefined;

  onMount(async () => {
    setMode(await load<Mode>("transcribeMode", "instrument"));
    setResult(await load<Saved | null>("lastTranscription", null));
  });
  const pickMode = (m: Mode) => {
    setMode(m);
    void save("transcribeMode", m);
  };
  createEffect(() => keepAwake("transcribe", phase() !== "idle" || playhead() !== null));

  // Everything below is derived from the saved notes, so a tuning change re-places the tab at once.
  const resultMode = () => result()?.mode ?? "instrument";
  const notes = createMemo(() => {
    const raw = result()?.notes ?? [];
    if (resultMode() === "voice") return raw; // already clean: one note at a time, from the pitch tracker
    const clean = cleanNotes(raw, p.tuning.notes);
    return resultMode() === "song" ? melodyLine(clean) : clean;
  });
  const key = createMemo(() => {
    const profile = result()?.profile;
    return resultMode() === "song" && profile ? keyFromProfile(profile) : detectKey(notes());
  });
  const chords = createMemo(() => {
    if (resultMode() === "song") return result()?.chords ?? [];
    if (resultMode() === "voice") return key() ? harmonize(notes(), key()!) : [];
    return detectChords(notes());
  });
  const groups = createMemo(() => groupOnsets(notes()));
  const tabTuning = () => chordTuning(p.tuning).notes;
  const tab = createMemo(() =>
    trackToLines(toTrack(placeOnStrings(groups(), tabTuning()), chords(), tabTuning()), Math.max(20, Math.floor(width() / (13 * CHAR_RATIO)))),
  );
  const uniqueChords = createMemo(() => [...new Set(chords().flatMap((c) => (c.chord ? [chordName(c.chord)] : [])))]);
  /** Notes in rows of about two seconds, each row playable. */
  const noteRows = createMemo(() => {
    const rows: Note[][][] = [];
    for (const g of groups()) {
      const row = rows.at(-1);
      if (row && g[0].start - row[0][0].start < 2) row.push(g);
      else rows.push([g]);
    }
    return rows;
  });

  async function analyse(name: string, data: ArrayBuffer) {
    setPhase("working");
    setProgress(0);
    setError("");
    try {
      const buffer = await decodeAudio(data);
      const samples = await monoSamples(buffer);
      const m = mode();
      const saved: Saved = { name, duration: Math.min(buffer.duration, MAX_SECONDS), mode: m, notes: [] };
      if (m === "voice") {
        saved.notes = segmentMelody(pitchTrack(samples, MODEL_RATE));
        setProgress(1);
      } else if (m === "song") {
        // Chords first (quick), then every note for the melody line (the model takes most of the time).
        const { spans, profile } = await songChords(samples, MODEL_RATE, (x) => setProgress(x * 0.25));
        saved.chords = spans;
        saved.profile = profile;
        saved.notes = await transcribeSamples(samples, (x) => setProgress(0.25 + x * 0.75));
      } else {
        saved.notes = await transcribeSamples(samples, setProgress);
      }
      setAudio(buffer);
      setResult(saved);
      setView("chords");
      void save("lastTranscription", saved);
    } catch (e) {
      setError(`Could not read this audio (${e instanceof Error ? e.message : e}).`);
    } finally {
      setPhase("idle");
    }
  }

  // Recording: raw mic (no voice processing), up to MAX_SECONDS.
  let recorder: MediaRecorder | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  async function record() {
    setError("");
    stopPlayback();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        clearInterval(ticker);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder?.mimeType });
        if (blob.size) await analyse(`Recording · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, await blob.arrayBuffer());
        else setPhase("idle");
      };
      recorder.start();
      const began = performance.now();
      setElapsed(0);
      setPhase("recording");
      ticker = setInterval(() => {
        setElapsed((performance.now() - began) / 1000);
        if (elapsed() >= MAX_SECONDS) stopRecording();
      }, 200);
    } catch (e) {
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setError(denied ? "Microphone access denied. Allow it in Settings › Fretly › Microphone." : String(e));
    }
  }
  const stopRecording = () => recorder?.state === "recording" && recorder.stop();

  async function importFile(file: File | undefined) {
    if (!file) return;
    stopPlayback();
    await analyse(file.name.replace(/\.[^.]+$/, ""), await file.arrayBuffer());
    fileInput.value = "";
  }

  // Playback of the original, with the current chord highlighted.
  let ctx: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let raf = 0;
  function play(from = 0) {
    const buffer = audio();
    if (!buffer) return;
    stopPlayback();
    ctx ??= new AudioContext();
    void ctx.resume();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startedAt = ctx.currentTime - from;
    source.start(0, from);
    source.onended = () => stopPlayback();
    const tick = () => {
      setPlayhead(ctx!.currentTime - startedAt);
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopPlayback() {
    cancelAnimationFrame(raf);
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already ended
      }
    }
    source = undefined;
    setPlayhead(null);
  }
  createEffect(() => {
    if (!p.active) {
      stopPlayback();
      stopRecording();
    }
  });
  onCleanup(() => {
    stopPlayback();
    stopRecording();
    void ctx?.close();
  });

  const current = (start: number, end: number) => {
    const t = playhead();
    return t !== null && t >= start && t < end;
  };

  onMount(() => {
    const ro = new ResizeObserver(() => tabBox && setWidth(tabBox.clientWidth - 24));
    createEffect(() => view() === "tab" && tabBox && ro.observe(tabBox));
    onCleanup(() => ro.disconnect());
  });

  return (
    <div class="tools-page transcribe">
      <header class="search-head">
        <h1>Transcribe</h1>
      </header>

      <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => void importFile(e.currentTarget.files?.[0])} />

      <Show when={phase() === "recording"}>
        <div class="capture">
          <div class="rec-dot" />
          <div class="rec-time">{clock(elapsed())}</div>
          <p class="muted">Play the passage near the phone. Up to {MAX_SECONDS / 60} minutes.</p>
          <button class="play-btn on" onClick={stopRecording} aria-label="Stop and transcribe">
            <Icon name="pause" size={30} />
          </button>
          <span class="muted small">Stop to transcribe</span>
        </div>
      </Show>

      <Show when={phase() === "working"}>
        <div class="capture">
          <div class="progress" role="progressbar" aria-valuenow={Math.round(progress() * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.round(progress() * 100)}%` }} />
          </div>
          <p>
            {modeInfo().working} {Math.round(progress() * 100)}%
          </p>
          <p class="muted small">Runs on your phone, offline. A full song takes a little while.</p>
        </div>
      </Show>

      <Show when={phase() === "idle"}>
        <div class="segmented" role="group" aria-label="What is it">
          <For each={MODES}>
            {(m) => (
              <button classList={{ on: mode() === m.id }} aria-pressed={mode() === m.id} onClick={() => pickMode(m.id)}>
                {m.label}
              </button>
            )}
          </For>
        </div>
        <div class="capture-actions">
          <button class="action-card" onClick={record}>
            <Icon name="mic" size={26} />
            <span>Record</span>
            <small>{modeInfo().record}</small>
          </button>
          <button class="action-card" onClick={() => fileInput.click()}>
            <Icon name="songs" size={26} />
            <span>Import audio</span>
            <small>A voice memo, an mp3, an m4a…</small>
          </button>
        </div>
        <Show when={error()}>
          <p class="notice">{error()}</p>
        </Show>

        <Show
          when={result()}
          fallback={<p class="muted small center">{modeInfo().hint}</p>}
        >
          {(r) => (
            <>
              <div class="chord-head">
                <div>
                  <div class="chord-title small-title">{r().name}</div>
                  <div class="chord-notes">
                    {clock(r().duration)}
                    <Show when={key()}>{(k) => ` · key of ${ROOTS[k().root]} ${k().minor ? "minor" : "major"}`}</Show>
                    {` · ${notes().length} notes`}
                  </div>
                </div>
                <Show when={audio()}>
                  <button
                    class="hear-btn small"
                    classList={{ on: playhead() !== null }}
                    onClick={() => (playhead() === null ? play() : stopPlayback())}
                    aria-label={playhead() === null ? "Play the recording" : "Stop"}
                  >
                    <Icon name={playhead() === null ? "play" : "pause"} size={18} filled={playhead() === null} />
                  </button>
                </Show>
              </div>

              <Show when={uniqueChords().length}>
                <div class="chips">
                  <For each={uniqueChords()}>
                    {(name) => (
                      <button class="chip" onClick={() => setOpenChord(name)}>
                        {name}
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <div class="segmented small" role="group" aria-label="Show">
                <button classList={{ on: view() === "chords" }} onClick={() => setView("chords")}>
                  Chords
                </button>
                <button classList={{ on: view() === "notes" }} onClick={() => setView("notes")}>
                  Notes
                </button>
                <button classList={{ on: view() === "tab" }} onClick={() => setView("tab")}>
                  Tab
                </button>
              </div>

              <Show when={view() === "chords"}>
                <Show when={resultMode() !== "instrument"}>
                  <p class="muted small">
                    {resultMode() === "voice"
                      ? "Suggested chords that fit the melody, from its key: a starting point, not what was played."
                      : "Chords heard in the mix. The Notes and Tab views follow the top line: a lead, a sample or the voice."}
                  </p>
                </Show>
                <div class="card">
                  <For each={chords()} fallback={<p class="notice">No clear chords heard: try the Notes view.</p>}>
                    {(c) => (
                      <div class="row timeline" classList={{ playing: current(c.start, c.end) }}>
                        <button
                          class="row-hit"
                          onClick={() => (audio() ? play(c.start) : c.chord && setOpenChord(chordName(c.chord)))}
                          aria-label={audio() ? `Play from ${clock(c.start)}` : undefined}
                        >
                          <span class="time">{clock(c.start)}</span>
                          <span class="row-title">{c.chord ? chordName(c.chord) : "—"}</span>
                        </button>
                        <Show when={c.chord}>
                          <button class="text-btn" onClick={() => setOpenChord(chordName(c.chord!))}>
                            Shape
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={view() === "notes"}>
                <div class="card">
                  <For each={noteRows()}>
                    {(row) => (
                      <button
                        class="row timeline"
                        classList={{ playing: current(row[0][0].start, row.at(-1)![0].start + 0.5) }}
                        onClick={() => playNotes(row.flat().map((n) => n.midi), p.a4, 0.22)}
                      >
                        <span class="time">{clock(row[0][0].start)}</span>
                        <span class="row-main notes-line">
                          {row.map((g) => g.map((n) => noteName(n.midi)).join("+")).join("  ")}
                        </span>
                        <Icon name="play" size={14} filled />
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={view() === "tab"}>
                <div class="card tab-card" ref={tabBox}>
                  <pre>
                    <For each={tab()}>
                      {(line) => (
                        <div>
                          <For each={line.split(/\[ch\](.*?)\[\/ch\]/)}>
                            {(part, i) =>
                              i() % 2 && parseChord(part) ? (
                                <button class="chord" onClick={() => setOpenChord(part)}>
                                  {part}
                                </button>
                              ) : (
                                part
                              )
                            }
                          </For>
                        </div>
                      )}
                    </For>
                  </pre>
                  <p class="chord-for">Suggested positions for {chordTuning(p.tuning).name}: the fewest hand moves, not always the original fingering.</p>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>

      <Show when={openChord()}>
        {(name) => <ChordSheet name={name()} tuning={p.tuning} a4={p.a4} onClose={() => setOpenChord(null)} />}
      </Show>
    </div>
  );
}
