import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Browser dev only: the tab sites send no CORS headers, so the dev server relays them.
// The native app talks to them directly through CapacitorHttp (see src/tabs/http.ts).
const relay = (target: string) => ({
  target,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/proxy\/[^/]+/, ""),
  headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" },
});

export default defineConfig(({ mode }) => ({
  // "lan" mode serves HTTPS on the local network: iOS Safari only grants the mic to secure origins.
  plugins: [solid(), ...(mode === "lan" ? [basicSsl()] : [])],
  server: {
    host: mode === "lan",
    proxy: {
      "/proxy/ug-www/": relay("https://www.ultimate-guitar.com"),
      "/proxy/ug-tabs/": relay("https://tabs.ultimate-guitar.com"),
      "/proxy/songsterr/": relay("https://www.songsterr.com"),
      "/proxy/songsterr-cdn/": relay("https://dqsljvtekg760.cloudfront.net"),
    },
  },
  // TensorFlow + Basic Pitch is one ~1 MB chunk by design, loaded only when transcribing.
  build: { chunkSizeWarningLimit: 1100 },
  test: { environment: "node" },
}));
