import { Preferences } from "@capacitor/preferences";

// Preferences = native key-value store on iOS/Android (WKWebView localStorage can be purged), localStorage on web.
export async function load<T>(key: string, fallback: T): Promise<T> {
  const { value } = await Preferences.get({ key });
  try {
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

export const save = (key: string, value: unknown) => Preferences.set({ key, value: JSON.stringify(value) });

export const remove = (key: string) => Preferences.remove({ key });
