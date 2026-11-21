import { beforeEach, describe, expect, it, vi } from "vitest";
import { startMic } from "../src/tuner/pitch";

// Fakes for the browser audio APIs: every stream handed out is kept, to check which ones are still open.
const streams: { live: boolean; connected: boolean }[] = [];
const pending: ((s: unknown) => void)[] = [];
let instant = true;

function fakeStream() {
  const state = { live: true, connected: false };
  streams.push(state);
  return { state, getTracks: () => [{ stop: () => (state.live = false) }] };
}

class FakeContext {
  sampleRate = 48000;
  async resume() {}
  async close() {}
  createAnalyser() {
    return { fftSize: 0, getFloatTimeDomainData() {} };
  }
  createMediaStreamSource(s: ReturnType<typeof fakeStream>) {
    return { connect: () => (s.state.connected = true), disconnect: () => (s.state.connected = false) };
  }
}

beforeEach(() => {
  streams.length = 0;
  pending.length = 0;
  instant = true;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () => (instant ? Promise.resolve(fakeStream()) : new Promise((r) => pending.push(() => r(fakeStream())))),
    },
  });
});

const flush = () => new Promise((r) => setTimeout(r));
const open = () => streams.filter((s) => s.live);

describe("mic pause / resume", () => {
  it("gives the mic back after a pause", async () => {
    const mic = await startMic(() => {}, () => 440);
    mic.pause();
    await mic.resume();
    expect(streams.map((s) => s.live)).toEqual([false, true]);
    expect(streams[1].connected).toBe(true);
  });

  it("closes a stream that arrives after a new pause (Hear tapped again)", async () => {
    const mic = await startMic(() => {}, () => 440);
    mic.pause();
    instant = false;
    const resuming = mic.resume();
    mic.pause(); // tapped Hear again while iOS was answering
    pending.shift()!(null);
    await resuming;
    expect(open()).toEqual([]);
  });

  it("closes a stream that arrives after stop (tuner tab left)", async () => {
    const mic = await startMic(() => {}, () => 440);
    mic.pause();
    instant = false;
    const resuming = mic.resume();
    mic.stop();
    pending.shift()!(null);
    await resuming;
    expect(open()).toEqual([]);
  });

  it("keeps only the latest stream when two resumes overlap", async () => {
    const mic = await startMic(() => {}, () => 440);
    instant = false;
    mic.pause();
    const first = mic.resume();
    mic.pause();
    const second = mic.resume();
    pending.shift()!(null); // the first answer comes back late
    pending.shift()!(null);
    await Promise.all([first, second]);
    await flush();
    expect(open().length).toBe(1);
    expect(open()[0].connected).toBe(true);
  });
});
