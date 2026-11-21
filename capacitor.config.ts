import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.kirato.fretly",
  appName: "Fretly",
  webDir: "dist",
  plugins: {
    // Self-hosted updates from GitHub releases, driven by src/updater.ts. No Capgo cloud, no telemetry.
    CapacitorUpdater: { autoUpdate: false, statsUrl: "" },
  },
};

export default config;
