# Funke web UI

Astro + React frontend. The home screen is a desktop: menu bar, corner widgets, a
dock, and a 3D voice orb (Three.js with React Three Fiber).

## Run

In production the Node server serves the built UI. From the repo root:

```bash
npm run build
npm run start      # http://localhost:4310
```

For UI work, run the dev server with hot reload next to the API:

```bash
npm run dev        # API on :4310
npm run ui         # UI on http://127.0.0.1:4330, proxies /api to :4310
```

The dev proxy reads `API_TOKEN` from the root `.env` and adds it to every `/api`
request.

| Route | What |
|---|---|
| `/` | Desktop home |
| `/?panel=<name>` | Opens a panel: `chat`, `tasks`, `calendar`, `approvals`, `socials`, `settings` |

## Where things live

| Path | What |
|---|---|
| `src/components/PanelHost.tsx` | Opens and closes panels |
| `src/components/panels/` | One component per panel |
| `src/lib/dock.ts` | The app list: titles, icons, which apps are live |
| `src/lib/api.ts` | Typed client for the control API |
| `src/lib/voice*.ts` | Mic, voice activity detection, noise suppression, speech |
| `src/lib/icons.ts` | Filled 24x24 icon paths |
| `src/styles/` | Design tokens and component styles |
