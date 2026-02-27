/**
 * generate-daily-news.js
 * 
 * Called by GitHub Actions at 4 AM and 10 AM ET (Mon-Fri).
 * Calls Claude API with web search to generate a comprehensive
 * daily trading calendar, then writes it as daily-news.html
 * in the repo root for the website to fetch.
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic();

// Get today's date info for the prompt
const now = new Date();
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' };
const todayFormatted = now.toLocaleDateString('en-US', options);
const hour = now.toLocaleString('en-US', { hour: 'numeric', hour12: true, timeZone: 'America/New_York' });

// The EXACT CSS template to enforce consistent formatting
const CSS_TEMPLATE = `
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
</style>`;

// Example HTML structure (abbreviated) to show Claude exactly what format to follow
const HTML_TEMPLATE_EXAMPLE = `
<!-- This is the EXACT structure to follow. Replace content with today's real data. -->
<div class="dn-container">
    <div class="header">
        <h1>USD Economic Calendar</h1>
        <p>Day, M/D &bull; [headline summary of biggest movers/data]</p>
    </div>
    <div class="alerts-section">
        <div class="alert-box alert-red"><strong>[RED ALERT ICON + TITLE]:</strong> [details]</div>
        <div class="alert-box alert-green"><strong>[GREEN BEAT ICON + TITLE]:</strong> [details]</div>
        <div class="alert-box alert-orange"><strong>[ORANGE CAUTION ICON + TITLE]:</strong> [details]</div>
        <div class="alert-blue"><strong>[Context note]:</strong> [key analysis points separated by bullets]</div>
    </div>
    <div class="week-strip">
        <div class="week-day"><span class="day-label">MON M/D</span><span class="day-note">[event]</span></div>
        <!-- ... 5 weekdays, today gets class="week-day today" -->
    </div>
    <div class="earnings-strip">
        <span class="strip-label">RESULTS:</span>
        <span class="earnings-tag tag-beat">TICKER +X% (reason)</span>
        <span class="earnings-tag tag-miss">TICKER -X% (reason)</span>
    </div>
    <div class="main-content">
        <div class="left-column">
            <div class="side-box">
                <h3>📊 Pre-Mkt Movers</h3>
                <div class="side-item"><span class="ticker">TICK</span> <span class="beat-text">+X%</span><br><span style="font-size:11px;color:#9e9e9e;">reason line 1<br>reason line 2</span></div>
            </div>
            <div class="side-box">
                <h3>📅 Key Events</h3>
                <div class="side-item">[events list]</div>
            </div>
        </div>
        <div class="data-box">
            <div class="recap-card"><h3>📉 [Previous Close Recap Title]</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px 20px;">
                    <div class="recap-row"><strong>S&P 500:</strong> <span class="down">-X.XX% → X,XXX</span></div>
                </div>
                <div class="section-note">[analysis quote or context]</div>
            </div>
            <div class="time-card">
                <div class="time-header"><span class="time-label">8:30 AM ET</span><span class="impact-badge badge-critical">CRITICAL</span></div>
                <div class="data-grid">
                    <div class="data-row"><span class="data-name">Data Point</span><span class="data-vals"><span class="val-label">A:</span><span class="val-actual">X.X%</span><span class="val-label">F:</span><span class="val-forecast">X.X%</span><span class="val-label">P:</span><span class="val-prev">X.X%</span></span></div>
                </div>
            </div>
            <div class="fed-card"><h3>🏛️ Fed Rate Path</h3>
                <div class="recap-row"><strong>Current Rate:</strong> X.XX-X.XX%</div>
            </div>
            <div class="next-week-bar"><h3>📅 Next Week — [dates]</h3>
                <div class="nw-grid">
                    <div class="nw-day"><span class="nw-day-label">MON M/D</span><span class="nw-event">[events]</span></div>
                </div>
            </div>
        </div>
    </div>
    <div class="dn-footer">USD Economic Calendar &bull; [Day, Date] &bull; For informational purposes only — not investment advice</div>
</div>`;

async function generateCalendar() {
  console.log(`🗞️ Generating Daily News for ${todayFormatted} (${hour} ET run)...`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content: `You are a trading calendar generator for a day trader's personal website. Today is ${todayFormatted}. The current time is approximately ${hour} ET.

Generate a comprehensive daily trading calendar. Use web search to find CURRENT, REAL data for today.

Search for:
1. Today's US economic calendar / data releases (times, forecasts, previous, actuals if released)
2. Pre-market / after-hours earnings movers (specific tickers, % moves, key numbers)  
3. Key overnight news affecting markets (Fed speakers, geopolitical, policy)
4. US government news (executive orders, legislation, regulatory actions)
5. Major earnings reporting today and this week
6. Any red/orange folder high-impact news events
7. Previous day's close (S&P, Nasdaq, Dow, VIX, 10Y yield, oil)

YOU MUST USE THIS EXACT CSS AND HTML STRUCTURE. Here is the CSS (include this exactly as-is at the top of your output):

${CSS_TEMPLATE}

Here is the HTML structure to follow EXACTLY (replace bracketed content with real data):

${HTML_TEMPLATE_EXAMPLE}

CRITICAL RULES:
- Output MUST start with the <style> block above, then the <div class="dn-container"> structure
- Use ONLY the class names shown above — do not invent new classes or use inline styles for layout
- All alert boxes use: alert-red (critical/hot/miss), alert-green (beats), alert-orange (caution/mixed), alert-blue (info/context)
- Earnings tags use: tag-beat (green), tag-miss (red), tag-mixed (orange), tag-upcoming (blue)
- Price moves use: up (green), down (red), neutral (orange)
- Time cards use impact badges: badge-critical, badge-high, badge-medium, badge-low, badge-actual (for released data)
- Data rows show A: (actual), F: (forecast), P: (previous) — use val-actual for beats, val-actual-miss for misses
- Include 5-10 pre-market movers in the left sidebar
- Include the previous day's close recap with major index levels
- Include Fed Rate Path card
- Include Next Week preview with 5 weekdays
- Every ticker, percentage, and data point must be REAL from your web searches
- If data hasn't been released yet, show forecast with "Pending" for actual
- Include section-note analysis after major cards

If today is Saturday or Sunday, generate a "Weekend Preview" with upcoming week data.

If it's the 4 AM run, focus on pre-market setup. If it's the 10 AM run, include released data actuals.

Output ONLY the HTML starting with <style> and ending with </div>. No markdown, no code fences, no explanation.`
      }
    ]
  });

  // Extract the text content from the response
  let html = '';
  for (const block of message.content) {
    if (block.type === 'text') {
      html += block.text;
    }
  }

  // Clean up any markdown code fences if present
  html = html.replace(/```html?\n?/g, '').replace(/```\n?/g, '').trim();

  // Wrap with metadata comment
  const output = `<!-- Daily News generated ${now.toISOString()} -->
<!-- Run: ${hour} ET | Model: claude-sonnet-4-20250514 -->
${html}`;

  // Write to repo root
  fs.writeFileSync('daily-news.html', output, 'utf-8');
  console.log(`✅ Written daily-news.html (${(output.length / 1024).toFixed(1)} KB)`);
}

generateCalendar().catch(err => {
  console.error('❌ Generation failed:', err.message);
  
  // Write a fallback so the site doesn't break
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
