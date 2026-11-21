import { PitchDetector } from "pitchy";
import { freqToMidi } from "./notes";

export const WINDOW = 8192; // ≈170 ms at 48 kHz: ≥5 periods of a 5-string bass low B (31 Hz)
// ≈ -62 dBFS. Softly picked high e on an iPhone mic sits around -55/-60 dB; noise is
// rejected by the clarity check, which also drops notes too faint to read within a cent.
const MIN_RMS = 0.0008;
const MIN_CLARITY = 0.9;
const MIN_FREQ = 25;
const MAX_FREQ = 1400;

/** Returns a frame analyser: time-domain samples → frequency in Hz, or null when no clear pitch. */
export function createDetector(sampleRate: number) {
  const detector = PitchDetector.forFloat32Array(WINDOW);
  detector.minVolumeAbsolute = MIN_RMS;
  return (samples: Float32Array): number | null => {
    const [freq, clarity] = detector.findPitch(samples, sampleRate);
    return clarity >= MIN_CLARITY && freq >= MIN_FREQ && freq <= MAX_FREQ ? freq : null;
  };
}

/**
 * Steadies the needle: median of the last frames kills octave blips, then an EMA removes jitter.
 * When the median itself jumps more than half a semitone (new string plucked), it snaps at once.
 */
export class Smoother {
  private history: number[] = [];
  private value: number | null = null;

  constructor(private size = 5, private alpha = 0.35) {}

  /** midi: fractional MIDI note of the current frame. Returns the smoothed value. */
  push(midi: number): number {
    this.history.push(midi);
    if (this.history.length > this.size) this.history.shift();
    const median = [...this.history].sort((a, b) => a - b)[this.history.length >> 1];
    if (this.value === null || Math.abs(median - this.value) > 0.5) {
      this.history = this.history.filter((m) => Math.abs(m - median) <= 0.5);
      this.value = median;
    } else {
      this.value += this.alpha * (median - this.value);
    }
    return this.value;
  }

  reset() {
    this.history = [];
    this.value = null;
  }
}

/** Index of the string whose note is closest to the played pitch. */
export const nearestString = (midi: number, notes: number[]) =>
  notes.reduce((best, n, i) => (Math.abs(n - midi) < Math.abs(notes[best] - midi) ? i : best), 0);

export interface Mic {
  stop(): void;
  /** Releases the mic but keeps the audio engine running, so it can come back without a new tap. */
  pause(): void;
  resume(): Promise<void>;
}

// Voice processing (AGC, noise gate, echo filter) bends a guitar signal: keep it raw.
const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };

/** Opens the mic and calls onPitch every animation frame with a fractional MIDI note (or null). */
export async function startMic(onPitch: (midi: number | null) => void, a4: () => number): Promise<Mic> {
  let stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  const ctx = new AudioContext();
  await ctx.resume();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = WINDOW;
  let source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  const detect = createDetector(ctx.sampleRate);
  const buf = new Float32Array(WINDOW);
  let raf = requestAnimationFrame(function loop() {
    analyser.getFloatTimeDomainData(buf);
    const freq = detect(buf);
    onPitch(freq === null ? null : freqToMidi(freq, a4()));
    raf = requestAnimationFrame(loop);
  });
  // Getting the mic back takes a moment. If pause() or stop() comes in meanwhile, or another resume()
  // starts, the stream that arrives is no longer wanted and must be closed, or the mic stays on.
  let request = 0;
  const release = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());
  return {
    stop() {
      request++;
      cancelAnimationFrame(raf);
      release(stream);
      void ctx.close();
    },
    pause() {
      request++;
      source.disconnect();
      release(stream);
    },
    async resume() {
      const mine = ++request;
      const next = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (mine !== request) return release(next);
      stream = next;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
    },
  };
}
