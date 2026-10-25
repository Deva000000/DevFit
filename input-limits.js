/* Resource-safety bounds, shared by browser forms and the account-data API.
   These are input limits, not exercise or medical recommendations. */
(function (global) {
  'use strict';
  const ranges = Object.freeze({
    tSets: [1, 30, 1], tReps: [1, 1000, 1], tMin: [0, 1440, 0.5], tKm: [0, 1000, 0.01]
  });
  function valid(field, value) {
    if (value === '' || value == null) return true;
    const range = ranges[field];
    if (!range || !['number','string'].includes(typeof value) || String(value).trim() === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && n >= range[0] && n <= range[1]
      && (range[2] !== 1 || Number.isInteger(n));
  }
  function safeSetCount(value) { return valid('tSets', value) && Number(value) > 0 ? Number(value) : 3; }
  function validTree(value, depth) {
    if (value == null || typeof value !== 'object') return true;
    if ((depth || 0) > 30) return false;
    return Object.keys(value).every(key =>
      (Object.hasOwn(ranges, key) ? valid(key, value[key]) : true) && validTree(value[key], (depth || 0) + 1));
  }
  global.DevFitLimits = Object.freeze({ ranges, valid, safeSetCount, validTree });
})(globalThis);
