/* Pure calculation module; no network or DOM dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LimitUpStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function summarize({tradingDays, statuses, rows, requestedDays, market = 'ALL'}) {
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 120) {
      throw new Error('invalid_requested_days');
    }
    if (!['ALL', 'TWSE', 'TPEx'].includes(market)) throw new Error('invalid_market');
    const days = [...new Set(tradingDays)].sort().slice(-requestedDays);
    const daySet = new Set(days);
    const statusByDay = new Map(statuses.map(item => [item.date, item]));
    const completeDays = days.filter(day => statusByDay.get(day)?.status === 'complete');
    const incompleteDays = days.filter(day => statusByDay.get(day)?.status !== 'complete');
    const failedDays = incompleteDays.filter(day => statusByDay.get(day)?.status === 'failed');
    const seen = new Set();
    const byStock = new Map();
    const counts = new Map(days.map(day => [day, {TWSE: 0, TPEx: 0}]));
    for (const row of rows) {
      if (!daySet.has(row.date) || statusByDay.get(row.date)?.status !== 'complete' ||
          !['TWSE', 'TPEx'].includes(row.market)) continue;
      const key = row.date + '\0' + row.stock_id;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.get(row.date)[row.market]++;
      if (market !== 'ALL' && market !== row.market) continue;
      const stockKey = row.market + '\0' + row.stock_id;
      if (!byStock.has(stockKey)) byStock.set(stockKey, []);
      byStock.get(stockKey).push(row);
    }
    const stocks = [...byStock.values()].map(hits => {
      hits.sort((a, b) => a.date.localeCompare(b.date));
      const hitDays = new Set(hits.map(hit => hit.date));
      let longest = 0;
      let running = 0;
      let current = 0;
      if (incompleteDays.length === 0 && days.length === requestedDays) {
        for (const day of days) {
          running = hitDays.has(day) ? running + 1 : 0;
          longest = Math.max(longest, running);
        }
        for (let i = days.length - 1; i >= 0 && hitDays.has(days[i]); i--) current++;
      } else {
        longest = null;
        current = null;
      }
      const last = hits[hits.length - 1];
      return {stock_id: last.stock_id, stock_name: last.stock_name, market: last.market,
              count: hits.length, longest: longest, current: current,
              last_date: last.date, hits: hits.slice().reverse()};
    });
    const daily = days.map(day => {
      const status = statusByDay.get(day)?.status || 'missing';
      const count = counts.get(day);
      return {date: day, status: status,
              TWSE: status === 'complete' ? count.TWSE : null,
              TPEx: status === 'complete' ? count.TPEx : null};
    });
    return {stocks, daily,
            period: {requested: requestedDays, available: days.length,
                     complete: completeDays.length, incomplete: incompleteDays,
                     failed: failedDays, full: days.length === requestedDays && !incompleteDays.length,
                     from: days[0] || null, to: days[days.length - 1] || null}};
  }

  function sortStocks(stocks, sort) {
    const field = ['count', 'longest', 'current', 'last_date'].includes(sort) ? sort : 'count';
    return stocks.slice().sort((a, b) => {
      const left = a[field] == null ? -1 : a[field];
      const right = b[field] == null ? -1 : b[field];
      return right > left ? 1 : right < left ? -1 : a.stock_id.localeCompare(b.stock_id);
    });
  }
  return {summarize, sortStocks};
});
