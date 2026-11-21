# Fretly

A precise tuner and free tab finder for guitar, bass and ukulele. Built for my own iPhone because I got tired of paying for both.

<p align="center">
  <img src="docs/tuner-dark.png" width="300" alt="Fretly tuner, dark theme: A2 in tune, string ticked as tuned" />
  <img src="docs/tuner-light.png" width="300" alt="Fretly tuner, light theme: G3 six cents sharp" />
</p>

> **Vibe-coded.** This app was built through conversation with an AI coding assistant, then tested on a real guitar and a real iPhone. The pitch detection is covered by precision tests, the rest by use.

## Features

**Tuner**
- Sub-cent accuracy: McLeod pitch detection, checked by tests at ±0.5 cent from a 5-string bass low B (31 Hz) to ukulele high G
- Arc meter readable from a distance: the whole screen tints green when the string is in tune
- Automatic string detection, or tap a string to lock it; strings get ticked as you tune them
- Guitar (Standard, Drop D, DADGAD, Open G/D/E, ½ step down, D Standard, Drop C, guitalele), bass (4 and 5 strings, Drop D), ukulele (high G, low G, baritone)
- Custom tunings, saved on the device
- A4 calibration from 430 to 450 Hz
- Raw microphone input (no echo cancellation, noise suppression or auto gain), needle steadied by a median and an exponential moving average

**Tabs**
- One search across Ultimate Guitar and Songsterr, grouped by song
- Ultimate Guitar versions ranked by a vote-weighted rating, so a 5★ tab with 3 votes does not beat a 4.8★ one with 2,500
- Results filtered for the selected instrument
- Chord sheets fit the screen: lyrics wrap with their chords, which stay above the right syllable
- Transposition, remembered text size, auto-scroll with speed control in a thumb-reach toolbar
- Favorites saved in full: they open offline and keep their transposition
- Recent searches

**App**
- Updates itself: every push to `main` is published as a web bundle that installed copies download and apply on next launch
- Light and dark themes, iPhone safe areas

## Install on iPhone (no Mac, no paid developer account)

1. Download `fretly.ipa` from the [`ipa` release](https://github.com/Kirato77/fretly/releases/tag/ipa).
2. Install it with a sideloading tool that signs apps with your own Apple ID, e.g. [SideStore](https://sidestore.io) or [LiveContainer](https://github.com/LiveContainer/LiveContainer) (set up with [iloader](https://github.com/nab138/iloader) from Linux, Windows or macOS).
3. Open Fretly, tap **Start tuner** and allow the microphone.

After that, new versions arrive on their own. A new IPA is only needed when native code changes.

## Development

```sh
npm install
npm run dev        # http://localhost:5173 (the dev server relays tab requests: the sites send no CORS headers)
npm run dev:lan    # HTTPS on your network, to try the tuner in iPhone Safari before building
npm test           # precision tests on synthetic tones, parser tests on recorded page shapes
npm run build
```

Tested with Node 24.

### How it is built

| Path | What |
|---|---|
| `src/tuner/` | Pitch detection (`pitchy`), smoothing, tunings, tuner UI |
| `src/tabs/` | Ultimate Guitar and Songsterr clients and parsers, search, tab viewer |
| `src/updater.ts` | Self-hosted live updates through [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater), no telemetry |
| `ios/` | Capacitor iOS shell |
| `.github/workflows/web.yml` | On push: test, build, publish the web bundle as a release |
| `.github/workflows/ios.yml` | On demand: build the unsigned IPA on a macOS runner |

Stack: [SolidJS](https://www.solidjs.com), [Vite](https://vite.dev), [Capacitor](https://capacitorjs.com), TypeScript, Vitest.

## Disclaimer

Fretly is a personal project, not affiliated with Ultimate Guitar or Songsterr. It reads their public pages and endpoints, which are unofficial, may change at any time, and are subject to their terms of service. Tabs belong to their authors and rights holders; Fretly does not host or redistribute any. Use it for personal practice.

## License

[MIT](LICENSE)
