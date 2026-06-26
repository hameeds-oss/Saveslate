/* =========================================================================
   ui.js — presentation helpers for Ledger. No framework, no build.
   Exposes window.Ledger in the browser; exports pure helpers in Node
   so the chart geometry can be unit-tested.
   ========================================================================= */
(function (root, isNode) {
  "use strict";

  // ---------------- currency ----------------
  var CURRENCIES = {
    USD: { sym: "$",  locale: "en-US" },
    EUR: { sym: "€",  locale: "de-DE" },
    GBP: { sym: "£",  locale: "en-GB" },
    INR: { sym: "₹",  locale: "en-IN" },
    JPY: { sym: "¥",  locale: "ja-JP", noDec: true },
    CAD: { sym: "C$", locale: "en-CA" },
    AUD: { sym: "A$", locale: "en-AU" },
    CHF: { sym: "Fr", locale: "de-CH" },
    CNY: { sym: "¥",  locale: "zh-CN" },
    SGD: { sym: "S$", locale: "en-SG" },
    AED: { sym: "AED",locale: "en-AE" },
    BRL: { sym: "R$", locale: "pt-BR" },
    ZAR: { sym: "R",  locale: "en-ZA" }
  };
  var currency = "USD";

  function loadCurrency() {
    try {
      var s = root.localStorage && root.localStorage.getItem("ledger.currency");
      if (s && CURRENCIES[s]) currency = s;
    } catch (e) {}
  }
  function saveCurrency() {
    try { root.localStorage && root.localStorage.setItem("ledger.currency", currency); } catch (e) {}
  }
  function symbol() { return CURRENCIES[currency].sym; }

  function fmtCurrency(amount, opts) {
    opts = opts || {};
    if (!isFinite(amount)) return "—";
    var c = CURRENCIES[currency];
    var dec = opts.decimals != null ? opts.decimals : (c.noDec ? 0 : (Math.abs(amount) >= 1000 ? 0 : 2));
    try {
      return new Intl.NumberFormat(c.locale, {
        style: "currency", currency: currency,
        minimumFractionDigits: dec, maximumFractionDigits: dec
      }).format(amount);
    } catch (e) {
      return c.sym + Math.round(amount).toLocaleString();
    }
  }
  function fmtNumber(n, dec) {
    if (!isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0
    }).format(n);
  }
  function fmtCompact(n) {
    if (!isFinite(n)) return "—";
    var s = CURRENCIES[currency].sym;
    var abs = Math.abs(n);
    if (abs >= 1e9) return s + (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (abs >= 1e6) return s + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (abs >= 1e3) return s + Math.round(n / 1e3) + "K";
    return s + Math.round(n);
  }
  function fmtMonths(m) {
    if (!isFinite(m)) return "Never";
    var y = Math.floor(m / 12), mo = Math.round(m % 12);
    if (m === 0) return "0 months";
    var parts = [];
    if (y) parts.push(y + (y === 1 ? " yr" : " yrs"));
    if (mo) parts.push(mo + (mo === 1 ? " mo" : " mos"));
    return parts.join(" ") || "0 months";
  }

  // ---------------- pure chart geometry (testable) ----------------
  // points: array of numbers (y values). Returns SVG path strings.
  function buildPaths(values, W, H, pad, minY, maxY) {
    var n = values.length;
    if (n === 0) return { line: "", area: "" };
    var innerW = W - pad.l - pad.r;
    var innerH = H - pad.t - pad.b;
    var span = (maxY - minY) || 1;
    function X(i) { return pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW); }
    function Y(v) { return pad.t + innerH - ((v - minY) / span) * innerH; }
    var line = "", area = "";
    for (var i = 0; i < n; i++) {
      var x = X(i), y = Y(values[i]);
      line += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    }
    area = line + "L" + X(n - 1).toFixed(1) + " " + (pad.t + innerH).toFixed(1) +
           " L" + X(0).toFixed(1) + " " + (pad.t + innerH).toFixed(1) + " Z";
    return { line: line.trim(), area: area.trim(), X: X, Y: Y };
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / mag;
    var nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * mag;
  }

  if (isNode) {
    module.exports = { buildPaths: buildPaths, niceMax: niceMax, fmtMonths: fmtMonths };
    return;
  }

  // ---------------- DOM chart renderer ----------------
  // el: container, series: [{values, color, fill, label}], opts {xLabels}
  function drawChart(el, series, opts) {
    opts = opts || {};
    var W = 520, H = 240, pad = { l: 8, r: 8, t: 14, b: 26 };
    var all = [];
    series.forEach(function (s) { all = all.concat(s.values.filter(isFinite)); });
    if (!all.length) { el.innerHTML = ""; return; }
    var maxY = niceMax(Math.max.apply(null, all));
    var minY = 0;
    var grid = "";
    var gLines = 4;
    for (var g = 0; g <= gLines; g++) {
      var gy = pad.t + (H - pad.t - pad.b) * (g / gLines);
      var val = maxY - (maxY - minY) * (g / gLines);
      grid += '<line x1="' + pad.l + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pad.r) +
              '" y2="' + gy.toFixed(1) + '" stroke="#e1e6e3" stroke-width="1"/>';
      grid += '<text x="' + (W - pad.r) + '" y="' + (gy - 4).toFixed(1) +
              '" text-anchor="end" font-size="10" fill="#79827f" font-family="ui-monospace, monospace">' +
              fmtCompact(val) + '</text>';
    }
    var paths = "";
    series.forEach(function (s, idx) {
      var p = buildPaths(s.values, W, H, pad, minY, maxY);
      var gid = "g" + idx + "_" + Math.random().toString(36).slice(2, 7);
      if (s.fill !== false) {
        paths += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
                 '<stop offset="0%" stop-color="' + s.color + '" stop-opacity="0.18"/>' +
                 '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>';
        paths += '<path d="' + p.area + '" fill="url(#' + gid + ')"/>';
      }
      paths += '<path d="' + p.line + '" fill="none" stroke="' + s.color +
               '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    var xl = "";
    if (opts.xLabels && opts.xLabels.length) {
      var lbls = opts.xLabels, n = lbls.length;
      var pick = [0, Math.floor((n - 1) / 2), n - 1];
      pick.forEach(function (i) {
        var innerW = W - pad.l - pad.r;
        var x = pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
        xl += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) +
              '" text-anchor="middle" font-size="10" fill="#79827f" font-family="ui-monospace, monospace">' +
              lbls[i] + '</text>';
      });
    }
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" preserveAspectRatio="none" style="overflow:visible">' +
                   grid + paths + xl + '</svg>';
  }

  // ---------------- form helpers ----------------
  function parseNum(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }

  // two-way bind a range slider and a number input
  function bindRange(rangeEl, inputEl, onChange) {
    if (!rangeEl || !inputEl) return;
    function fromRange() { inputEl.value = rangeEl.value; onChange && onChange(); }
    function fromInput() {
      var v = parseNum(inputEl.value);
      var min = parseFloat(rangeEl.min), max = parseFloat(rangeEl.max);
      if (v < min) v = min; if (v > max) v = max;
      rangeEl.value = v; onChange && onChange();
    }
    rangeEl.addEventListener("input", fromRange);
    inputEl.addEventListener("input", function () { onChange && onChange(); });
    inputEl.addEventListener("blur", fromInput);
  }

  // ---------------- nav + currency selector wiring ----------------
  var listeners = [];
  function onCurrencyChange(cb) { listeners.push(cb); }
  function setCurrency(c) {
    if (!CURRENCIES[c]) return;
    currency = c; saveCurrency();
    document.querySelectorAll("[data-currency-symbol]").forEach(function (n) { n.textContent = symbol(); });
    listeners.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  function initChrome() {
    loadCurrency();
    // mobile nav
    var toggle = document.querySelector(".nav-toggle");
    var links = document.querySelector(".nav-links");
    if (toggle && links) toggle.addEventListener("click", function () { links.classList.toggle("open"); });
    // currency selector(s)
    document.querySelectorAll("select.currency-select").forEach(function (sel) {
      sel.value = currency;
      sel.addEventListener("change", function () { setCurrency(sel.value); });
    });
    document.querySelectorAll("[data-currency-symbol]").forEach(function (n) { n.textContent = symbol(); });
    // year
    document.querySelectorAll("[data-year]").forEach(function (n) { n.textContent = new Date().getFullYear(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChrome);
  } else { initChrome(); }

  root.Ledger = {
    fmtCurrency: fmtCurrency, fmtNumber: fmtNumber, fmtCompact: fmtCompact, fmtMonths: fmtMonths,
    symbol: symbol, currency: function () { return currency; }, setCurrency: setCurrency,
    onCurrencyChange: onCurrencyChange, drawChart: drawChart, bindRange: bindRange, parseNum: parseNum
  };
})(typeof window !== "undefined" ? window : this, typeof module !== "undefined" && module.exports);
