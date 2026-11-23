import { midiToFreq } from "./notes";

export const TONE_SECONDS = 3;
const HARMONICS = 12;

/** Harmonic spectrum falling as 1/h^rolloff: low rolloff = bright, high = mellow. */
function wave(ctx: BaseAudioContext, rolloff: number) {
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let h = 1; h <= HARMONICS; h++) imag[h] = 1 / h ** rolloff;
  return ctx.createPeriodicWave(real, imag);
}

/**
 * Builds a plucked-string-like note in `ctx`, sent to `out`, at the exact frequency. Not Karplus-Strong (its
 * period is rounded to whole samples: high e ~5 cents sharp), and no sweeping filter (a moving filter shifts
 * the phase, measured 1–3 cents flat). Two oscillators on the same frequency instead: a bright layer that dies
 * fast for the attack, a mellow one that rings. Only their volumes move, which never changes the pitch.
 */
export function connectTone(ctx: BaseAudioContext, midi: number, a4: number, out: AudioNode, delay = 0, gain = 1) {
  const t = ctx.currentTime + delay;
  const layer = (rolloff: number, peak: number, seconds: number) => {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave(ctx, rolloff));
    osc.frequency.value = midiToFreq(midi, a4);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak * gain, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + seconds);
  };
  layer(0.9, 0.35, 0.4); // attack: bright, short
  layer(1.8, 0.45, TONE_SECONDS); // body: mellow, rings
}

let ctx: AudioContext | undefined;

/**
 * Plays the reference note of a string, starting `delay` seconds from now. Call it from the tap itself:
 * iOS only lets audio start inside a gesture, so the delay is scheduled here rather than with a timer.
 */
export function playString(midi: number, a4: number, delay = 0, gain = 1) {
  ctx ??= new AudioContext();
  void ctx.resume();
  connectTone(ctx, midi, a4, ctx.destination, delay, gain);
}

/** Several notes one after the other: `gap` 0.04 s strums a chord, 0.3 s walks a scale. Quieter each, so a chord does not clip. */
export function playNotes(midis: number[], a4: number, gap: number) {
  const gain = gap < 0.1 ? 1 / Math.sqrt(midis.length) : 0.8;
  midis.forEach((m, i) => playString(m, a4, i * gap, gain));
}

/**
 * Cuts any note still ringing. Closing the context is the only sure stop: when the mic opens mid-note,
 * iOS switches the audio session and the context's clock can stall, so the note's fade and stop never come.
 */
export function stopTone() {
  void ctx?.close();
  ctx = undefined;
}
