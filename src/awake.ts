import { KeepAwake } from "@capacitor-community/keep-awake";
import { Capacitor } from "@capacitor/core";

const reasons = new Set<string>();

/**
 * Keeps the screen on while at least one reason holds (tuner listening, tab on screen, metronome running),
 * and gives auto-lock back once none does.
 */
export function keepAwake(reason: string, on: boolean) {
  const before = reasons.size > 0;
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  const after = reasons.size > 0;
  if (before === after) return;
  // IPAs installed before this native plugin still receive this code through live updates: skip what is not there.
  if (Capacitor.isNativePlatform() && !Capacitor.isPluginAvailable("KeepAwake")) return;
  void (after ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
}
