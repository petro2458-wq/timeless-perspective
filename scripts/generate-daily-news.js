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

Generate a comprehensive daily trading calendar as a COMPLETE, SELF-CONTAINED HTML snippet (just the inner content — NO <html>, <head>, <body>, or <style> tags — just a single <div> with inline styles or embedded <style> within).

Use web search to find CURRENT, REAL data for today. Search for:
1. Today's US economic calendar / data releases (times, forecasts, previous, actuals if released)
2. Pre-market / after-hours earnings movers (specific tickers, % moves, key numbers)
3. Key overnight news affecting markets (Fed speakers, geopolitical, policy)
4. US government news (executive orders, legislation, regulatory actions)
5. Major earnings reporting today and this week
6. Futures pre-market levels if available (ES, NQ, RTY, YM, Gold, Oil)
7. Any red/orange folder high-impact news events

FORMAT REQUIREMENTS:
- Dark theme: background #232323, text #e0e0e0, accent blue #1e3c72/#2a5298
- Use the exact visual style: rounded cards, color-coded alerts (red for hot/miss, green for beat, orange for caution, blue for info)
- Include these sections:
  • Header with date and day of week
  • TOP ALERTS: Red/orange breaking items (hot data, sell-the-news, major misses/beats)
  • Week strip showing Mon-Fri with today highlighted
  • Earnings strip with beat/miss/upcoming tags
  • Left sidebar: Pre-market movers (ticker, % change, 1-line reason) + Key Events
  • Main area: Time-based economic data cards (8:30 AM, 10:00 AM, etc.) with forecast/actual/previous
  • Pre-market futures grid (ES, NQ, RTY, YM, Gold, Oil with levels and % change)
  • Fed/Macro recap box (current rate, fed chair, next FOMC, tariff status)
  • Next week preview strip
  • Footer with disclaimer

- Color coding: 
  - Beats/positive: #69f0ae green, bg #1a3d1a
  - Misses/negative: #ff5252 red, bg #3d1a1a  
  - Caution/mixed: #ffb74d orange, bg #3d2a00
  - Info/neutral: #90caf9 blue, bg #1a2a3d
  - Impact badges: CRITICAL (red #c62828), HIGH (orange #e65100), MEDIUM (yellow #f57f17), LOW (gray #424242)

- Max width 980px, mobile responsive
- All styles must be INLINE or in a <style> tag within your output div
- The output will be injected into a container on the website

If today is a weekend (Saturday/Sunday), generate a "Weekend Preview" instead:
- Show the upcoming week's calendar
- Major earnings for next week  
- Any weekend developments
- "Markets closed — back Monday" header

If it's the 4 AM run (before market), focus on pre-market setup and what to watch.
If it's the 10 AM run (during market), include any released data actuals and morning price action.

CRITICAL: Use REAL current data from your web searches. Do not fabricate numbers. If you can't find a specific data point, note it as "TBD" or "Pending". Every ticker, percentage, and data release must be factual.

Output ONLY the HTML. No markdown, no code fences, no explanation.`
      }
    ]
  });

  // Extract the text content from the response (may have multiple content blocks due to tool use)
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
