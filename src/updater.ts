import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { createSignal } from "solid-js";
import { getJson } from "./tabs/http";

// Published by .github/workflows/web.yml on every push to main.
const LATEST = "https://github.com/Kirato77/fretly/releases/latest/download/latest.json";

/** "0.1.<commit unix time>", set at build time by CI; "0.0.0" for local builds. */
export const VERSION: string = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

/** Shown under the tuner, so a failing update says why instead of doing nothing. */
const [status, setStatus] = createSignal("");
const [readyId, setReadyId] = createSignal<string | null>(null);
export { status as updateStatus, readyId as updateReady };

export function isNewer(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Downloads a newer web bundle; the plugin switches to it on the next launch, or now via applyUpdate(). */
export async function checkForUpdate() {
  if (!Capacitor.isNativePlatform()) return;
  // Must come first: without it the plugin assumes this bundle is broken and rolls back.
  await CapacitorUpdater.notifyAppReady();
  try {
    setStatus("checking for updates…");
    const latest = await getJson<{ version: string; url: string }>(LATEST);
    if (!isNewer(latest.version, VERSION)) return setStatus("up to date");
    setStatus(`downloading ${latest.version}…`);
    const bundle = await CapacitorUpdater.download({ url: latest.url, version: latest.version });
    await CapacitorUpdater.next({ id: bundle.id });
    setReadyId(bundle.id);
    setStatus(`${latest.version} ready`);
  } catch (e) {
    setStatus(`update failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Switches to the downloaded bundle right away (reloads the app). */
export const applyUpdate = () => {
  const id = readyId();
  if (id) void CapacitorUpdater.set({ id });
};
