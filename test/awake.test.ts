import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let native = true;
let available = true;
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native, isPluginAvailable: () => available },
}));
vi.mock("@capacitor-community/keep-awake", () => ({
  KeepAwake: {
    keepAwake: async () => void calls.push("on"),
    allowSleep: async () => void calls.push("off"),
  },
}));

const { keepAwake } = await import("../src/awake");

describe("keep awake", () => {
  beforeEach(() => {
    calls.length = 0;
    native = true;
    available = true;
  });

  it("stays on while any reason holds, and only calls the plugin on changes", () => {
    keepAwake("tuner", true);
    keepAwake("tab", true); // already on: no call
    keepAwake("tuner", false); // the tab still holds it
    keepAwake("tab", false);
    keepAwake("tab", false); // already off: no call
    expect(calls).toEqual(["on", "off"]);
  });

  it("does nothing on an older IPA without the native plugin", () => {
    available = false;
    keepAwake("metronome", true);
    keepAwake("metronome", false);
    expect(calls).toEqual([]);
  });
});
