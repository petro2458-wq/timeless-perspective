/**
 * generate-daily-news.js
 * 
 * Called by GitHub Actions at 4 AM and 10 AM ET (Mon-Fri).
 * Calls Claude API with web search to generate a comprehensive
 * daily trading calendar, then writes it as daily-news.html
 * in the repo root for the website to fetch.
 * 
 * ARCHITECTURE: Claude generates a JSON data payload, then JS
 * assembles the final HTML from a hardcoded template. This prevents
 * Claude from rewriting dates, structure, or class names.
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic();

// Get today's date info for the prompt
const now = new Date();
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' };
const todayFormatted = now.toLocaleDateString('en-US', options);
const hour = now.toLocaleString('en-US', { hour: 'numeric', hour12: true, timeZone: 'America/New_York' });

// Compute this week's Mon–Fri dates in ET
function getWeekDates(offsetWeeks = 0) {
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = etNow.getDay();
  const daysToMonday = (dow === 0 ? 6 : dow - 1);
  const mondayMs = etNow.getTime() - (daysToMonday * 86400000) + (offsetWeeks * 7 * 86400000);
  const labels = ['MON','TUE','WED','THU','FRI'];
  return labels.map((lbl, i) => {
    const d = new Date(mondayMs + i * 86400000);
    const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' });
    const [m, day] = etStr.split('/');
    return `${lbl} ${m}/${day}`;
  });
}
const thisWeekDays = getWeekDates(0);
const thisWeekLabel = `${thisWeekDays[0]} – ${thisWeekDays[4]}`;
const nextWeekDays = getWeekDates(1);
const nextWeekLabel = `${nextWeekDays[0]} – ${nextWeekDays[4]}`;

const etNowForDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
const todayDow = etNowForDay.getDay();
const todayWeekIndex = todayDow === 0 ? -1 : todayDow - 1;

// ── Escape HTML entities in JSON strings ──
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Build final HTML from JSON data ──
function buildHTML(data) {
  // Week strip
  const weekStripHTML = thisWeekDays.map((dayLabel, i) => {
    const todayClass = i === todayWeekIndex ? ' today' : '';
    const note = (data.weekStrip && data.weekStrip[i]) ? esc(data.weekStrip[i]) : 'No high impact';
    return `        <div class="week-day${todayClass}"><span class="day-label">${dayLabel}</span><span class="day-note">${note}</span></div>`;
  }).join('\n');

  // Next week grid
  const nextWeekHTML = nextWeekDays.map((dayLabel, i) => {
    const evt = (data.nextWeek && data.nextWeek[i]) ? esc(data.nextWeek[i]) : 'No high impact';
    const isHot = evt.toLowerCase().includes('fomc') || evt.toLowerCase().includes('fed') || evt.toLowerCase().includes('nfp') || evt.toLowerCase().includes('cpi');
    return `                    <div class="nw-day"><span class="nw-day-label">${dayLabel}</span><span class="nw-event${isHot ? ' hot' : ''}">${evt}</span></div>`;
  }).join('\n');

  // Alerts
  const alertsHTML = (data.alerts || []).map(a => {
    const cls = a.type === 'red' ? 'alert-red' : a.type === 'green' ? 'alert-green' : a.type === 'orange' ? 'alert-orange' : 'alert-blue';
    const isBox = a.type !== 'blue';
    return `        <div class="${isBox ? 'alert-box ' : ''}${cls}"><strong>${esc(a.title)}:</strong> ${esc(a.detail)}</div>`;
  }).join('\n');

  // Earnings strip
  const earningsHTML = (data.earnings || []).map(e => {
    const cls = e.type === 'beat' ? 'tag-beat' : e.type === 'miss' ? 'tag-miss' : e.type === 'mixed' ? 'tag-mixed' : 'tag-upcoming';
    return `        <span class="earnings-tag ${cls}">${esc(e.text)}</span>`;
  }).join('\n');

  // Pre-market movers
  const moversHTML = (data.movers || []).map(m => {
    const cls = m.pct && m.pct.startsWith('-') ? 'miss-text' : 'beat-text';
    return `                <div class="side-item"><span class="ticker">${esc(m.ticker)}</span> <span class="${cls}">${esc(m.pct)}</span><br><span style="font-size:11px;color:#9e9e9e;">${esc(m.reason)}</span></div>`;
  }).join('\n');

  // Key events sidebar
  const eventsHTML = (data.keyEvents || []).map(e => {
    return `                <div class="side-item">${esc(e)}</div>`;
  }).join('\n');

  // Recap card
  const recap = data.recap || {};
  const recapRows = (recap.rows || []).map(r => {
    const cls = r.direction === 'up' ? 'up' : r.direction === 'down' ? 'down' : 'neutral';
    return `                    <div class="recap-row"><strong>${esc(r.label)}:</strong> <span class="${cls}">${esc(r.value)}</span></div>`;
  }).join('\n');

  // Time cards (economic releases)
  const timeCardsHTML = (data.timeCards || []).map(tc => {
    const badgeCls = tc.impact === 'critical' ? 'badge-critical' : tc.impact === 'high' ? 'badge-high' : tc.impact === 'medium' ? 'badge-medium' : tc.impact === 'actual' ? 'badge-actual' : 'badge-low';
    const rows = (tc.rows || []).map(r => {
      const actualCls = r.isMiss ? 'val-actual-miss' : 'val-actual';
      const actualVal = r.actual || 'Pending';
      return `                    <div class="data-row"><span class="data-name">${esc(r.name)}</span><span class="data-vals"><span class="val-label">A:</span><span class="${actualCls}">${esc(actualVal)}</span><span class="val-label">F:</span><span class="val-forecast">${esc(r.forecast || 'N/A')}</span><span class="val-label">P:</span><span class="val-prev">${esc(r.previous || 'N/A')}</span></span></div>`;
    }).join('\n');
    const note = tc.note ? `\n                <div class="section-note">${esc(tc.note)}</div>` : '';
    return `            <div class="time-card">
                <div class="time-header"><span class="time-label">${esc(tc.time)}</span><span class="impact-badge ${badgeCls}">${esc(tc.impactLabel || tc.impact)}</span></div>
                <div class="data-grid">
${rows}
                </div>${note}
            </div>`;
  }).join('\n');

  // If no time cards (light data day), show a light card
  const lightCardFallback = (data.timeCards || []).length === 0 ? `
            <div class="time-card">
                <div class="time-header"><span class="time-label">Light Data Day</span><span class="impact-badge badge-low">LOW IMPACT</span></div>
                <div class="section-note">${esc(data.lightDayNote || 'No major economic releases scheduled today.')}</div>
            </div>` : '';

  // Fed card
  const fed = data.fed || {};
  const fedRows = (fed.rows || []).map(r => {
    return `                <div class="recap-row"><strong>${esc(r.label)}:</strong> ${esc(r.value)}</div>`;
  }).join('\n');

  return `
<style>
    .dn-container {
        max-width: 980px;
        margin: 0 auto;
        background-color: #232323;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        color: #e0e0e0;
        font-size: 14px;
    }
    .dn-container .header {
        background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
        color: white;
        padding: 18px 24px;
        text-align: center;
    }
    .dn-container .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; }
    .dn-container .header p { margin: 5px 0 0 0; font-size: 14px; opacity: 0.92; color: #ffffff; }
    .dn-container .alerts-section {
        padding: 14px 18px 10px;
        background-color: #2a2a2a;
        border-bottom: 1px solid #3a3a3a;
    }
    .dn-container .alert-box {
        border-radius: 6px;
        padding: 10px 14px;
        margin-bottom: 8px;
        font-size: 13px;
        line-height: 1.45;
    }
    .dn-container .alert-red { background-color: #3d1a1a; border: 2px solid #c62828; color: #ffcdd2; }
    .dn-container .alert-red strong { color: #ff5252; font-size: 14px; }
    .dn-container .alert-green { background-color: #1a3d1a; border: 1px solid #388e3c; color: #c8e6c9; }
    .dn-container .alert-green strong { color: #69f0ae; }
    .dn-container .alert-orange { background-color: #3d2a00; border: 1px solid #f57c00; color: #ffe0b2; }
    .dn-container .alert-orange strong { color: #ffb74d; }
    .dn-container .alert-blue { background-color: #1a2a3d; border-radius: 6px; padding: 9px 14px; font-size: 13px; color: #90caf9; line-height: 1.45; }
    .dn-container .week-strip {
        display: flex;
        background-color: #2e2e2e;
        border-bottom: 1px solid #3a3a3a;
        overflow: hidden;
    }
    .dn-container .week-day {
        flex: 1; text-align: center; padding: 8px 4px;
        font-size: 11px; border-right: 1px solid #3a3a3a; color: #9e9e9e;
    }
    .dn-container .week-day:last-child { border-right: none; }
    .dn-container .week-day.today { background-color: #1e3c72; color: #ffffff; font-weight: 700; }
    .dn-container .week-day .day-label { font-size: 12px; font-weight: 600; display: block; margin-bottom: 2px; }
    .dn-container .week-day .day-note { font-size: 10px; color: #bdbdbd; }
    .dn-container .week-day.today .day-note { color: #90caf9; }
    .dn-container .earnings-strip {
        display: flex; background-color: #252525; border-bottom: 1px solid #3a3a3a;
        padding: 7px 14px; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 12px;
    }
    .dn-container .strip-label { color: #9e9e9e; font-weight: 600; font-size: 11px; white-space: nowrap; }
    .dn-container .earnings-tag { padding: 3px 9px; border-radius: 12px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .dn-container .tag-beat { background-color: #1b5e20; color: #a5d6a7; }
    .dn-container .tag-miss { background-color: #b71c1c; color: #ffcdd2; }
    .dn-container .tag-mixed { background-color: #4a3000; color: #ffe082; }
    .dn-container .tag-upcoming { background-color: #1a2a3d; color: #90caf9; }
    .dn-container .main-content { display: flex; padding: 14px; gap: 14px; }
    .dn-container .left-column { display: flex; flex-direction: column; gap: 14px; width: 170px; flex-shrink: 0; }
    .dn-container .side-box { background-color: #2c2c2c; border: 1px solid #3a3a3a; border-radius: 7px; padding: 11px; }
    .dn-container .side-box h3 { margin: 0 0 9px 0; font-size: 13px; color: #90caf9; font-weight: 700; border-bottom: 1px solid #3a3a3a; padding-bottom: 5px; }
    .dn-container .side-item { margin-bottom: 5px; font-size: 12px; line-height: 1.4; color: #e0e0e0; }
    .dn-container .ticker { font-weight: 700; color: #64b5f6; }
    .dn-container .beat-text { color: #69f0ae; }
    .dn-container .miss-text { color: #ff5252; }
    .dn-container .mixed-text { color: #ffb74d; }
    .dn-container .data-box { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .dn-container .recap-card { background-color: #2c2c2c; border: 1px solid #3a3a3a; border-radius: 7px; padding: 12px 14px; font-size: 13px; }
    .dn-container .recap-card h3 { margin: 0 0 8px 0; font-size: 14px; color: #90caf9; font-weight: 700; }
    .dn-container .recap-row { margin-bottom: 5px; line-height: 1.4; color: #e0e0e0; }
    .dn-container .up { color: #69f0ae; }
    .dn-container .down { color: #ff5252; }
    .dn-container .neutral { color: #ffb74d; }
    .dn-container .time-card { background-color: #2c2c2c; border: 1px solid #3a3a3a; border-radius: 7px; padding: 12px 14px; }
    .dn-container .time-header { display: flex; align-items: center; margin-bottom: 9px; gap: 10px; }
    .dn-container .time-label { font-size: 15px; font-weight: 700; color: #ffffff; }
    .dn-container .impact-badge { padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .dn-container .badge-critical { background-color: #c62828; color: #ffffff; }
    .dn-container .badge-high { background-color: #e65100; color: #ffffff; }
    .dn-container .badge-medium { background-color: #f57f17; color: #000000; }
    .dn-container .badge-low { background-color: #424242; color: #bdbdbd; }
    .dn-container .badge-actual { background-color: #1b5e20; color: #a5d6a7; }
    .dn-container .data-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px 16px; }
    .dn-container .data-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #333; font-size: 13px; }
    .dn-container .data-row:last-child { border-bottom: none; }
    .dn-container .data-name { color: #e0e0e0; font-weight: 500; }
    .dn-container .data-vals { display: flex; gap: 10px; font-size: 12px; }
    .dn-container .val-actual { color: #69f0ae; font-weight: 700; }
    .dn-container .val-actual-miss { color: #ff5252; font-weight: 700; }
    .dn-container .val-forecast { color: #64b5f6; }
    .dn-container .val-prev { color: #9e9e9e; }
    .dn-container .val-label { font-size: 10px; color: #757575; margin-right: 2px; }
    .dn-container .section-note { margin-top: 8px; font-size: 11px; color: #9e9e9e; line-height: 1.4; border-top: 1px solid #333; padding-top: 6px; }
    .dn-container .next-week-bar { background-color: #1a2a1a; border: 1px solid #2e5b2e; border-radius: 7px; padding: 10px 14px; font-size: 12px; color: #c8e6c9; }
    .dn-container .next-week-bar h3 { margin: 0 0 7px 0; font-size: 13px; color: #81c784; font-weight: 700; }
    .dn-container .nw-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
    .dn-container .nw-day { background-color: #1e3320; border-radius: 5px; padding: 6px 8px; font-size: 11px; }
    .dn-container .nw-day-label { font-weight: 700; color: #a5d6a7; display: block; margin-bottom: 3px; font-size: 12px; }
    .dn-container .nw-event { color: #c8e6c9; line-height: 1.3; }
    .dn-container .nw-event.hot { color: #ff5252; font-weight: 700; }
    .dn-container .fed-card { background-color: #2a2200; border: 1px solid #5a4800; border-radius: 7px; padding: 11px 14px; font-size: 13px; }
    .dn-container .fed-card h3 { margin: 0 0 8px 0; font-size: 13px; color: #ffd54f; font-weight: 700; }
    .dn-container .dn-footer { background-color: #1e1e1e; padding: 10px 18px; text-align: center; font-size: 11px; color: #616161; border-top: 1px solid #2a2a2a; }
    @media (max-width: 768px) {
        .dn-container .main-content { flex-direction: column; }
        .dn-container .left-column { width: 100%; }
        .dn-container .nw-grid { grid-template-columns: repeat(2, 1fr); }
        .dn-container .data-grid { grid-template-columns: 1fr; }
    }
</style>

<div class="dn-container">
    <div class="header">
        <h1>USD Economic Calendar</h1>
        <p>${todayFormatted} &bull; ${esc(data.headline || '')}</p>
    </div>
    <div class="alerts-section">
${alertsHTML}
    </div>
    <div class="week-strip">
${weekStripHTML}
    </div>
    <div class="earnings-strip">
        <span class="strip-label">EARNINGS:</span>
${earningsHTML}
    </div>
    <div class="main-content">
        <div class="left-column">
            <div class="side-box">
                <h3>📊 Pre-Mkt Movers</h3>
${moversHTML}
            </div>
            <div class="side-box">
                <h3>📅 Key Events</h3>
${eventsHTML}
            </div>
        </div>
        <div class="data-box">
            <div class="recap-card"><h3>📉 ${esc(recap.title || 'Previous Close')}</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px 20px;">
${recapRows}
                </div>
                <div class="section-note">${esc(recap.note || '')}</div>
            </div>
${timeCardsHTML}${lightCardFallback}
            <div class="fed-card"><h3>🏛️ Fed Rate Path</h3>
${fedRows}
            </div>
            <div class="next-week-bar"><h3>📅 Next Week — ${nextWeekLabel}</h3>
                <div class="nw-grid">
${nextWeekHTML}
                </div>
            </div>
        </div>
    </div>
    <div class="dn-footer">USD Economic Calendar &bull; ${todayFormatted} &bull; For informational purposes only — not investment advice</div>
</div>`;
}


async function generateCalendar() {
  console.log(`🗞️ Generating Daily News for ${todayFormatted} (${hour} ET run)...`);
  console.log(`   This week: ${thisWeekLabel}`);
  console.log(`   Next week: ${nextWeekLabel}`);
  console.log(`   Today index: ${todayWeekIndex} (0=Mon)`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content: `You are a trading calendar data researcher. Today is ${todayFormatted}. The current time is approximately ${hour} ET.

Your job is to search the web for current market data and return a SINGLE JSON object. Do NOT generate HTML. Output ONLY valid JSON.

RESEARCH STEPS:

STEP 1 — ECONOMIC CALENDAR (do this FIRST, do MULTIPLE searches):
Search 1: "forexfactory.com calendar this week" or "investing.com economic calendar USD this week" to find ALL red/orange USD events for ${thisWeekLabel}.
Search 2: "forexfactory.com calendar next week" or "US economic calendar next week ${nextWeekLabel}" to find ALL red/orange USD events for ${nextWeekLabel}.
Search 3: If any day still has unclear events, search specifically: "US economic data releases [date]"

KNOWN RECURRING USD EVENTS — use as a SAFETY NET, not a limit:
These events happen on predictable schedules. After your searches, cross-check your results against this list. If your search missed any that should fall this week or next week, do a targeted search for that specific event. But ALSO include any events your search finds that are NOT on this list — this list is a floor, not a ceiling.

WEEKLY (every week):
- Initial Jobless Claims — every Thursday 8:30a ET (red folder)
- Continuing Jobless Claims — every Thursday 8:30a ET (orange folder)
- Crude Oil Inventories — every Wednesday 10:30a ET (orange folder)
- Natural Gas Storage — every Thursday 10:30a ET (orange folder)

MONTHLY (once per month, verify exact date via search):
- Nonfarm Payrolls + Unemployment Rate — first Friday of month, 8:30a ET (red folder)
- CPI + Core CPI — around 10th-14th of month, 8:30a ET (red folder)
- PPI + Core PPI — around 13th-16th of month, 8:30a ET (red folder)
- Retail Sales + Core Retail Sales — around 14th-17th of month, 8:30a ET (red folder)
- JOLTS Job Openings — around 1st-10th of month, 10:00a ET (red folder)
- ISM Manufacturing PMI — 1st business day of month, 10:00a ET (red folder)
- ISM Services PMI — 3rd business day of month, 10:00a ET (red folder)
- Consumer Confidence (CB) — last Tuesday of month, 10:00a ET (orange folder)
- Michigan Consumer Sentiment — mid-month (prelim) + end of month (final), 10:00a ET (orange folder)
- Housing Starts + Building Permits — around 17th-20th of month, 8:30a ET (orange folder)
- Existing Home Sales — around 20th-24th of month, 10:00a ET (orange folder)
- New Home Sales — around 23rd-27th of month, 10:00a ET (orange folder)
- Durable Goods Orders — around 25th-28th of month, 8:30a ET (orange folder)
- PCE Price Index + Core PCE — last Friday of month, 8:30a ET (red folder)
- GDP (advance/second/third) — quarterly, usually end of month, 8:30a ET (red folder)
- Personal Income + Personal Spending — end of month, 8:30a ET (orange folder)
- Empire State Manufacturing — around 15th, 8:30a ET (orange folder)
- Philly Fed Manufacturing — 3rd Thursday, 8:30a ET (orange folder)
- Industrial Production — around mid-month, 9:15a ET (orange folder)
- ADP Nonfarm Employment — 2 days before NFP, 8:15a ET (orange folder)
- Trade Balance — around 5th-7th of month, 8:30a ET (orange folder)

FED EVENTS (scheduled, 8 per year):
- FOMC Rate Decision — 2:00p ET (red folder)
- FOMC Press Conference — 2:30p ET (red folder)
- FOMC Meeting Minutes — 3 weeks after decision, 2:00p ET (orange folder)
- Fed Chair speeches/testimony — varies (red folder when scheduled)

For each event found: record exact ET release time, event name, forecast, previous, actual (if released).

IMPORTANT: "No high impact" should be RARE. Most weekdays have at least one notable event. Unemployment Claims alone happens EVERY Thursday at 8:30a. Crude Oil Inventories happens EVERY Wednesday at 10:30a. If you're returning "No high impact" for Thursday or Wednesday, you almost certainly missed data. Do another search.

STEP 2 — Search for:
- Pre-market movers (tickers, % change, brief reason) — search "premarket movers today" or "stock futures today"
- Previous day close: S&P 500, Nasdaq, Dow, VIX, 10Y yield, WTI oil
- Key earnings results and upcoming earnings this week
- Major overnight/geopolitical news
- Current fed funds rate and next FOMC meeting date

Return this EXACT JSON structure (no markdown, no code fences, no explanation — ONLY the JSON):

{
  "headline": "One-line summary of today's biggest story",
  "alerts": [
    {"type": "red|green|orange|blue", "title": "⚠️ ALERT TITLE", "detail": "Alert details"}
  ],
  "weekStrip": [
    "EventName H:MMa · EventName H:MMa",
    "EventName H:MMa",
    "CPI 8:30a",
    "Jobless Claims 8:30a · Philly Fed 8:30a",
    "PPI 8:30a · Retail Sales 8:30a"
  ],
  "nextWeek": [
    "Empire State 8:30a",
    "FOMC 2:00p · Retail Sales 8:30a",
    "Housing Starts 8:30a",
    "Jobless Claims 8:30a · Philly Fed 8:30a",
    "Existing Home Sales 10:00a"
  ],
  "earnings": [
    {"type": "beat|miss|mixed|upcoming", "text": "ORCL +5% (cloud revenue beat)"}
  ],
  "movers": [
    {"ticker": "TSLA", "pct": "+2.1%", "reason": "Tech recovery trade"}
  ],
  "keyEvents": [
    "CPI inflation Wednesday 8:30a",
    "FOMC meeting next week 3/17-18"
  ],
  "recap": {
    "title": "Monday's Session Recap",
    "rows": [
      {"label": "S&P 500", "value": "+0.83% → 6,740", "direction": "up"},
      {"label": "Nasdaq", "value": "+1.38% → 22,387", "direction": "up"},
      {"label": "Dow Jones", "value": "+0.50% → 47,241", "direction": "up"},
      {"label": "VIX", "value": "28.6 (-14%)", "direction": "down"},
      {"label": "10Y Yield", "value": "4.10%", "direction": "neutral"},
      {"label": "WTI Oil", "value": "$94.77 (+4.26%)", "direction": "up"}
    ],
    "note": "Brief analysis of yesterday's session"
  },
  "timeCards": [
    {
      "time": "8:30 AM ET",
      "impact": "critical",
      "impactLabel": "CRITICAL",
      "rows": [
        {"name": "CPI m/m", "actual": "0.3%", "forecast": "0.3%", "previous": "0.5%", "isMiss": false},
        {"name": "Core CPI m/m", "actual": null, "forecast": "0.3%", "previous": "0.4%", "isMiss": false}
      ],
      "note": "Brief analysis"
    }
  ],
  "lightDayNote": "No major economic releases today. Markets focused on...",
  "fed": {
    "rows": [
      {"label": "Current Rate", "value": "3.50-3.75%"},
      {"label": "Next Meeting", "value": "March 17-18, 2026"},
      {"label": "Expected Action", "value": "Hold rates steady"},
      {"label": "Market Pricing", "value": "25bp cut probability rising"}
    ]
  }
}

CRITICAL RULES FOR weekStrip AND nextWeek ARRAYS:
- weekStrip MUST have EXACTLY 5 elements (Mon through Fri of this week: ${thisWeekLabel})
- nextWeek MUST have EXACTLY 5 elements (Mon through Fri of next week: ${nextWeekLabel})
- Each element = that day's red folder events in format "EventName H:MMa" with · separator for multiple
- Examples: "CPI 8:30a · Retail Sales 8:30a" or "FOMC 2:00p" or "No high impact"
- NEVER use vague labels like "Oil Shock" or "Recovery" or "CPI Data" — ALWAYS include the release time
- If no red folder events, show the most notable orange folder event with its time
- If neither, use "No high impact"

CRITICAL RULES FOR timeCards:
- Create a SEPARATE timeCard for each distinct release time today
- If today is a light data day with no red/orange events, leave timeCards as empty array [] and fill lightDayNote
- "actual" should be null if not yet released (will display as "Pending")
- Set "isMiss" to true if actual missed forecast in a negative direction

CRITICAL: Output ONLY the JSON object. No markdown code fences. No explanation. No HTML. Just the raw JSON starting with { and ending with }.`
      }
    ]
  });

  // Extract JSON from response
  let jsonStr = '';
  for (const block of message.content) {
    if (block.type === 'text') {
      jsonStr += block.text;
    }
  }

  // Clean up potential markdown fences
  jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();

  console.log(`📋 Raw JSON length: ${jsonStr.length} chars`);

  let data;
  try {
    data = JSON.parse(jsonStr);
    console.log('✅ JSON parsed successfully');
    console.log(`   weekStrip entries: ${(data.weekStrip || []).length}`);
    console.log(`   nextWeek entries: ${(data.nextWeek || []).length}`);
    console.log(`   timeCards: ${(data.timeCards || []).length}`);
    console.log(`   movers: ${(data.movers || []).length}`);
  } catch (e) {
    console.error('❌ JSON parse failed:', e.message);
    console.error('First 500 chars:', jsonStr.substring(0, 500));
    throw new Error('Failed to parse Claude JSON response');
  }

  // Validate weekStrip and nextWeek have 5 entries
  if (!data.weekStrip || data.weekStrip.length !== 5) {
    console.warn(`⚠️ weekStrip has ${(data.weekStrip || []).length} entries, padding to 5`);
    data.weekStrip = data.weekStrip || [];
    while (data.weekStrip.length < 5) data.weekStrip.push('No high impact');
    data.weekStrip = data.weekStrip.slice(0, 5);
  }
  if (!data.nextWeek || data.nextWeek.length !== 5) {
    console.warn(`⚠️ nextWeek has ${(data.nextWeek || []).length} entries, padding to 5`);
    data.nextWeek = data.nextWeek || [];
    while (data.nextWeek.length < 5) data.nextWeek.push('No high impact');
    data.nextWeek = data.nextWeek.slice(0, 5);
  }

  // Build HTML from template + data
  const html = buildHTML(data);

  const output = `<!-- Daily News generated ${now.toISOString()} -->
<!-- Run: ${hour} ET | Model: claude-sonnet-4-20250514 | Architecture: JSON→HTML -->
${html}`;

  fs.writeFileSync('daily-news.html', output, 'utf-8');
  console.log(`✅ Written daily-news.html (${(output.length / 1024).toFixed(1)} KB)`);
}

generateCalendar().catch(err => {
  console.error('❌ Generation failed:', err.message);
  
  const fallback = `<!-- Daily News generation failed ${now.toISOString()} -->
<div style="max-width:980px;margin:0 auto;padding:40px 20px;text-align:center;color:#9e9e9e;font-family:-apple-system,sans-serif;">
  <div style="font-size:48px;margin-bottom:16px;">📡</div>
  <h2 style="color:#e0e0e0;font-size:20px;margin-bottom:8px;">Daily News Updating...</h2>
  <p style="font-size:14px;">Calendar is being refreshed. Check back shortly.</p>
  <p style="font-size:12px;margin-top:16px;color:#666;">Last attempt: ${todayFormatted} ${hour} ET</p>
</div>`;
  
  fs.writeFileSync('daily-news.html', fallback, 'utf-8');
  process.exit(1);
});
