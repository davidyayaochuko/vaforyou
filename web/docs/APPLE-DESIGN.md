# Apple Design Resources → Funke

Source: [Apple Design Resources](https://developer.apple.com/design/resources/)

## What’s free and official

| Asset | Format | Use for Funke |
|---|---|---|
| **macOS UI Kit** (current: macOS 27; prior: 26 Tahoe) | Figma + Sketch | **Design authority** for menu bar, dock, windows, widgets, materials, system colors |
| **SF Pro** | Font download | System UI type (kit requires it). On Mac, `-apple-system` already maps to SF Pro |
| **SF Symbols** | Mac app + export | Prefer for menu/toolbar icons when we replace custom paths |
| **Icon Composer** | Mac app | Funke app icon later (Liquid Glass layers) |
| Human Interface Guidelines | Docs | Behavior: menus, materials, accessibility |

Third-party Big Sur kits (e.g. ls.graphics) are unofficial redraws. Prefer Apple’s kit for comps.

## What we cannot do in this repo

Apple’s UI kits are **design libraries**, not npm packages. We do not vendor Apple’s Figma/Sketch files or SF Pro binaries into the git repo (license + size). Code approximates materials and proportions in CSS (`src/styles/bigsur.css`).

## Recommended workflow (you)

1. Open [Apple Design Resources](https://developer.apple.com/design/resources/) → **macOS** → UI Kit (**Figma** or **Sketch**).
2. Accept Apple’s EULA when Figma prompts ([Figma: Apple UI kit](https://help.figma.com/hc/en-us/articles/24037833895831-Get-started-with-Apple-s-UI-kit)).
3. Install [SF Pro](https://developer.apple.com/fonts/) if comps look off.
4. Optional: install [SF Symbols](https://developer.apple.com/sf-symbols/) and export glyphs we need (chat, calendar, mic, speaker).
5. Comp Funke home against **menu bar + dock + widgets + window** frames from the kit; keep the **3D orb** as our custom centerpiece.

## Mapping into Astro (already coded)

| Kit idea | Funke file |
|---|---|
| Menu bar 24pt / status items | `TopBar.astro` + `.topbar` |
| Dock + magnification | `Dock.astro` + `.dock` / `.dock-icon` (22.37% squircle) |
| Widgets | `DesktopWidgets.astro` + `.widget` |
| Windows / traffic lights 12pt | `PanelHost.tsx` + `.panel-window` |
| Segmented control 22pt | `ActionCluster.tsx` + `.action-cluster` |
| Materials / system colors | `styles/bigsur.css` (`--mac-*`) |
| 3D orb (not in Apple kit) | `VoiceOrb.tsx` (water blob + glass shell) |

## Liquid Glass note

macOS 26+ kits emphasize **Liquid Glass** (blur, specular edge, adaptive materials). Our CSS uses strong backdrop-filter + hairline separators as a web stand-in. Full optical refraction stays in native apps / Icon Composer; the orb remains the only real 3D surface.
