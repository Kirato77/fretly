import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { getJson } from "./tabs/http";

// Published by .github/workflows/web.yml on every push to main.
const LATEST = "https://github.com/Kirato77/fretly/releases/latest/download/latest.json";

/** "0.1.<commit unix time>", set at build time by CI; "0.0.0" for local builds. */
export const VERSION: string = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

export function isNewer(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Downloads a newer web bundle; the plugin switches to it the next time the app is relaunched. */
export async function checkForUpdate() {
  if (!Capacitor.isNativePlatform()) return;
  // Must come first: without it the plugin assumes this bundle is broken and rolls back.
  await CapacitorUpdater.notifyAppReady();
  try {
    const latest = await getJson<{ version: string; url: string }>(LATEST);
    if (!isNewer(latest.version, VERSION)) return;
    const bundle = await CapacitorUpdater.download({ url: latest.url, version: latest.version });
    await CapacitorUpdater.next({ id: bundle.id });
  } catch (e) {
    console.warn("Update check failed", e); // offline or no release yet: keep the current version
  }
}
