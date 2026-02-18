# QR Prep

A static GitHub Pages platform for comprehensive quant interview preparation.

Live site: https://alacrity2001.github.io/quant-researcher-prep/

## What this repo is

QR Prep is a frontend-only interview prep product focused on **quant research depth**, not generic puzzle drills.

It combines:
- A large tagged problem bank (`data/problems.json`)
- Multi-page learning UX (`problems`, `explore`, `learn`, `cheatsheet`, `profile`)
- Firebase Auth + Firestore user state (progress, streaks, favorites, collections, achievements)
- KaTeX rendering for math-heavy content

## Current scope

### Product scope
- Quant interview preparation across probability, statistics, finance, coding, and related topics
- Company-specific filtering (150+ firms represented in metadata)
- Progressive learning tracks and topic navigation
- User accounts with progress tracking and gated access tiers

### Technical scope
- **No framework / no build step** (plain HTML/CSS/JS)
- Deployable directly via GitHub Pages from branch contents
- Data served from static JSON files under `data/`
- Firebase compatibility SDKs loaded via CDN

### Data scale (from project docs)
- `problems.json`: ~1.6k+ problems
- `companies.json`: 150+ companies
- Flat-file problem dataset with status fields and dedup fingerprinting strategy

## Repo layout

```text
.
├── index.html
├── problems.html
├── explore.html
├── learn.html
├── cheatsheet.html
├── profile.html
├── css/
├── js/
├── data/
├── notebooks/
└── assets/
```

## Local development

Because this is a static site, you can run it with any static server.

### Option A: Python
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

### Option B: Node
```bash
npx serve .
```

## Core architecture notes

- `js/data-loader.js`: client-side loading/caching of data JSON
- `js/auth.js`: auth state handling, tier logic, and user UI lifecycle
- `js/problems.js`: filtering, listing, and detail rendering for the main bank
- `js/collections.js`, `js/achievements.js`, `js/profile.js`: engagement and user-state features

## Contribution focus areas

High-leverage contribution areas:
- Data quality: deduplication, title cleanup, incomplete solution enrichment
- UX polish: nav consistency, filtering ergonomics, mobile readability
- Performance: large JSON loading and incremental rendering strategies
- Content quality: improving hints/solutions and taxonomy consistency

## Notes

Project-specific operational details and constraints are documented in `AGENTS.md`.
