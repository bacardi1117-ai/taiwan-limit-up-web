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
  function sectorLimitups(sectorDay, mapping, limitupDay, rows) {
    if (!sectorDay || !Array.isArray(sectorDay.rows) || !mapping ||
        mapping.ok !== true || mapping.date !== sectorDay.date ||
        !Array.isArray(mapping.categories) || !limitupDay ||
        limitupDay.date !== sectorDay.date || limitupDay.status !== 'complete' ||
        !Array.isArray(rows) || mapping.categories.length !== sectorDay.rows.length) {
      return {status: 'incomplete', categories: new Map()};
    }
    const quotes = new Map();
    for (const row of rows) {
      if (row.date !== sectorDay.date || !['TWSE', 'TPEx'].includes(row.market) ||
          !/^[1-9]\d{3}$/.test(row.stock_id) || !row.stock_name ||
          !Number.isFinite(Number(row.close)) ||
          Number(row.close) !== Number(row.limit_up_price) || quotes.has(row.stock_id)) {
        return {status: 'mismatch', categories: new Map()};
      }
      quotes.set(row.stock_id, row);
    }
    if (rows.filter(row => row.market === 'TWSE').length !== limitupDay.twse_count ||
        rows.filter(row => row.market === 'TPEx').length !== limitupDay.tpex_count) {
      return {status: 'mismatch', categories: new Map()};
    }
    const categories = new Map();
    for (const category of mapping.categories) {
      const sector = sectorDay.rows.find(item => item.category_id === category.category_id);
      if (!sector || category.date !== sectorDay.date ||
          category.category_snapshot_date !== sectorDay.category_snapshot_date ||
          !Array.isArray(category.members) || categories.has(category.category_id)) {
        return {status: 'mismatch', categories: new Map()};
      }
      const seen = new Set();
      const matched = [];
      for (const member of category.members) {
        if (!member || !['TWSE', 'TPEx'].includes(member.market) ||
            !/^[1-9]\d{3}$/.test(member.stock_id) || seen.has(member.stock_id)) {
          return {status: 'mismatch', categories: new Map()};
        }
        seen.add(member.stock_id);
        const quote = quotes.get(member.stock_id);
        if (!quote || quote.market !== member.market) {
          return {status: 'mismatch', categories: new Map()};
        }
        matched.push(quote);
      }
      if (matched.length !== Number(sector.limit_up_count)) {
        return {status: 'mismatch', categories: new Map()};
      }
      matched.sort((a, b) => a.stock_id.localeCompare(b.stock_id));
      categories.set(category.category_id, matched);
    }
    return {status: 'complete', categories};
  }
  function limitupLabel(status, count) {
    if (status === 'complete') return `${count} 檔`;
    return {mismatch: '對應異常', mapping_unavailable: '產業對照未完成',
      unavailable: '名單暫不可用', incomplete: '漲停資料未完成'}[status] || '名單暫不可用';
  }
  return {AMOUNT_FIELDS, amount, partition, leaders, billion, validDay,
    sectorLimitups, limitupLabel};
});
