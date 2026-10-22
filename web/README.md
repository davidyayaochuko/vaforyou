# Funke web UI

Astro frontend. Home is a **macOS-style desktop**: menu bar, corner widgets, dock, open space, and a **3D** voice orb.

## Design reference (official)

Use Apple’s free kits, not third-party Big Sur packs:

- [Apple Design Resources](https://developer.apple.com/design/resources/) → **macOS UI Kit** (Figma / Sketch)
- [SF Pro](https://developer.apple.com/fonts/) · [SF Symbols](https://developer.apple.com/sf-symbols/)
- How we map kit → code: [`docs/APPLE-DESIGN.md`](docs/APPLE-DESIGN.md)

Tokens in `src/styles/bigsur.css` approximate system colors + Liquid Glass materials in CSS. The Figma kit stays in Figma for comps.

## Run

```bash
npm install --prefix web
npm run ui
```

Open **http://127.0.0.1:4330/**

| Route | What |
|---|---|
| `/` | Desktop home |
| `/?panel=chat` | Window panel open |
| `/home`, `/chat` | Redirect into `/` |

**Speak · Talk · Chat** under the orb. Model + engine in the menu bar.

API proxy: `/api/*` → `http://127.0.0.1:4310` when `npm run start` is up.

## Icons

Filled paths in `src/lib/icons.ts` for now. Prefer SF Symbols exports when you pull glyphs from Apple’s app.

## Voice orb

Three.js / R3F barred sphere — only 3D element. Notes: `src/lib/orb-notes.md`.
