import type { CapacitorConfig } from "@capacitor/cli";

// Public half of the key that signs web bundles (private half: GitHub secret BUNDLE_PRIVATE_KEY).
// The updater refuses any bundle not produced with it. Rotating it needs a new IPA.
const BUNDLE_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAtMta+Eg4UahKOjKfLe0nExXlj4/whNqZbwxr2EjnCu0T1qK6RVV5
H13CuiKAQOI6EBAb2/c6jyXvNiRujyuytEwHVyMBmFh0dGCKm34vtyKPgKrP7u7c
HFwDjci/F/eFrg8Fxza8JOOfZj4t2bEHoxR1Z88VSJFBtR51k2fyDiAOi7OVXOr9
TCumItwx3CQe5Qe8L8yWMa27fkBSI669fhzdHrutD0RZJIo2NnEuT1DdGeWP3PsR
cKO31yEJUIwFc1qXQoM0KdUPAOKU8F//McGyl9EtM8g1V7zrCZrUlCwQF0IYsO8U
DwZ00RNUUf4fibhVCXxXDq2+E85fK+RBrwIDAQAB
-----END RSA PUBLIC KEY-----`;

const config: CapacitorConfig = {
  appId: "dev.kirato.fretly",
  appName: "Fretly",
  webDir: "dist",
  plugins: {
    // Self-hosted updates from GitHub releases, driven by src/updater.ts. No Capgo cloud, no telemetry.
    CapacitorUpdater: { autoUpdate: false, statsUrl: "", publicKey: BUNDLE_PUBLIC_KEY },
  },
};

export default config;
