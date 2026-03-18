/**
 * generate-daily-news.js
 * 
 * Called by GitHub Actions at 4 AM and 10 AM ET (Mon-Fri).
 * Fetches the FREE ForexFactory JSON calendar feed and generates
 * a styled daily-news.html — NO Claude API needed. $0/month.
 * 
 * Data source: https://nfs.faireconomy.media/ff_calendar_thisweek.json
 * Rate limit: 2 requests per 5 minutes (we only call twice/day)
 */

const fs = require('fs');
const https = require('https');

// ── DATE HELPERS ──────────────────────────────────────────────────────────
const now = new Date();
const etOptions = { timeZone: 'America/New_York' };
const todayFormatted = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...etOptions });
const hour = now.toLocaleString('en-US', { hour: 'numeric', hour12: true, ...etOptions });

// Get ET date components reliably (works regardless of server timezone)
function getETComponents(date) {
  const parts = {};
  parts.month = parseInt(date.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric' }));
  parts.day = parseInt(date.toLocaleString('en-US', { timeZone: 'America/New_York', day: 'numeric' }));
  parts.year = parseInt(date.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric' }));
  parts.dow = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
  return parts;
}

const etNow = getETComponents(now);
const todayDow = etNow.dow; // 0=Sun ... 6=Sat

function getWeekDates(offsetWeeks = 0) {
  const refDate = new Date(now.toLocaleString('en-US', etOptions));
  const dow = refDate.getDay();
  const daysToMonday = (dow === 0 ? 6 : dow - 1);
  const mondayMs = refDate.getTime() - (daysToMonday * 86400000) + (offsetWeeks * 7 * 86400000);
  const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  return labels.map((lbl, i) => {
    const d = new Date(mondayMs + i * 86400000);
    const comp = getETComponents(d);
    return { label: lbl, date: `${comp.month}/${comp.day}`, ms: mondayMs + i * 86400000 };
  });
}

const thisWeek = getWeekDates(0);
const nextWeek = getWeekDates(1);

// ── FETCH HELPER (with HTTP status checking + retry) ─────────────────────
function fetchJSON(url, attempt) {
  attempt = attempt || 1;
  return new Promise(function(resolve, reject) {
    console.log('  Fetching ' + url + ' (attempt ' + attempt + ')...');
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradingCalendar/1.0)',
        'Accept': 'application/json'
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode !== 200) {
          var errMsg = 'HTTP ' + res.statusCode + ': ' + data.substring(0, 300);
          if (attempt < 3 && (res.statusCode === 429 || res.statusCode >= 500)) {
            console.log('  Error ' + res.statusCode + ', waiting 30s before retry...');
            setTimeout(function() { fetchJSON(url, attempt + 1).then(resolve).catch(reject); }, 30000);
          } else {
            reject(new Error(errMsg));
          }
          return;
        }
        try {
          var parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('JSON parse failed: ' + e.message + ' raw: ' + data.substring(0, 200)));
        }
      });
    }).on('error', function(err) {
      if (attempt < 3) {
        console.log('  Network error: ' + err.message + ', retrying in 5s...');
        setTimeout(function() { fetchJSON(url, attempt + 1).then(resolve).catch(reject); }, 5000);
      } else {
        reject(err);
      }
    });
  });
}

// ── FORMAT HELPERS (timezone-safe) ────────────────────────────────────────
function formatTime(dateStr) {
  var d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: true
  }) + ' ET';
}

function formatTimeShort(dateStr) {
  var d = new Date(dateStr);
  var str = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  return str.replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
}

function impactClass(impact) {
  if (impact === 'High') return 'badge-critical';
  if (impact === 'Medium') return 'badge-high';
  return 'badge-low';
}

function impactLabel(impact) {
  if (impact === 'High') return 'HIGH IMPACT';
  if (impact === 'Medium') return 'MEDIUM';
  return 'LOW';
}

function getETDateKey(dateStr) {
  var d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function generateCalendar() {
  console.log('Generating Daily News for ' + todayFormatted + ' (' + hour + ' ET run)...');

  // Fetch ForexFactory calendar
  var allEvents;
  var urls = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json'
  ];

  var lastError;
  for (var u = 0; u < urls.length; u++) {
    try {
      allEvents = await fetchJSON(urls[u]);
      console.log('Fetched ' + allEvents.length + ' events from ' + urls[u]);
      break;
    } catch (err) {
      console.log('Failed: ' + err.message);
      lastError = err;
    }
  }

  if (!allEvents) {
    throw new Error('All FF feeds failed. Last error: ' + lastError.message);
  }

  // Filter USD events with High or Medium impact
  var usdEvents = allEvents.filter(function(e) { return e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium'); });
  console.log(usdEvents.length + ' USD high/medium impact events this week');

  // Group by day
  var eventsByDate = {};
  for (var i = 0; i < usdEvents.length; i++) {
    var e = usdEvents[i];
    var dateKey = getETDateKey(e.date);
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(e);
  }

  // Today's events
  var todayKey = String(etNow.month).padStart(2, '0') + '/' + String(etNow.day).padStart(2, '0') + '/' + etNow.year;
  var todayEvents = (eventsByDate[todayKey] || []).sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
  console.log(todayEvents.length + ' USD events today (key: ' + todayKey + ')');

  // Group today's events by time
  var timeGroups = {};
  for (var j = 0; j < todayEvents.length; j++) {
    var evt = todayEvents[j];
    var timeKey = formatTime(evt.date);
    if (!timeGroups[timeKey]) timeGroups[timeKey] = [];
    timeGroups[timeKey].push(evt);
  }

  // Build week strip notes
  function getWeekDayNote(weekDay) {
    var dayDate = new Date(weekDay.ms);
    var dayKey = getETDateKey(dayDate.toISOString());
    var dayEvents = (eventsByDate[dayKey] || []).sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    var highEvents = dayEvents.filter(function(e) { return e.impact === 'High'; });
    var medEvents = dayEvents.filter(function(e) { return e.impact === 'Medium'; });

    if (highEvents.length > 0) {
      return highEvents.map(function(e) {
        var shortName = e.title.replace(/ m\/m| y\/y| q\/q| ytd\/y/gi, '').replace(/Preliminary |Final |Flash |Revised /gi, '').trim();
        return shortName + ' ' + formatTimeShort(e.date);
      }).join(' &middot; ');
    } else if (medEvents.length > 0) {
      return medEvents.slice(0, 2).map(function(e) {
        var shortName = e.title.replace(/ m\/m| y\/y| q\/q| ytd\/y/gi, '').replace(/Preliminary |Final |Flash |Revised /gi, '').trim();
        return shortName + ' ' + formatTimeShort(e.date);
      }).join(' &middot; ');
    }
    return 'No high impact';
  }

  // ── BUILD HTML ────────────────────────────────────────────────────────
  var isWeekend = todayDow === 0 || todayDow === 6;

  // Today's time cards
  var timeCardsHtml = '';
  if (todayEvents.length === 0 && !isWeekend) {
    timeCardsHtml = '<div class="time-card"><div class="time-header"><span class="time-label">No High-Impact USD Events Today</span></div><div style="font-size:13px;color:#9e9e9e;padding:8px 0;">Lower-volatility session expected. Focus on technicals and price action.</div></div>';
  } else if (isWeekend) {
    timeCardsHtml = '<div class="time-card"><div class="time-header"><span class="time-label">Weekend &mdash; Markets Closed</span></div><div style="font-size:13px;color:#9e9e9e;padding:8px 0;">Use this time to review your week, journal your trades, and prepare for next week\'s events below.</div></div>';
  } else {
    var timeKeys = Object.keys(timeGroups);
    for (var tk = 0; tk < timeKeys.length; tk++) {
      var time = timeKeys[tk];
      var events = timeGroups[time];
      var maxImpact = events.some(function(e) { return e.impact === 'High'; }) ? 'High' : 'Medium';
      var dataRows = events.map(function(e) {
        var hasActual = e.actual && e.actual.trim() !== '';
        var actualClass = hasActual ? 'val-actual' : '';
        return '<div class="data-row"><span class="data-name">' + e.title + '</span><span class="data-vals"><span class="val-label">A:</span><span class="' + actualClass + '">' + (hasActual ? e.actual : 'Pending') + '</span><span class="val-label">F:</span><span class="val-forecast">' + (e.forecast || '&mdash;') + '</span><span class="val-label">P:</span><span class="val-prev">' + (e.previous || '&mdash;') + '</span></span></div>';
      }).join('');

      timeCardsHtml += '<div class="time-card"><div class="time-header"><span class="time-label">' + time + '</span><span class="impact-badge ' + impactClass(maxImpact) + '">' + impactLabel(maxImpact) + '</span></div><div class="data-grid">' + dataRows + '</div></div>';
    }
  }

  // Week strip
  var weekStripHtml = thisWeek.map(function(day) {
    var isToday = day.date === (etNow.month + '/' + etNow.day);
    var isPast = day.ms < (new Date(now.toLocaleString('en-US', etOptions)).getTime() - 86400000);
    return '<div class="week-day' + (isToday ? ' today' : '') + '"><span class="day-label">' + day.label + ' ' + day.date + '</span><span class="day-note">' + (isPast && !isToday ? '&#10003; Done' : getWeekDayNote(day)) + '</span></div>';
  }).join('');

  // Next week strip
  var nextWeekHtml = nextWeek.map(function(day) {
    return '<div class="nw-day"><span class="nw-day-label">' + day.label + ' ' + day.date + '</span><span class="nw-event">' + getWeekDayNote(day) + '</span></div>';
  }).join('');

  // Alert box
  var highToday = todayEvents.filter(function(e) { return e.impact === 'High'; });
  var alertHtml = '';
  if (isWeekend) {
    alertHtml = '<div class="alert-box alert-blue"><strong>&#128197; Weekend Preview</strong> &mdash; Markets reopen Sunday 6 PM ET. Review next week\'s calendar below.</div>';
  } else if (highToday.length > 0) {
    var alertItems = highToday.map(function(e) { return e.title + ' at ' + formatTimeShort(e.date); }).join(', ');
    alertHtml = '<div class="alert-box alert-red"><strong>&#128308; RED FOLDER TODAY:</strong> ' + alertItems + '. Expect elevated volatility around these releases.</div>';
  } else if (todayEvents.length > 0) {
    alertHtml = '<div class="alert-box alert-orange"><strong>&#128992; MEDIUM IMPACT:</strong> ' + todayEvents.length + ' scheduled USD release' + (todayEvents.length > 1 ? 's' : '') + ' today. Moderate volatility expected.</div>';
  } else {
    alertHtml = '<div class="alert-box alert-green"><strong>&#9989; CLEAN SESSION:</strong> No high-impact USD events scheduled. Favorable for technical setups.</div>';
  }

  var totalHighThisWeek = usdEvents.filter(function(e) { return e.impact === 'High'; }).length;
  var totalMedThisWeek = usdEvents.filter(function(e) { return e.impact === 'Medium'; }).length;

  // Full HTML
  var html = '<style>.dn-container{max-width:980px;margin:0 auto;background-color:#232323;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;color:#e0e0e0;font-size:14px}.dn-container .header{background:linear-gradient(135deg,#1e3c72 0%,#2a5298 100%);color:#fff;padding:18px 24px;text-align:center}.dn-container .header h1{margin:0;font-size:22px;font-weight:700;color:#fff}.dn-container .header p{margin:5px 0 0;font-size:14px;opacity:.92;color:#fff}.dn-container .alerts-section{padding:14px 18px 10px;background-color:#2a2a2a;border-bottom:1px solid #3a3a3a}.dn-container .alert-box{border-radius:6px;padding:10px 14px;margin-bottom:8px;font-size:13px;line-height:1.45}.dn-container .alert-red{background-color:#3d1a1a;border:2px solid #c62828;color:#ffcdd2}.dn-container .alert-red strong{color:#ff5252;font-size:14px}.dn-container .alert-green{background-color:#1a3d1a;border:1px solid #388e3c;color:#c8e6c9}.dn-container .alert-green strong{color:#69f0ae}.dn-container .alert-orange{background-color:#3d2a00;border:1px solid #f57c00;color:#ffe0b2}.dn-container .alert-orange strong{color:#ffb74d}.dn-container .alert-blue{background-color:#1a2a3d;border-radius:6px;padding:9px 14px;font-size:13px;color:#90caf9;line-height:1.45}.dn-container .week-strip{display:flex;background-color:#2e2e2e;border-bottom:1px solid #3a3a3a;overflow:hidden}.dn-container .week-day{flex:1;text-align:center;padding:8px 4px;font-size:11px;border-right:1px solid #3a3a3a;color:#9e9e9e}.dn-container .week-day:last-child{border-right:none}.dn-container .week-day.today{background-color:#1e3c72;color:#fff;font-weight:700}.dn-container .week-day .day-label{font-size:12px;font-weight:600;display:block;margin-bottom:2px}.dn-container .week-day .day-note{font-size:10px;color:#bdbdbd}.dn-container .week-day.today .day-note{color:#90caf9}.dn-container .main-content{padding:14px}.dn-container .time-card{background-color:#2c2c2c;border:1px solid #3a3a3a;border-radius:7px;padding:12px 14px;margin-bottom:12px}.dn-container .time-header{display:flex;align-items:center;margin-bottom:9px;gap:10px}.dn-container .time-label{font-size:15px;font-weight:700;color:#fff}.dn-container .impact-badge{padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.dn-container .badge-critical{background-color:#c62828;color:#fff}.dn-container .badge-high{background-color:#e65100;color:#fff}.dn-container .badge-low{background-color:#424242;color:#bdbdbd}.dn-container .data-grid{display:grid;grid-template-columns:1fr;gap:5px}.dn-container .data-row{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background-color:#252525;border-radius:4px;font-size:13px}.dn-container .data-name{font-weight:600;color:#e0e0e0;flex:1}.dn-container .data-vals{display:flex;gap:8px;align-items:center;font-size:12px;flex-shrink:0}.dn-container .val-label{color:#757575;font-weight:600;font-size:10px}.dn-container .val-actual{color:#69f0ae;font-weight:700}.dn-container .val-forecast{color:#90caf9}.dn-container .val-prev{color:#9e9e9e}.dn-container .next-week-bar{background-color:#2c2c2c;border:1px solid #3a3a3a;border-radius:7px;padding:12px 14px;margin-bottom:12px}.dn-container .next-week-bar h3{margin:0 0 10px;font-size:14px;color:#90caf9;font-weight:700}.dn-container .nw-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.dn-container .nw-day{background-color:#252525;border-radius:5px;padding:8px 6px;text-align:center}.dn-container .nw-day-label{display:block;font-size:11px;font-weight:700;color:#64b5f6;margin-bottom:4px}.dn-container .nw-event{font-size:10px;color:#bdbdbd;line-height:1.4}.dn-container .dn-footer{padding:10px 18px;background-color:#1e1e1e;border-top:1px solid #3a3a3a;font-size:11px;color:#616161;text-align:center}@media(max-width:640px){.dn-container .week-strip{flex-wrap:wrap}.dn-container .week-day{flex:0 0 33.33%;border-bottom:1px solid #3a3a3a}.dn-container .nw-grid{grid-template-columns:repeat(2,1fr)}.dn-container .data-row{flex-direction:column;align-items:flex-start;gap:4px}.dn-container .data-vals{flex-wrap:wrap}}</style>'
    + '<div class="dn-container">'
    + '<div class="header"><h1>&#128197; USD Economic Calendar</h1><p>' + todayFormatted + ' &mdash; ' + hour + ' ET</p></div>'
    + '<div class="alerts-section">' + alertHtml + '<div class="alert-blue"><strong>&#128202; This Week:</strong> ' + totalHighThisWeek + ' red folder + ' + totalMedThisWeek + ' orange folder USD events. Data sourced from ForexFactory.</div></div>'
    + '<div class="week-strip">' + weekStripHtml + '</div>'
    + '<div class="main-content">' + timeCardsHtml
    + '<div class="next-week-bar"><h3>&#128197; Next Week &mdash; ' + nextWeek[0].label + ' ' + nextWeek[0].date + ' &ndash; ' + nextWeek[4].label + ' ' + nextWeek[4].date + '</h3><div class="nw-grid">' + nextWeekHtml + '</div></div>'
    + '</div>'
    + '<div class="dn-footer">USD Economic Calendar &bull; ' + todayFormatted + ' &bull; Source: ForexFactory &bull; For informational purposes only &mdash; not investment advice</div>'
    + '</div>';

  var output = '<!-- Daily News generated ' + now.toISOString() + ' -->\n<!-- Run: ' + hour + ' ET | Source: ForexFactory JSON (free) | Events: ' + usdEvents.length + ' USD -->\n' + html;
  fs.writeFileSync('daily-news.html', output, 'utf-8');
  console.log('Written daily-news.html (' + (output.length / 1024).toFixed(1) + ' KB) - ' + todayEvents.length + ' events today, ' + usdEvents.length + ' this week');
}

generateCalendar().catch(function(err) {
  console.error('Generation failed:', err.message);
  var fallback = '<!-- Daily News generation failed ' + now.toISOString() + ' -->'
    + '<div style="max-width:980px;margin:0 auto;padding:40px 20px;text-align:center;color:#9e9e9e;font-family:-apple-system,sans-serif;">'
    + '<div style="font-size:48px;margin-bottom:16px;">&#128225;</div>'
    + '<h2 style="color:#e0e0e0;font-size:20px;margin-bottom:8px;">Daily News Updating...</h2>'
    + '<p style="font-size:14px;">Calendar is being refreshed. Check back shortly.</p>'
    + '<p style="font-size:12px;margin-top:16px;color:#666;">Last attempt: ' + todayFormatted + ' ' + hour + ' ET</p>'
    + '<p style="font-size:11px;margin-top:8px;color:#555;">Error: ' + err.message + '</p>'
    + '</div>';
  fs.writeFileSync('daily-news.html', fallback, 'utf-8');
  process.exit(1);
});
