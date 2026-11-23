import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { load, save } from "../storage";
import { Icon } from "../ui/Icon";
import { TEMPO_MAX as MAX, TEMPO_MIN as MIN, tapTempo } from "./theory";

const LOOKAHEAD_S = 0.12; // clicks are scheduled this far ahead on the audio clock: timers alone drift and stutter
const TICK_MS = 25;

export function Metronome(p: { active: boolean }) {
  const [bpm, setBpm] = createSignal(90);
  const [beats, setBeats] = createSignal(4);
  const [running, setRunning] = createSignal(false);
  const [beat, setBeat] = createSignal(-1);
  void load("metronome", { bpm: 90, beats: 4 }).then((m) => (setBpm(m.bpm), setBeats(m.beats)));
  const remember = () => void save("metronome", { bpm: bpm(), beats: beats() });
  const changeBpm = (v: number) => {
    setBpm(Math.min(MAX, Math.max(MIN, Math.round(v))));
    remember();
  };

  let ctx: AudioContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let next = 0;
  let count = 0;
  let taps: number[] = [];

  function click(time: number, accent: boolean) {
    const osc = ctx!.createOscillator();
    const amp = ctx!.createGain();
    osc.frequency.value = accent ? 1760 : 1100;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, time + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(amp).connect(ctx!.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function start() {
    ctx ??= new AudioContext(); // created in the tap: iOS only starts audio inside a gesture
    void ctx.resume();
    next = ctx.currentTime + 0.05;
    count = 0;
    timer = setInterval(() => {
      while (next < ctx!.currentTime + LOOKAHEAD_S) {
        const n = count % beats();
        click(next, n === 0);
        // light the dot when the click is actually heard
        setTimeout(() => running() && setBeat(n), Math.max(0, (next - ctx!.currentTime) * 1000));
        next += 60 / bpm();
        count++;
      }
    }, TICK_MS);
    setRunning(true);
  }

  function stop() {
    clearInterval(timer);
    void ctx?.suspend(); // clicks are scheduled ahead: without this the next one still sounds after Stop
    setRunning(false);
    setBeat(-1);
  }

  createEffect(() => !p.active && stop());
  const onVisibility = () => document.hidden && stop();
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
    void ctx?.close();
  });

  const tap = () => {
    taps = [...taps.filter((t) => performance.now() - t < 2000), performance.now()];
    const t = tapTempo(taps);
    if (t) changeBpm(t);
  };

  return (
    <div class="tool-body metronome">
      <div class="beats" aria-hidden="true">
        <For each={Array.from({ length: beats() }, (_, i) => i)}>
          {(i) => <span classList={{ on: beat() === i, accent: i === 0 }} />}
        </For>
      </div>

      <div class="bpm">
        <button class="round-btn" onClick={() => changeBpm(bpm() - 1)} aria-label="Slower">
          <Icon name="minus" />
        </button>
        <div>
          <div class="bpm-value">{bpm()}</div>
          <div class="bpm-unit">BPM</div>
        </div>
        <button class="round-btn" onClick={() => changeBpm(bpm() + 1)} aria-label="Faster">
          <Icon name="plus" />
        </button>
      </div>

      <input
        class="bpm-slider"
        type="range"
        min={MIN}
        max={MAX}
        value={bpm()}
        onInput={(e) => changeBpm(+e.currentTarget.value)}
        aria-label="Tempo"
      />

      <div class="segmented small" role="group" aria-label="Beats per bar">
        <For each={[2, 3, 4, 6]}>
          {(n) => (
            <button classList={{ on: beats() === n }} onClick={() => (setBeats(n), remember())}>
              {n}/4
            </button>
          )}
        </For>
      </div>

      <div class="metro-actions">
        <button class="text-btn tap" onClick={tap}>
          Tap tempo
        </button>
        <button class="play-btn" classList={{ on: running() }} onClick={() => (running() ? stop() : start())} aria-label={running() ? "Stop" : "Start"}>
          <Icon name={running() ? "pause" : "play"} size={30} filled={!running()} />
        </button>
        <span class="tap-spacer" />
      </div>
    </div>
  );
}
