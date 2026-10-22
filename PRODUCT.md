# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (frontend) in `web/`, mirrors the yusufportfolio pattern (Astro + Tailwind 4 + optional React islands). Existing Node server in `src/server/` remains the API and engine control plane (David). Frontend does not type credentials; API token stays loopback-only.

## Users

Primary: Saint (Yusuf) and operators running Funke locally as a personal VA. Situation: desk or laptop, chatting, reminders, drafts; social engine optional and off by default.

## Product Purpose

Funke is a self-hosted personal assistant: plain-English chat, calendar, reminders, social drafts with approve-before-queue. Runs on the owner's machine. No SaaS required for core chat.

## Positioning

Local-first VA with an optional browser-driven social engine. Nothing posts without approval (and the content gate). Voice cannot approve.

## Operating Context

- Dev: Astro UI (`web/`) + Node control API (`npm run start` on :4310).
- Icons and chrome approach borrowed from yusufportfolio: filled round glyphs, slim top bar, frosted bottom dock.
- Light and dark themes.

## Capabilities and Constraints

- Chat, reminders, local calendar, drafts → approvals → queue.
- Social engine: LinkedIn / X / Bluesky; never auto-starts.
- Frontend home IA: **desktop launcher** (Variant A). Chat and other apps open from the dock as panels.
- Panels may be stubbed until wired to existing APIs.

## Brand Commitments

- Name: **Funke**.
- Voice orb visual reference: cyan→emerald vertical-bar sphere (Siri-like), provided by Saint.
- UI approach: macOS-like home (top bar + dock), solid round icons from the portfolio icon system.
- Accent lineage: Funke green (`#2F6B4F`); do not copy portfolio clay/terracotta as the product accent.

## Evidence on Hand

- Existing dashboard: `src/server/dashboard.ts` (chat-first, to be superseded by Astro shells).
- Portfolio reference: `/Users/yusufibrahim/Developer/yusufportfolio` (`src/lib/icons.ts`, Dock, SiteNav).
- Voice orb reference image in Cursor assets (session).

## Product Principles

1. Approve before anything reaches an account; voice never decides.
2. Home should feel calm and personal, not like an ops dashboard.
3. Frontend owns presentation; backend owns publish, quotas, and sessions.
4. Fail closed on outbound text; missed post beats a bad post.
5. Prefer local defaults; cloud (Groq, Azure TTS, Google) is opt-in and visible.

## Accessibility & Inclusion

Keyboard reach for dock and top bar; visible focus; respect `prefers-reduced-motion` on the voice orb; theme contrast sufficient in light and dark.
