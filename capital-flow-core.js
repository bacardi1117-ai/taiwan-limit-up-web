(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CapitalFlowCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const AMOUNT_FIELDS = Object.freeze({
    total: 'total_estimated_amount', foreign: 'foreign_estimated_amount',
    trust: 'trust_estimated_amount', dealer: 'dealer_estimated_amount'
  });
  function amount(row, investor) {
    const key = AMOUNT_FIELDS[investor];
    if (!key || row[key] === null || row[key] === '' || row[key] === undefined) return null;
    const value = Number(row[key]);
    return Number.isFinite(value) ? value : null;
  }
  function partition(rows, investor, direction) {
    if (!AMOUNT_FIELDS[investor] || !['buy', 'sell'].includes(direction)) {
      throw new Error('不支援的排序條件');
    }
    const eligible = row => row.amount_method === 'estimated_amount' &&
      row.data_completeness === 'complete' && amount(row, investor) !== null;
    const directional = row => direction === 'buy'
      ? amount(row, investor) > 0 : amount(row, investor) < 0;
    const ranked = rows.filter(row => eligible(row) && directional(row))
      .sort((a, b) => direction === 'buy'
        ? amount(b, investor) - amount(a, investor) || a.category_id.localeCompare(b.category_id)
        : amount(a, investor) - amount(b, investor) || a.category_id.localeCompare(b.category_id));
    const partial = rows.filter(row => !eligible(row))
      .sort((a, b) => a.category_name.localeCompare(b.category_name, 'zh-Hant'));
    return {ranked, partial, completeCount: rows.filter(eligible).length};
  }
  function leaders(stocks, categoryId, direction) {
    return stocks.filter(row => row.category_id === categoryId && row.direction === direction)
      .sort((a, b) => Number(a.rank) - Number(b.rank));
  }
  function billion(value) {
    if (value === null || value === '' || value === undefined) return '—';
    const number = Number(value);
    return Number.isFinite(number) ? (number / 100000000).toLocaleString('zh-TW',
      {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
  }
  function validDay(data) {
    if (!data || data.ok !== true || data.amount_method !== 'estimated_amount' ||
        data.unit !== 'TWD' || !Array.isArray(data.rows) || data.rows.length !== 34 ||
        !Array.isArray(data.stocks) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw new Error('產業資料格式不完整');
    }
    const keys = new Set();
    data.rows.forEach(row => {
      if (row.date !== data.date || keys.has(row.category_id) ||
          !['complete', 'partial'].includes(row.data_completeness) ||
          !['verified', 'provisional_snapshot'].includes(row.classification_status) ||
          row.amount_method !== 'estimated_amount') throw new Error('產業資料格式不完整');
      keys.add(row.category_id);
    });
    if (data.stocks.some(row => row.date !== data.date || !keys.has(row.category_id) ||
        row.amount_method !== 'estimated_amount')) throw new Error('個股資料格式不完整');
    return data;
  }
  return {AMOUNT_FIELDS, amount, partition, leaders, billion, validDay};
});
