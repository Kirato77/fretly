import { Capacitor, CapacitorHttp } from "@capacitor/core";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

// Browser dev: same paths as the relay in vite.config.ts (the sites send no CORS headers).
const RELAY: Record<string, string> = {
  "https://www.ultimate-guitar.com": "/proxy/ug-www",
  "https://tabs.ultimate-guitar.com": "/proxy/ug-tabs",
  "https://www.songsterr.com": "/proxy/songsterr",
  "https://dqsljvtekg760.cloudfront.net": "/proxy/songsterr-cdn",
};

export async function getText(url: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, headers: { "User-Agent": UA }, responseType: "text" });
    if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
    // CapacitorHttp hands back JSON bodies already parsed.
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  }
  const { origin } = new URL(url);
  const res = await fetch(RELAY[origin] + url.slice(origin.length));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export const getJson = async <T>(url: string): Promise<T> => JSON.parse(await getText(url));
