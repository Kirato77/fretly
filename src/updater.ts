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

let busy = false;

/** Downloads a newer web bundle; the plugin switches to it when the app goes to background, or now via applyUpdate(). */
async function checkForUpdate() {
  if (busy || readyId()) return;
  busy = true;
  try {
    setStatus("checking for updates…");
    const latest = await getJson<{ version: string; url: string; checksum: string; sessionKey: string }>(LATEST);
    if (!isNewer(latest.version, VERSION)) return setStatus("up to date");
    setStatus(`downloading ${latest.version}…`);
    // The bundle is encrypted and its SHA-256 signed in CI (scripts/sign-bundle.ts). The plugin opens both with
    // the public key from capacitor.config.ts and refuses to install anything that does not match.
    const { url, version, checksum, sessionKey } = latest;
    const bundle = await CapacitorUpdater.download({ url, version, checksum, sessionKey });
    await CapacitorUpdater.next({ id: bundle.id });
    setReadyId(bundle.id);
    setStatus(`${latest.version} ready`);
  } catch (e) {
    setStatus(`update failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    busy = false;
  }
}

export async function startUpdates() {
  if (!Capacitor.isNativePlatform()) return;
  // Must come first: without it the plugin assumes this bundle is broken and rolls back.
  await CapacitorUpdater.notifyAppReady();
  void checkForUpdate();
  // iOS keeps apps suspended for days instead of relaunching them: check again on every return.
  document.addEventListener("visibilitychange", () => !document.hidden && void checkForUpdate());
}

/** Switches to the downloaded bundle right away (reloads the app). */
export const applyUpdate = () => {
  const id = readyId();
  if (id) void CapacitorUpdater.set({ id });
};
