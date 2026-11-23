import type { Note } from "./analysis";

// Basic Pitch (Spotify, Apache-2.0) runs on the phone. Its model ships in public/ so it works offline, and
// the TensorFlow code is only loaded when transcribing: the rest of the app stays light.
const MODEL_URL = "models/basic-pitch/model.json";
export const MODEL_RATE = 22050;
export const MAX_SECONDS = 300;

/** Any audio file the system can read (m4a, mp3, wav…), as samples. */
export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }
}

/** Mono, 22.05 kHz: what the model was trained on. The offline context downmixes and resamples in one pass. */
export async function monoSamples(buffer: AudioBuffer): Promise<Float32Array> {
  const seconds = Math.min(buffer.duration, MAX_SECONDS);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * MODEL_RATE), MODEL_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

let engine: Promise<{ run(audio: Float32Array, progress: (p: number) => void): Promise<Note[]> }> | undefined;

function load() {
  engine ??= import("@spotify/basic-pitch").then(({ BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime }) => {
    const model = new BasicPitch(MODEL_URL);
    return {
      async run(audio, progress) {
        const frames: number[][] = [];
        const onsets: number[][] = [];
        const contours: number[][] = [];
        await model.evaluateModel(
          audio,
          (f, o, c) => {
            frames.push(...f);
            onsets.push(...o);
            contours.push(...c);
          },
          progress,
        );
        // Spotify's suggested settings for polyphonic transcription (onset and frame thresholds, min length).
        const events = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)));
        return events.map((e) => ({ start: e.startTimeSeconds, duration: e.durationSeconds, midi: e.pitchMidi, amplitude: e.amplitude }));
      },
    };
  });
  return engine;
}

/** Every note in mono 22.05 kHz samples (see monoSamples). `progress` goes from 0 to 1. */
export async function transcribeSamples(audio: Float32Array, progress: (p: number) => void): Promise<Note[]> {
  const notes = await (await load()).run(audio, progress);
  progress(1);
  return notes;
}
