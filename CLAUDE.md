# Timeless Perspective — Project Context

Personal trading site for David (ex-petroleum exec turned futures trader).
Live at: https://timeless-perspective.vercel.app

## What This Is
Static HTML/React (CDN) site. No build system, no framework, no npm. Vercel serves the files directly.

## Stack
- Pure HTML + inline React 18 (CDN) + Babel standalone
- CSS variables for design tokens (`:root` in each file)
- Google Fonts: Playfair Display, DM Sans, JetBrains Mono
- Vercel static hosting — every push to main auto-deploys

## Pages
| File | Purpose |
|------|---------|
| `index.html` | Homepage |
| `position-sizer.html` | Position sizer |
| `goal-calculator.html` | Goal calculator |
| `goal-reverse-engineer.html` | Goal reverse-engineer |
| `trade-tracker.html` | Trade tracker |
| `streak-explorer.html` | Streak explorer |
| `daily-news.html` | Daily news (auto-updated) |
| `scripts/generate-daily-news.js` | News generation script |

## Automation
GitHub Actions runs `generate-daily-news.js` at 04:00 and 10:00 UTC daily, commits the result to main, Vercel auto-deploys.

## Design System
All design tokens are CSS variables in `:root`. Edit there, not inline.
- `--bg-primary: #0a0b0f` — main background
- `--accent: #d4537e` — rose/pink accent
- `--green: #34c77b`, `--red: #e84057`
- `--font-display`: Playfair Display (headers)
- `--font-body`: DM Sans
- `--font-mono`: JetBrains Mono

## Rules
- No build step — just edit HTML and push
- Keep React components inline in the HTML file they belong to
- No new external dependencies without a good reason
- Vault project folder: `DavidOS/03-projects/timeless-perspective/`
