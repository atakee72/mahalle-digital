// @ts-nocheck
// src/lib/clipper/bookmarklet.js — Termin-Clipper v5 (2026-09-26).
// Runs INSIDE a foreign event page (bookmarklet). ES5 only, no template
// literals, no arrow functions, no external script (strict CSPs would block
// a loader; inline bookmarklet code is exempt). Injected into /event-clipper
// via a Vite `?raw` import; __ORIGIN__ is replaced there with the page origin.
// Collects: title, URL, user selection, visible text (capped), and the
// markup hints v2–v4 already found (JSON-LD Event, <time datetime>, venue
// label) — then opens /events/clip with everything in the URL FRAGMENT
// (never sent to a server; no length worries; no cross-origin fetch).
(function () {
  function meta(sel) { var m = document.querySelector(sel); return m ? m.getAttribute('content') : null; }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  var title = clean(meta('meta[property="og:title"]') || document.title || '').slice(0, 300);
  var url = location.href;
  var selection = '';
  try { selection = clean(String(window.getSelection())).slice(0, 3000); } catch (e) {}

  // Visible text: main/article first (less chrome), whole body as fallback.
  var root = document.querySelector('main, article, [role="main"]') || document.body;
  var text = '';
  try { text = clean(root.innerText || root.textContent || ''); } catch (e) {}
  if (text.length < 200 && root !== document.body) { try { text = clean(document.body.innerText || ''); } catch (e) {} }
  text = text.slice(0, 8000);

  // Markup hints (kept from v2–v4): JSON-LD Event → <time datetime> → venue label.
  var hint = {};
  try {
    var sc = document.querySelectorAll('script[type="application/ld+json"]');
    outer: for (var i = 0; i < sc.length; i++) {
      var d = JSON.parse(sc[i].textContent);
      var arr = Array.isArray(d) ? d : (d && d['@graph'] ? d['@graph'] : [d]);
      for (var j = 0; j < arr.length; j++) {
        var n = arr[j];
        if (n && /Event/.test(String(n['@type'])) && n.startDate) {
          var sd = String(n.startDate); hint.from = sd.slice(0, 10);
          if (sd.length >= 16) hint.startTime = sd.slice(11, 16);
          if (n.endDate) { var ed = String(n.endDate); var edd = ed.slice(0, 10); if (edd !== hint.from) hint.to = edd; if (ed.length >= 16) hint.endTime = ed.slice(11, 16); }
          if (n.location) hint.location = clean(n.location.name || (typeof n.location === 'string' ? n.location : '')).slice(0, 200);
          break outer;
        }
      }
    }
  } catch (e) {}
  if (!hint.from) {
    try {
      var ts = document.querySelectorAll('time[datetime]');
      if (ts.length) {
        var d1 = String(ts[0].getAttribute('datetime')); hint.from = d1.slice(0, 10);
        if (d1.length >= 16) hint.startTime = d1.slice(11, 16);
        if (ts.length > 1) { var d2 = String(ts[1].getAttribute('datetime')); var dd2 = d2.slice(0, 10); if (dd2 !== hint.from && /^\d{4}-\d{2}-\d{2}$/.test(dd2)) hint.to = dd2; if (d2.length >= 16) hint.endTime = d2.slice(11, 16); }
      }
    } catch (e) {}
  }
  if (hint.from && !/^\d{4}-\d{2}-\d{2}$/.test(hint.from)) hint = {};
  if (hint.from && !hint.startTime) hint.allDay = true;
  if (!hint.location) {
    try {
      var els = document.querySelectorAll('dt,th,strong,b,h3,h4,h5,div,span,p');
      for (var k = 0; k < els.length; k++) {
        var lt = clean(els[k].textContent);
        if (/^(where|wo|ort|veranstaltungsort|location)$/i.test(lt)) {
          var sib = els[k].nextElementSibling; var lv = sib ? clean(sib.textContent) : '';
          if (lv && lv.length <= 120) { hint.location = lv; break; }
        }
      }
    } catch (e) {}
  }
  if (!hint.location) delete hint.location;

  var payload = { v: 1, title: title, url: url, text: text, selection: selection, hint: hint };
  window.open('__ORIGIN__/events/clip#' + encodeURIComponent(JSON.stringify(payload)), '_blank');
})();
