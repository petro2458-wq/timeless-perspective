/**
 * generate-daily-news.js — Full Daily Briefing Generator
 * 
 * FREE — No API keys required. $0/month.
 * 
 * Data sources:
 *   1. ForexFactory JSON feed → Economic calendar (USD high/medium impact)
 *   2. Yahoo Finance v8 API   → Previous close, pre-market quotes (no auth)
 *   3. Yahoo Finance scraping  → Pre-market movers (gainers/losers)
 * 
 * Called by GitHub Actions at 4 AM and 10 AM ET (Mon-Fri).
 */

var fs = require('fs');
var https = require('https');

// ── DATE HELPERS ──────────────────────────────────────────────────────────
var now = new Date();
var etOptions = { timeZone: 'America/New_York' };
var todayFormatted = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
var hour = now.toLocaleString('en-US', { hour: 'numeric', hour12: true, timeZone: 'America/New_York' });
var shortDate = now.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/New_York' });
var dayName = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });

function getETComponents(date) {
  var parts = {};
  parts.month = parseInt(date.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric' }));
  parts.day = parseInt(date.toLocaleString('en-US', { timeZone: 'America/New_York', day: 'numeric' }));
  parts.year = parseInt(date.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric' }));
  parts.dow = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
  return parts;
}
var etNow = getETComponents(now);
var todayDow = etNow.dow;

function getWeekDates(offsetWeeks) {
  offsetWeeks = offsetWeeks || 0;
  var refDate = new Date(now.toLocaleString('en-US', etOptions));
  var dow = refDate.getDay();
  var daysToMonday = (dow === 0 ? 6 : dow - 1);
  var mondayMs = refDate.getTime() - (daysToMonday * 86400000) + (offsetWeeks * 7 * 86400000);
  var labels = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  return labels.map(function(lbl, i) {
    var d = new Date(mondayMs + i * 86400000);
    var comp = getETComponents(d);
    return { label: lbl, date: comp.month + '/' + comp.day, ms: mondayMs + i * 86400000 };
  });
}
var thisWeek = getWeekDates(0);
var nextWeek = getWeekDates(1);

// ── FETCH HELPERS ─────────────────────────────────────────────────────────
function fetchRaw(url, attempt) {
  attempt = attempt || 1;
  return new Promise(function(resolve, reject) {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        if (res.statusCode !== 200) {
          if (attempt < 3) {
            setTimeout(function() { fetchRaw(url, attempt + 1).then(resolve).catch(reject); }, 3000);
          } else {
            reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
          }
          return;
        }
        resolve(data);
      });
    }).on('error', function(err) {
      if (attempt < 3) {
        setTimeout(function() { fetchRaw(url, attempt + 1).then(resolve).catch(reject); }, 3000);
      } else { reject(err); }
    });
  });
}

function fetchJSON(url) {
  return fetchRaw(url).then(function(data) {
    return JSON.parse(data);
  });
}

// ── YAHOO FINANCE: Get quotes for multiple symbols ────────────────────────
function getYahooQuote(symbol) {
  var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=5d';
  return fetchJSON(url).then(function(data) {
    try {
      var result = data.chart.result[0];
      var meta = result.meta;
      var quotes = result.indicators.quote[0];
      var ts = result.timestamp;
      var len = ts.length;
      // Last complete day
      var close = quotes.close[len - 1] || quotes.close[len - 2];
      var prevClose = quotes.close[len - 2] || quotes.close[len - 3];
      var change = close - prevClose;
      var changePct = (change / prevClose) * 100;
      return {
        symbol: symbol,
        price: close,
        prevClose: prevClose,
        change: change,
        changePct: changePct,
        preMarket: meta.regularMarketPrice || close,
        name: meta.shortName || symbol
      };
    } catch (e) {
      return { symbol: symbol, price: 0, prevClose: 0, change: 0, changePct: 0, preMarket: 0, name: symbol };
    }
  }).catch(function() {
    return { symbol: symbol, price: 0, prevClose: 0, change: 0, changePct: 0, preMarket: 0, name: symbol };
  });
}

// ── YAHOO FINANCE: Get pre-market movers ──────────────────────────────────
function getYahooMovers() {
  // Yahoo Finance gainers/losers - scrape the screener pages
  var gainUrl = 'https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=8';
  var loseUrl = 'https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=8';
  
  return Promise.all([
    fetchJSON(gainUrl).catch(function() { return null; }),
    fetchJSON(loseUrl).catch(function() { return null; })
  ]).then(function(results) {
    var gainers = [];
    var losers = [];
    try {
      if (results[0] && results[0].finance && results[0].finance.result) {
        var gq = results[0].finance.result[0].quotes || [];
        gainers = gq.slice(0, 6).map(function(q) {
          return { symbol: q.symbol, name: (q.shortName || '').substring(0, 20), changePct: q.regularMarketChangePercent || 0, price: q.regularMarketPrice || 0 };
        });
      }
    } catch(e) {}
    try {
      if (results[1] && results[1].finance && results[1].finance.result) {
        var lq = results[1].finance.result[0].quotes || [];
        losers = lq.slice(0, 6).map(function(q) {
          return { symbol: q.symbol, name: (q.shortName || '').substring(0, 20), changePct: q.regularMarketChangePercent || 0, price: q.regularMarketPrice || 0 };
        });
      }
    } catch(e) {}
    return { gainers: gainers, losers: losers };
  });
}

// ── FF CALENDAR HELPERS ───────────────────────────────────────────────────
function formatTime(dateStr) {
  var d = new Date(dateStr);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET';
}
function formatTimeShort(dateStr) {
  var d = new Date(dateStr);
  var str = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
  return str.replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
}
function impactClass(impact) { return impact === 'High' ? 'badge-critical' : impact === 'Medium' ? 'badge-high' : 'badge-low'; }
function impactLabel(impact) { return impact === 'High' ? 'HIGH IMPACT' : impact === 'Medium' ? 'MEDIUM' : 'LOW'; }
function getETDateKey(dateStr) {
  var d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ── FORMAT HELPERS ────────────────────────────────────────────────────────
function fmtPrice(n) { return n ? n.toFixed(2) : '—'; }
function fmtPct(n) { return n ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '—'; }
function colorClass(n) { return n > 0 ? 'up' : n < 0 ? 'down' : 'neutral'; }

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function generateCalendar() {
  console.log('Generating Daily News for ' + todayFormatted + ' (' + hour + ' ET)...');
  var isWeekend = todayDow === 0 || todayDow === 6;

  // ── 1. FETCH FF CALENDAR ────────────────────────────────────────────
  var allEvents = [];
  try {
    allEvents = await fetchJSON('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    console.log('FF: ' + allEvents.length + ' events');
  } catch(e) {
    try { allEvents = await fetchJSON('https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json'); }
    catch(e2) { console.log('FF feeds failed: ' + e2.message); }
  }

  var usdEvents = allEvents.filter(function(e) { return e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium'); });
  var allEventsByDate = {};
  allEvents.forEach(function(e) { var k = getETDateKey(e.date); if (!allEventsByDate[k]) allEventsByDate[k] = []; allEventsByDate[k].push(e); });
  var eventsByDate = {};
  usdEvents.forEach(function(e) { var k = getETDateKey(e.date); if (!eventsByDate[k]) eventsByDate[k] = []; eventsByDate[k].push(e); });

  var todayKey = String(etNow.month).padStart(2,'0') + '/' + String(etNow.day).padStart(2,'0') + '/' + etNow.year;
  var todayEvents = (eventsByDate[todayKey] || []).sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
  console.log('Today: ' + todayEvents.length + ' USD events');

  var timeGroups = {};
  todayEvents.forEach(function(evt) {
    var tk = formatTime(evt.date);
    if (!timeGroups[tk]) timeGroups[tk] = [];
    timeGroups[tk].push(evt);
  });

  // ── 2. FETCH MARKET DATA (Yahoo Finance) ────────────────────────────
  var symbols = ['SPY', 'QQQ', 'DIA', '^VIX', '^TNX', 'CL=F', 'GC=F', 'ES=F', 'NQ=F'];
  var quoteMap = {};
  if (!isWeekend) {
    console.log('Fetching Yahoo quotes...');
    var quotePromises = symbols.map(function(s) { return getYahooQuote(s); });
    var quotes = await Promise.all(quotePromises);
    quotes.forEach(function(q) { quoteMap[q.symbol] = q; });
    console.log('Quotes fetched: ' + Object.keys(quoteMap).length);
  }

  // ── 3. FETCH MOVERS ─────────────────────────────────────────────────
  var movers = { gainers: [], losers: [] };
  if (!isWeekend) {
    console.log('Fetching movers...');
    movers = await getYahooMovers();
    console.log('Movers: ' + movers.gainers.length + ' gainers, ' + movers.losers.length + ' losers');
  }

  // ── BUILD: Week day note helper ─────────────────────────────────────
  function getWeekDayNote(weekDay, isNext) {
    var dayDate = new Date(weekDay.ms);
    var dayKey = getETDateKey(dayDate.toISOString());
    var dayEvts = (eventsByDate[dayKey] || []).sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
    var hi = dayEvts.filter(function(e) { return e.impact === 'High'; });
    var med = dayEvts.filter(function(e) { return e.impact === 'Medium'; });
    if (hi.length > 0) {
      return hi.map(function(e) {
        return e.title.replace(/ m\/m| y\/y| q\/q| ytd\/y/gi,'').replace(/Preliminary |Final |Flash |Revised /gi,'').trim() + ' ' + formatTimeShort(e.date);
      }).join(' &middot; ');
    } else if (med.length > 0) {
      return med.slice(0,2).map(function(e) {
        return e.title.replace(/ m\/m| y\/y| q\/q| ytd\/y/gi,'').replace(/Preliminary |Final |Flash |Revised /gi,'').trim() + ' ' + formatTimeShort(e.date);
      }).join(' &middot; ');
    }
    if (isNext && !(allEventsByDate[dayKey] && allEventsByDate[dayKey].length > 0)) {
      return '<em style="color:#616161">Available Sunday</em>';
    }
    return 'No high impact';
  }

  // ── BUILD: Alert box ────────────────────────────────────────────────
  var highToday = todayEvents.filter(function(e) { return e.impact === 'High'; });
  var alertHtml = '';
  if (isWeekend) {
    alertHtml = '<div class="alert-box alert-blue"><strong>&#128197; Weekend Preview</strong> &mdash; Markets reopen Sunday 6 PM ET.</div>';
  } else if (highToday.length > 0) {
    var items = highToday.map(function(e) { return e.title + ' at ' + formatTimeShort(e.date); }).join(', ');
    alertHtml = '<div class="alert-box alert-red"><strong>&#128308; RED FOLDER TODAY:</strong> ' + items + '. Expect elevated volatility.</div>';
  } else if (todayEvents.length > 0) {
    alertHtml = '<div class="alert-box alert-orange"><strong>&#128992; MEDIUM IMPACT:</strong> ' + todayEvents.length + ' USD release' + (todayEvents.length > 1 ? 's' : '') + ' today.</div>';
  } else {
    alertHtml = '<div class="alert-box alert-green"><strong>&#9989; CLEAN SESSION:</strong> No high-impact USD events. Favorable for technicals.</div>';
  }

  // ── BUILD: Previous Close Recap ─────────────────────────────────────
  function quoteRow(label, sym) {
    var q = quoteMap[sym];
    if (!q || !q.price) return '<div class="recap-row"><strong>' + label + ':</strong> <span class="neutral">&mdash;</span></div>';
    return '<div class="recap-row"><strong>' + label + ':</strong> <span class="' + colorClass(q.changePct) + '">' + fmtPct(q.changePct) + ' &rarr; ' + fmtPrice(q.price) + '</span></div>';
  }

  var recapHtml = '';
  if (!isWeekend && Object.keys(quoteMap).length > 0) {
    recapHtml = '<div class="recap-card"><h3>&#128200; Previous Close Recap</h3>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 20px;">'
      + quoteRow('S&amp;P 500 (SPY)', 'SPY')
      + quoteRow('Nasdaq (QQQ)', 'QQQ')
      + quoteRow('Dow (DIA)', 'DIA')
      + quoteRow('VIX', '^VIX')
      + quoteRow('10Y Yield', '^TNX')
      + quoteRow('WTI Oil', 'CL=F')
      + quoteRow('Gold', 'GC=F')
      + '</div></div>';
  }

  // ── BUILD: Pre-Market Movers sidebar ────────────────────────────────
  var moversHtml = '';
  if (movers.gainers.length > 0 || movers.losers.length > 0) {
    moversHtml = '<div class="side-box"><h3>&#128200; Top Movers</h3>';
    movers.gainers.slice(0,5).forEach(function(m) {
      moversHtml += '<div class="side-item"><span class="ticker">' + m.symbol + '</span> <span class="beat-text">' + fmtPct(m.changePct) + '</span><br><span style="font-size:11px;color:#9e9e9e;">' + m.name + '</span></div>';
    });
    if (movers.losers.length > 0) {
      moversHtml += '<div style="border-top:1px solid #3a3a3a;margin:8px 0;"></div>';
      movers.losers.slice(0,5).forEach(function(m) {
        moversHtml += '<div class="side-item"><span class="ticker">' + m.symbol + '</span> <span class="miss-text">' + fmtPct(m.changePct) + '</span><br><span style="font-size:11px;color:#9e9e9e;">' + m.name + '</span></div>';
      });
    }
    moversHtml += '</div>';
  }

  // ── BUILD: Futures snapshot ─────────────────────────────────────────
  var futuresHtml = '';
  if (!isWeekend) {
    var esQ = quoteMap['ES=F'];
    var nqQ = quoteMap['NQ=F'];
    if (esQ && esQ.price) {
      futuresHtml = '<div class="premarket-card"><h3>&#127963;&#65039; Futures Snapshot</h3><div class="pm-grid">';
      [['ES=F','S&amp;P Futures'], ['NQ=F','Nasdaq Futures'], ['GC=F','Gold'], ['CL=F','WTI Oil'], ['^VIX','VIX'], ['^TNX','10Y Yield']].forEach(function(pair) {
        var q = quoteMap[pair[0]];
        if (q && q.price) {
          futuresHtml += '<div class="pm-item"><span class="pm-label">' + pair[1] + '</span><span class="pm-value ' + colorClass(q.changePct) + '">' + fmtPrice(q.price) + '</span><span class="pm-change ' + colorClass(q.changePct) + '">' + fmtPct(q.changePct) + '</span></div>';
        }
      });
      futuresHtml += '</div></div>';
    }
  }

  // ── BUILD: Time cards (economic calendar) ───────────────────────────
  var timeCardsHtml = '';
  if (todayEvents.length === 0 && !isWeekend) {
    timeCardsHtml = '<div class="time-card"><div class="time-header"><span class="time-label">No High-Impact USD Events Today</span></div><div style="font-size:13px;color:#9e9e9e;padding:8px 0;">Lower-volatility session expected. Focus on technicals and price action.</div></div>';
  } else if (isWeekend) {
    timeCardsHtml = '<div class="time-card"><div class="time-header"><span class="time-label">Weekend &mdash; Markets Closed</span></div><div style="font-size:13px;color:#9e9e9e;padding:8px 0;">Review your week and prepare for next week\'s events below.</div></div>';
  } else {
    Object.keys(timeGroups).forEach(function(time) {
      var events = timeGroups[time];
      var maxImpact = events.some(function(e) { return e.impact === 'High'; }) ? 'High' : 'Medium';
      var rows = events.map(function(e) {
        var hasActual = e.actual && e.actual.trim() !== '';
        return '<div class="data-row"><span class="data-name">' + e.title + '</span><span class="data-vals"><span class="val-label">A:</span><span class="' + (hasActual ? 'val-actual' : '') + '">' + (hasActual ? e.actual : 'Pending') + '</span><span class="val-label">F:</span><span class="val-forecast">' + (e.forecast || '&mdash;') + '</span><span class="val-label">P:</span><span class="val-prev">' + (e.previous || '&mdash;') + '</span></span></div>';
      }).join('');
      timeCardsHtml += '<div class="time-card"><div class="time-header"><span class="time-label">' + time + '</span><span class="impact-badge ' + impactClass(maxImpact) + '">' + impactLabel(maxImpact) + '</span></div><div class="data-grid">' + rows + '</div></div>';
    });
  }

  // ── BUILD: Week strip ───────────────────────────────────────────────
  var weekStripHtml = thisWeek.map(function(day) {
    var isToday = day.date === (etNow.month + '/' + etNow.day);
    var isPast = day.ms < (new Date(now.toLocaleString('en-US', etOptions)).getTime() - 86400000);
    return '<div class="week-day' + (isToday ? ' today' : '') + '"><span class="day-label">' + day.label + ' ' + day.date + '</span><span class="day-note">' + (isPast && !isToday ? '&#10003; Done' : getWeekDayNote(day, false)) + '</span></div>';
  }).join('');

  // ── BUILD: Next week ────────────────────────────────────────────────
  var hasNextWeekData = nextWeek.some(function(day) {
    var dk = getETDateKey(new Date(day.ms).toISOString());
    return allEventsByDate[dk] && allEventsByDate[dk].length > 0;
  });
  var nextWeekHtml = nextWeek.map(function(day) {
    return '<div class="nw-day"><span class="nw-day-label">' + day.label + ' ' + day.date + '</span><span class="nw-event">' + getWeekDayNote(day, true) + '</span></div>';
  }).join('');
  var nwNote = hasNextWeekData ? '' : '<div style="font-size:11px;color:#616161;margin-top:8px;text-align:center;font-style:italic;">Next week\'s calendar updates Sunday evening.</div>';

  var totalHigh = usdEvents.filter(function(e) { return e.impact === 'High'; }).length;
  var totalMed = usdEvents.filter(function(e) { return e.impact === 'Medium'; }).length;

  // ══════════════════════════════════════════════════════════════════════
  // ASSEMBLE FULL HTML
  // ══════════════════════════════════════════════════════════════════════
  var CSS = '<style>.dn-container{max-width:980px;margin:0 auto;background-color:#232323;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#e0e0e0;font-size:14px}.dn-container .header{background:linear-gradient(135deg,#1e3c72 0%,#2a5298 100%);color:#fff;padding:18px 24px;text-align:center}.dn-container .header h1{margin:0;font-size:22px;font-weight:700;color:#fff}.dn-container .header p{margin:5px 0 0;font-size:14px;opacity:.92;color:#fff}.dn-container .alerts-section{padding:14px 18px 10px;background-color:#2a2a2a;border-bottom:1px solid #3a3a3a}.dn-container .alert-box{border-radius:6px;padding:10px 14px;margin-bottom:8px;font-size:13px;line-height:1.45}.dn-container .alert-red{background-color:#3d1a1a;border:2px solid #c62828;color:#ffcdd2}.dn-container .alert-red strong{color:#ff5252;font-size:14px}.dn-container .alert-green{background-color:#1a3d1a;border:1px solid #388e3c;color:#c8e6c9}.dn-container .alert-green strong{color:#69f0ae}.dn-container .alert-orange{background-color:#3d2a00;border:1px solid #f57c00;color:#ffe0b2}.dn-container .alert-orange strong{color:#ffb74d}.dn-container .alert-blue{background-color:#1a2a3d;border-radius:6px;padding:9px 14px;font-size:13px;color:#90caf9;line-height:1.45}.dn-container .week-strip{display:flex;background-color:#2e2e2e;border-bottom:1px solid #3a3a3a;overflow:hidden}.dn-container .week-day{flex:1;text-align:center;padding:8px 4px;font-size:11px;border-right:1px solid #3a3a3a;color:#9e9e9e}.dn-container .week-day:last-child{border-right:none}.dn-container .week-day.today{background-color:#1e3c72;color:#fff;font-weight:700}.dn-container .week-day .day-label{font-size:12px;font-weight:600;display:block;margin-bottom:2px}.dn-container .week-day .day-note{font-size:10px;color:#bdbdbd}.dn-container .week-day.today .day-note{color:#90caf9}.dn-container .main-content{display:flex;padding:14px;gap:14px}.dn-container .left-column{display:flex;flex-direction:column;gap:14px;width:170px;flex-shrink:0}.dn-container .side-box{background-color:#2c2c2c;border:1px solid #3a3a3a;border-radius:7px;padding:11px}.dn-container .side-box h3{margin:0 0 9px;font-size:13px;color:#90caf9;font-weight:700;border-bottom:1px solid #3a3a3a;padding-bottom:5px}.dn-container .side-item{margin-bottom:5px;font-size:12px;line-height:1.4;color:#e0e0e0}.dn-container .ticker{font-weight:700;color:#64b5f6}.dn-container .beat-text{color:#69f0ae}.dn-container .miss-text{color:#ff5252}.dn-container .data-box{flex:1;display:flex;flex-direction:column;gap:12px}.dn-container .recap-card{background-color:#2c2c2c;border:1px solid #3a3a3a;border-radius:7px;padding:12px 14px;font-size:13px}.dn-container .recap-card h3{margin:0 0 8px;font-size:14px;color:#90caf9;font-weight:700}.dn-container .recap-row{margin-bottom:5px;line-height:1.4;color:#e0e0e0}.dn-container .up{color:#69f0ae}.dn-container .down{color:#ff5252}.dn-container .neutral{color:#ffb74d}.dn-container .premarket-card{background-color:#1e2a3d;border:1px solid #2a4a7a;border-radius:7px;padding:12px 14px}.dn-container .premarket-card h3{margin:0 0 10px;font-size:14px;color:#90caf9;font-weight:700}.dn-container .pm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.dn-container .pm-item{background-color:#232e3d;border-radius:5px;padding:7px 9px;font-size:12px}.dn-container .pm-label{color:#9e9e9e;font-size:11px;display:block;margin-bottom:2px}.dn-container .pm-value{font-weight:700;font-size:14px}.dn-container .pm-change{font-size:11px;margin-left:4px}.dn-container .time-card{background-color:#2c2c2c;border:1px solid #3a3a3a;border-radius:7px;padding:12px 14px}.dn-container .time-header{display:flex;align-items:center;margin-bottom:9px;gap:10px}.dn-container .time-label{font-size:15px;font-weight:700;color:#fff}.dn-container .impact-badge{padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.dn-container .badge-critical{background-color:#c62828;color:#fff}.dn-container .badge-high{background-color:#e65100;color:#fff}.dn-container .badge-low{background-color:#424242;color:#bdbdbd}.dn-container .data-grid{display:grid;grid-template-columns:1fr;gap:5px}.dn-container .data-row{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background-color:#252525;border-radius:4px;font-size:13px}.dn-container .data-name{font-weight:600;color:#e0e0e0;flex:1}.dn-container .data-vals{display:flex;gap:8px;align-items:center;font-size:12px;flex-shrink:0}.dn-container .val-label{color:#757575;font-weight:600;font-size:10px}.dn-container .val-actual{color:#69f0ae;font-weight:700}.dn-container .val-forecast{color:#90caf9}.dn-container .val-prev{color:#9e9e9e}.dn-container .next-week-bar{background-color:#1a2a1a;border:1px solid #2e5b2e;border-radius:7px;padding:10px 14px;font-size:12px;color:#c8e6c9}.dn-container .next-week-bar h3{margin:0 0 7px;font-size:13px;color:#81c784;font-weight:700}.dn-container .nw-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.dn-container .nw-day{background-color:#1e3320;border-radius:5px;padding:6px 8px;font-size:11px}.dn-container .nw-day-label{font-weight:700;color:#a5d6a7;display:block;margin-bottom:3px;font-size:12px}.dn-container .nw-event{color:#c8e6c9;line-height:1.3}.dn-container .fed-card{background-color:#2a2200;border:1px solid #5a4800;border-radius:7px;padding:11px 14px;font-size:13px}.dn-container .fed-card h3{margin:0 0 8px;font-size:13px;color:#ffd54f;font-weight:700}.dn-container .dn-footer{padding:10px 18px;background-color:#1e1e1e;border-top:1px solid #2a2a2a;text-align:center;font-size:11px;color:#616161}@media(max-width:640px){.dn-container .main-content{flex-direction:column}.dn-container .left-column{width:100%}.dn-container .week-strip{flex-wrap:wrap}.dn-container .week-day{flex:0 0 33.33%;border-bottom:1px solid #3a3a3a}.dn-container .nw-grid{grid-template-columns:repeat(2,1fr)}.dn-container .pm-grid{grid-template-columns:repeat(2,1fr)}.dn-container .data-row{flex-direction:column;align-items:flex-start;gap:4px}.dn-container .data-vals{flex-wrap:wrap}}</style>';

  var html = CSS
    + '<div class="dn-container">'
    + '<div class="header"><h1>&#128197; USD Economic Calendar</h1><p>' + todayFormatted + ' &mdash; ' + hour + ' ET</p></div>'
    + '<div class="alerts-section">' + alertHtml + '<div class="alert-blue"><strong>&#128202; This Week:</strong> ' + totalHigh + ' red folder + ' + totalMed + ' orange folder USD events.</div></div>'
    + '<div class="week-strip">' + weekStripHtml + '</div>'
    + '<div class="main-content">'
    + '<div class="left-column">' + moversHtml + '</div>'
    + '<div class="data-box">'
    + recapHtml
    + futuresHtml
    + timeCardsHtml
    + '<div class="fed-card"><h3>&#127963;&#65039; Fed Rate Path</h3>'
    + '<div class="recap-row"><strong>Current Rate:</strong> 3.50&ndash;3.75%</div>'
    + '<div class="recap-row"><strong>Next FOMC:</strong> Check forexfactory.com for dates</div>'
    + '</div>'
    + '<div class="next-week-bar"><h3>&#128197; Next Week &mdash; ' + nextWeek[0].label + ' ' + nextWeek[0].date + ' &ndash; ' + nextWeek[4].label + ' ' + nextWeek[4].date + '</h3><div class="nw-grid">' + nextWeekHtml + '</div>' + nwNote + '</div>'
    + '</div></div>'
    + '<div class="dn-footer">USD Economic Calendar &bull; ' + todayFormatted + ' &bull; Sources: ForexFactory, Yahoo Finance &bull; Not investment advice</div>'
    + '</div>';

  var output = '<!-- Daily News generated ' + now.toISOString() + ' -->\n<!-- Run: ' + hour + ' ET | Sources: FF+Yahoo (free, $0) | USD Events: ' + usdEvents.length + ' -->\n' + html;
  fs.writeFileSync('daily-news.html', output, 'utf-8');
  console.log('Written daily-news.html (' + (output.length / 1024).toFixed(1) + ' KB)');
}

generateCalendar().catch(function(err) {
  console.error('Generation failed:', err.message);
  var fallback = '<!-- Daily News generation failed ' + now.toISOString() + ' --><div style="max-width:980px;margin:0 auto;padding:40px 20px;text-align:center;color:#9e9e9e;font-family:-apple-system,sans-serif;"><div style="font-size:48px;margin-bottom:16px;">&#128225;</div><h2 style="color:#e0e0e0;font-size:20px;margin-bottom:8px;">Daily News Updating...</h2><p style="font-size:14px;">Check back shortly.</p><p style="font-size:11px;margin-top:8px;color:#555;">' + err.message + '</p></div>';
  fs.writeFileSync('daily-news.html', fallback, 'utf-8');
  process.exit(1);
});
