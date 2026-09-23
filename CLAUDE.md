# Timeless Perspective — Project Context

Personal trading site for David (ex-petroleum exec turned futures trader).
Live at: https://timeless-perspective.vercel.app

## What This Is
Static HTML/React (CDN) site. No build system, no framework, no npm. Vercel serves the files directly.

## Stack
- Pure HTML + inline React 18 (CDN) + Babel standalone
- CSS variables for design tokens (`:root` in each file)
- Google Fonts: Cormorant Garamond (tool pages), DM Sans, JetBrains Mono
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
| `poi-backtest.html` | POI backtest — 1% Club framework research (localStorage now; Supabase config ready) |
| `scripts/generate-daily-news.js` | News generation script |
| `scripts/poi-backtest-schema.sql` | Supabase schema for poi-backtest.html |
| `docs/POI_BACKTEST_HANDOFF.md` | Full handoff for POI backtest build |

## Automation
GitHub Actions runs `generate-daily-news.js` at 04:00 and 10:00 UTC daily, commits the result to main, Vercel auto-deploys.

## Design System
All design tokens are CSS variables in `:root`. Edit there, not inline.

**The homepage and tool pages use different token sets. Follow the tool pages.**

Tool page tokens (use these for any new tool page):
- `--bg-primary: #0a0b0d` — main background
- `--bg-secondary: #111218`
- `--bg-card: #16171e`
- `--border: #222333`, `--border-light: #2a2b3d`
- `--text-primary: #e8e6e1`, `--text-secondary: #9b9aac`, `--text-muted: #5f5e70`
- `--accent: #c9a55a` — gold/amber
- `--accent-dim: #a6863e`, `--accent-glow: rgba(201,165,90,0.12)`
- `--green: #4ecb71`, `--red: #e55b5b`, `--blue: #5b8dee`, `--yellow: #f0c040`
- `--font-display`: Cormorant Garamond (headers)
- `--font-body`: DM Sans
- `--font-mono`: JetBrains Mono

## Rules
- No build step — just edit HTML and push
- Keep React components inline in the HTML file they belong to
- No new external dependencies without a good reason
- Vault project folder: `DavidOS/03-projects/timeless-perspective/`
