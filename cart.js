// cart.js — loadable by both the browser (window.Cart) and node --test
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'pce_cart';
  var MAX = 99;

  function clamp(n) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, MAX);
  }

  function read(storage) {
    var raw;
    try { raw = storage.getItem(KEY); } catch (e) { return []; }
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var row = parsed[i];
      if (!row || typeof row.variationId !== 'string') continue;
      var qty = clamp(row.qty);
      if (qty > 0) out.push({ variationId: row.variationId, qty: qty });
    }
    return out;
  }

  function write(storage, rows) {
    try { storage.setItem(KEY, JSON.stringify(rows)); } catch (e) { /* full or blocked */ }
    return rows;
  }

  function add(storage, variationId, qty) {
    var rows = read(storage);
    var found = rows.filter(function (r) { return r.variationId === variationId; })[0];
    if (found) found.qty = clamp(found.qty + (qty || 1));
    else rows.push({ variationId: variationId, qty: clamp(qty || 1) });
    return write(storage, rows.filter(function (r) { return r.qty > 0; }));
  }

  function setQty(storage, variationId, qty) {
    var rows = read(storage).map(function (r) {
      if (r.variationId === variationId) r.qty = clamp(qty);
      return r;
    });
    return write(storage, rows.filter(function (r) { return r.qty > 0; }));
  }

  function remove(storage, variationId) {
    return write(storage, read(storage).filter(function (r) {
      return r.variationId !== variationId;
    }));
  }

  function clear(storage) { return write(storage, []); }

  return { read: read, add: add, setQty: setQty, remove: remove, clear: clear, KEY: KEY };
});
