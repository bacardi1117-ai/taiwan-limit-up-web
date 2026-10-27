/* Pure date and stock views over the existing public limit-up API. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports
    ? require('./stats.js') : root.LimitUpStats);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LimitUpExplorer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (stats) {
  'use strict';
  const WINDOWS = Object.freeze([5, 10, 20, 30, 60]);
  const STATES = new Set(['complete', 'missing', 'failed', 'unverified']);
  const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

  function validateDays(payload) {
    if (!payload || payload.ok !== true || !Array.isArray(payload.trading_days) ||
        !Array.isArray(payload.statuses)) throw new Error('交易日資料格式不完整。');
    const days = payload.trading_days;
    if (days.some(day => !iso(day)) || new Set(days).size !== days.length ||
        days.some((day, i) => i && day <= days[i - 1])) throw new Error('交易日資料格式不完整。');
    const byDate = new Map();
    payload.statuses.forEach(item => {
      if (!item || !iso(item.date) || !STATES.has(item.status) || byDate.has(item.date)) {
        throw new Error('每日狀態格式不完整。');
      }
      if (item.status === 'complete' && (!Number.isInteger(item.twse_count) ||
          !Number.isInteger(item.tpex_count) || item.twse_count < 0 || item.tpex_count < 0)) {
        throw new Error('每日市場筆數格式不完整。');
      }
      byDate.set(item.date, item);
    });
    if (days.length !== byDate.size || days.some(day => !byDate.has(day))) {
      throw new Error('交易日與每日狀態不一致。');
    }
    return payload;
  }

  function validateRows(calendar, rows) {
    if (!Array.isArray(rows)) throw new Error('漲停明細格式不完整。');
    const byDay = new Map(calendar.statuses.map(item => [item.date, item]));
    const counts = new Map();
    const keys = new Set();
    rows.forEach(row => {
      if (!row || !iso(row.date) || !['TWSE', 'TPEx'].includes(row.market) ||
          !/^[1-9]\d{3}$/.test(row.stock_id) || typeof row.stock_name !== 'string' ||
          !row.stock_name || !Number.isFinite(Number(row.close)) || Number(row.close) <= 0 ||
          Number(row.close) !== Number(row.limit_up_price) ||
          byDay.get(row.date)?.status !== 'complete') throw new Error('漲停明細格式不完整。');
      const key = row.date + '\0' + row.stock_id;
      if (keys.has(key)) throw new Error('漲停明細含重複股票。');
      keys.add(key);
      const market = row.date + '\0' + row.market;
      counts.set(market, (counts.get(market) || 0) + 1);
    });
    calendar.statuses.forEach(day => {
      if (day.status === 'complete' &&
          ((counts.get(day.date + '\0TWSE') || 0) !== day.twse_count ||
           (counts.get(day.date + '\0TPEx') || 0) !== day.tpex_count)) {
        throw new Error('每日市場筆數與漲停明細不符。');
      }
    });
    return rows;
  }

  function dayView(calendar, rows, date) {
    if (!iso(date)) throw new Error('日期格式不合法。');
    const status = calendar.statuses.find(item => item.date === date);
    if (!status) return {date, status: 'closed', rows: [], count: null};
    if (status.status !== 'complete') return {date, status: status.status, rows: [], count: null};
    const selected = rows.filter(row => row.date === date)
      .sort((a, b) => a.stock_id.localeCompare(b.stock_id));
    return {date, status: 'complete', rows: selected, count: selected.length,
            twse_count: status.twse_count, tpex_count: status.tpex_count};
  }

  function stockChoices(rows, term) {
    const query = String(term || '').trim().toLocaleLowerCase('zh-Hant');
    const choices = new Map();
    rows.forEach(row => choices.set(row.market + '\0' + row.stock_id,
      {stock_id: row.stock_id, stock_name: row.stock_name, market: row.market}));
    return [...choices.values()].filter(item =>
      `${item.stock_id} ${item.stock_name}`.toLocaleLowerCase('zh-Hant').includes(query))
      .sort((a, b) => a.stock_id.localeCompare(b.stock_id));
  }

  function stockView(calendar, rows, stockId, market, asOf) {
    if (!/^[1-9]\d{3}$/.test(stockId) || !['TWSE', 'TPEx'].includes(market) || !iso(asOf)) {
      throw new Error('股票查詢條件不合法。');
    }
    const days = calendar.trading_days.filter(day => day <= asOf);
    const stockRows = rows.filter(row => row.stock_id === stockId && row.market === market &&
      row.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
    const windows = WINDOWS.map(length => {
      const result = stats.summarize({tradingDays: days, statuses: calendar.statuses,
        rows, requestedDays: length, market});
      const stock = result.stocks.find(item => item.stock_id === stockId && item.market === market);
      return {days: length, observed: stock?.count || 0, complete: result.period.complete,
              available: result.period.available, full: result.period.full,
              longest: stock?.longest ?? (result.period.full ? 0 : null),
              current: stock?.current ?? (result.period.full ? 0 : null)};
    });
    return {stock_id: stockId, market, stock_name: stockRows[0]?.stock_name || null,
            hits: stockRows, windows};
  }

  return {WINDOWS, iso, validateDays, validateRows, dayView, stockChoices, stockView};
});
