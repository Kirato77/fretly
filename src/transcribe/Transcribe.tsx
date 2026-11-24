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
  joinFragments,
  keyFromProfile,
  melodyLine,
  placeOnStrings,
  smooth,
  toTrack,
  type ChordSpan,
  type Note,
} from "./analysis";
import { songChords } from "./chroma";
import { decodeAudio, loadVoiceModel, MAX_SECONDS, MODEL_RATE, monoSamples, transcribeSamples } from "./engine";
import { harmonize, segmentMelody, VOICE_RATE, voiceTrack } from "./melody";

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
  const [phase, setPhase] = createSignal<"idle" | "recording" | "trim" | "working">("idle");
  const [pending, setPending] = createSignal<{ name: string; buffer: AudioBuffer } | null>(null); // imported, passage not chosen yet
  const [from, setFrom] = createSignal(0);
  const [to, setTo] = createSignal(0);
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
    // Full song: the tune from C4 up, so bass lines and pads stay out of it.
    return resultMode() === "song" ? melodyLine(cleanNotes(joinFragments(raw), p.tuning.notes, true), 60) : cleanNotes(raw, p.tuning.notes);
  });
  const key = createMemo(() => {
    const profile = result()?.profile;
    return resultMode() === "song" && profile ? keyFromProfile(profile) : detectKey(notes());
  });
  const chords = createMemo(() => {
    if (resultMode() === "song") return smooth(result()?.chords ?? [], 1);
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

  async function decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
    try {
      return await decodeAudio(data);
    } catch (e) {
      setError(`Could not read this audio (${e instanceof Error ? e.message : e}).`);
      setPhase("idle");
      return null;
    }
  }

  async function analyse(name: string, buffer: AudioBuffer) {
    stopPlayback();
    setPhase("working");
    setProgress(0);
    setError("");
    try {
      const m = mode();
      const saved: Saved = { name, duration: Math.min(buffer.duration, MAX_SECONDS), mode: m, notes: [] };
      if (m === "voice") {
        const [samples, model] = await Promise.all([monoSamples(buffer, VOICE_RATE), loadVoiceModel()]);
        saved.notes = segmentMelody(await voiceTrack(samples, model, setProgress));
      } else if (m === "song") {
        // Chords first (quick), then every note for the melody line (the model takes most of the time).
        const samples = await monoSamples(buffer);
        const { spans, profile } = await songChords(samples, MODEL_RATE, (x) => setProgress(x * 0.25));
        saved.chords = spans;
        saved.profile = profile;
        saved.notes = await transcribeSamples(samples, (x) => setProgress(0.25 + x * 0.75));
      } else {
        saved.notes = await transcribeSamples(await monoSamples(buffer), setProgress);
      }
      if (!saved.notes.length && !saved.chords?.some((c) => c.chord)) {
        setError(
          m === "voice"
            ? "No clear tune heard. Hum or sing closer to the phone, one note at a time, without music playing."
            : "Nothing clear heard. Try closer to the sound, or a longer passage.",
        );
        return; // keep the previous result
      }
      setAudio(buffer);
      setResult(saved);
      setView(m === "voice" ? "notes" : "chords"); // a tune is its notes; its chords are only suggestions
      void save("lastTranscription", saved);
    } catch (e) {
      setError(`Could not analyse this audio (${e instanceof Error ? e.message : e}).`);
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
        const buffer = blob.size ? await decode(await blob.arrayBuffer()) : null;
        if (buffer) await analyse(`Recording · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, buffer);
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

  // Long imports: pick the passage first (quicker, and only what you want to learn).
  async function importFile(file: File | undefined) {
    if (!file) return;
    stopPlayback();
    setError("");
    const name = file.name.replace(/\.[^.]+$/, "");
    const buffer = await decode(await file.arrayBuffer());
    fileInput.value = "";
    if (!buffer) return;
    if (buffer.duration <= 20) return analyse(name, buffer);
    setPending({ name, buffer });
    setFrom(0);
    setTo(Math.min(buffer.duration, MAX_SECONDS));
    setPhase("trim");
  }

  /** A copy of [start, end) seconds of the buffer. */
  function slice(buffer: AudioBuffer, start: number, end: number) {
    const a = Math.floor(start * buffer.sampleRate);
    const b = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    const out = new AudioBuffer({ length: b - a, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) out.copyToChannel(buffer.getChannelData(ch).subarray(a, b), ch);
    return out;
  }

  function transcribePassage() {
    const p = pending();
    if (!p) return;
    const whole = from() === 0 && to() >= p.buffer.duration - 0.25;
    setPending(null);
    void analyse(whole ? p.name : `${p.name} · ${clock(from())}–${clock(to())}`, whole ? p.buffer : slice(p.buffer, from(), to()));
  }
  function cancelPassage() {
    stopPlayback();
    setPending(null);
    setPhase("idle");
  }
  // Both ends move together within the limits: at least 2 s, at most MAX_SECONDS.
  const moveFrom = (v: number) => {
    setFrom(Math.min(v, Math.max(0, to() - 2)));
    if (to() - from() > MAX_SECONDS) setTo(from() + MAX_SECONDS);
  };
  const moveTo = (v: number) => {
    setTo(Math.max(v, from() + 2));
    if (to() - from() > MAX_SECONDS) setFrom(to() - MAX_SECONDS);
  };

  // Playback of the original, with the current chord highlighted.
  let ctx: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let raf = 0;
  function play(start = 0, buffer = audio(), end?: number) {
    if (!buffer) return;
    stopPlayback();
    ctx ??= new AudioContext();
    void ctx.resume();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startedAt = ctx.currentTime - start;
    source.start(0, start, end === undefined ? undefined : end - start);
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

      <Show when={phase() === "trim" && pending()}>
        {(p) => (
          <div class="card passage">
            <div class="chord-title small-title">{p().name}</div>
            <p class="muted small">Choose the passage to transcribe: the shorter, the quicker.</p>
            <label class="passage-row">
              <span>Start</span>
              <input
                class="bpm-slider"
                type="range"
                min={0}
                max={p().buffer.duration}
                step={0.5}
                value={from()}
                onInput={(e) => moveFrom(+e.currentTarget.value)}
              />
              <span class="time">{clock(from())}</span>
            </label>
            <label class="passage-row">
              <span>End</span>
              <input
                class="bpm-slider"
                type="range"
                min={0}
                max={p().buffer.duration}
                step={0.5}
                value={to()}
                onInput={(e) => moveTo(+e.currentTarget.value)}
              />
              <span class="time">{clock(to())}</span>
            </label>
            <div class="passage-actions">
              <button
                class="hear-btn small"
                classList={{ on: playhead() !== null }}
                onClick={() => (playhead() === null ? play(from(), p().buffer, to()) : stopPlayback())}
                aria-label={playhead() === null ? "Hear the passage" : "Stop"}
              >
                <Icon name={playhead() === null ? "play" : "pause"} size={18} filled={playhead() === null} />
              </button>
              <span class="muted small">{clock(to() - from())}</span>
              <button class="text-btn" onClick={cancelPassage}>
                Cancel
              </button>
              <button class="primary" onClick={transcribePassage}>
                Transcribe
              </button>
            </div>
          </div>
        )}
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
