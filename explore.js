(function () {
  'use strict';
  const apiUrl = (window.LIMIT_UP_PUBLIC_API_URL || '').trim();
  const ids = ['explore-date', 'explore-search', 'explore-market', 'explore-notice',
    'day-title', 'day-count', 'day-market-count', 'explore-day-body',
    'explore-day-empty', 'explore-choices', 'stock-panel', 'stock-title',
    'stock-market', 'stock-windows', 'stock-streak', 'stock-history',
    'history-tab', 'notes-tab', 'history-content', 'notes-content'];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const state = {calendar: null, rows: [], selected: null, token: 0};
  const params = new URLSearchParams(location.search);
  const requestedStock = /^[1-9]\d{3}$/.test(params.get('stock') || '') ? params.get('stock') : null;
  const requestedMarket = ['TWSE', 'TPEx'].includes(params.get('market')) ? params.get('market') : null;

  function taiwanToday() {
    const fields = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date())
      .map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }
  function daysAgo(day, count) {
    const value = new Date(day + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() - count);
    return value.toISOString().slice(0, 10);
  }
  function request(query) {
    return new Promise((resolve, reject) => {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(apiUrl)) {
        reject(new Error('公開查詢 API 網址未設定。'));
        return;
      }
      const callback = 'limitUpCallback_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const url = new URL(apiUrl);
      Object.entries({...query, callback}).forEach(([key, value]) => url.searchParams.set(key, value));
      script.src = url.toString();
      script.async = true;
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        delete window[callback];
        script.remove();
        if (error) reject(error);
        else if (!data || data.ok !== true) reject(new Error('資料查詢失敗，請稍後重試。'));
        else resolve(data);
      };
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error('無法連線至公開資料 API。'));
      const timer = setTimeout(() => finish(new Error('公開資料 API 回應逾時。')), 25000);
      document.head.appendChild(script);
    });
  }
  async function getRows(first, last, token) {
    const rows = [];
    let offset = 0;
    let total = null;
    do {
      const page = await request({action: 'rows', from: first, to: last, limit: 500, offset});
      if (token !== state.token) return null;
      if (!Array.isArray(page.rows) || !Number.isInteger(page.total_rows) ||
          (total !== null && page.total_rows !== total)) throw new Error('資料分頁筆數不一致。');
      total = page.total_rows;
      rows.push(...page.rows);
      if (page.next_offset == null) break;
      if (!Number.isInteger(page.next_offset) || page.next_offset <= offset || rows.length > 20000) {
        throw new Error('資料分頁格式異常。');
      }
      offset = page.next_offset;
    } while (true);
    if (rows.length !== total) throw new Error('漲停明細總筆數不符。');
    return rows;
  }
  function notice(message, kind = '') {
    el['explore-notice'].textContent = message;
    el['explore-notice'].className = 'notice' + (kind ? ' ' + kind : '');
  }
  function td(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }
  function stockButton(stock) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'explore-stock-link';
    button.textContent = `${stock.stock_id} ${stock.stock_name}`;
    button.addEventListener('click', () => selectStock(stock.stock_id, stock.market));
    return button;
  }
  function selectStock(stockId, market, scroll = true) {
    if (!state.calendar) return;
    state.selected = {stockId, market};
    const day = el['explore-date'].value;
    const data = LimitUpExplorer.stockView(state.calendar, state.rows, stockId, market, day);
    el['stock-panel'].hidden = false;
    el['stock-title'].textContent = `${data.stock_name || stockId}（${stockId}）`;
    el['stock-market'].textContent = market === 'TWSE' ? '上市 TWSE' : '上櫃 TPEx';
    el['stock-market'].className = 'pill' + (market === 'TPEx' ? ' tpex' : '');
    el['stock-windows'].replaceChildren();
    data.windows.forEach(item => {
      const card = document.createElement('div');
      card.className = 'explore-window';
      const title = document.createElement('span');
      title.textContent = `近 ${item.days} 個交易日`;
      const value = document.createElement('strong');
      value.textContent = `${item.observed} 次`;
      const detail = document.createElement('small');
      detail.textContent = item.full ? `最長 ${item.longest} 日 · 目前 ${item.current} 日`
        : `已收錄 ${item.complete}/${item.days} 日；連板未確定`;
      card.append(title, value, detail);
      el['stock-windows'].appendChild(card);
    });
    const sixty = data.windows.at(-1);
    el['stock-streak'].textContent = sixty.full
      ? `以實際交易日計算：目前連板 ${sixty.current} 日；區間最長 ${sixty.longest} 日。`
      : '近 60 個交易日資料不足；目前連板與區間最長連板無法確認。';
    el['stock-history'].replaceChildren();
    if (!data.hits.length) el['stock-history'].textContent = '此資料範圍沒有該股票的漲停紀錄。';
    data.hits.forEach(hit => {
      const item = document.createElement('div');
      item.className = 'detail-item';
      const title = document.createElement('strong');
      title.textContent = hit.date;
      item.append(title, document.createTextNode(`收盤 ${hit.close} · 漲停價 ${hit.limit_up_price}`));
      el['stock-history'].appendChild(item);
    });
    const link = new URL(location.href);
    link.searchParams.set('date', day);
    link.searchParams.set('stock', stockId);
    link.searchParams.set('market', market);
    history.replaceState(null, '', link);
    if (scroll) el['stock-panel'].scrollIntoView({behavior: 'smooth', block: 'start'});
  }
  function render() {
    const day = el['explore-date'].value;
    const view = LimitUpExplorer.dayView(state.calendar, state.rows, day);
    const labels = {closed: '官方休市／非交易日', missing: '交易日資料尚未收錄',
      failed: '交易日抓取失敗', unverified: '舊資料尚未完成驗證'};
    if (view.status === 'complete') {
      notice(`${day} 已完整驗證：上市 ${view.twse_count} 檔、上櫃 ${view.tpex_count} 檔。`);
      el['day-count'].textContent = `${view.count} 檔`;
      el['day-market-count'].textContent = `上市 ${view.twse_count} 檔 · 上櫃 ${view.tpex_count} 檔`;
    } else {
      notice(`${day}：${labels[view.status] || '狀態無法確認'}。`, 'warning');
      el['day-count'].textContent = '—';
      el['day-market-count'].textContent = '這一天沒有可供統計的完整漲停資料。';
    }
    el['day-title'].textContent = `${day} 漲停股票`;
    const term = el['explore-search'].value.trim().toLocaleLowerCase('zh-Hant');
    const market = el['explore-market'].value;
    const filtered = view.rows.filter(row => (market === 'ALL' || row.market === market) &&
      `${row.stock_id} ${row.stock_name}`.toLocaleLowerCase('zh-Hant').includes(term));
    el['explore-day-body'].replaceChildren();
    filtered.forEach(stock => {
      const row = document.createElement('tr');
      td(row, '').appendChild(stockButton(stock));
      td(row, stock.market === 'TWSE' ? '上市' : '上櫃');
      td(row, String(stock.close));
      td(row, String(stock.limit_up_price));
      el['explore-day-body'].appendChild(row);
    });
    el['explore-day-empty'].hidden = filtered.length > 0 || view.status !== 'complete';
    el['explore-choices'].replaceChildren();
    if (term) LimitUpExplorer.stockChoices(state.rows, term).filter(item =>
      market === 'ALL' || item.market === market).slice(0, 40).forEach(stock => {
      const button = stockButton(stock);
      button.className = 'explore-choice';
      const hint = document.createElement('small');
      hint.textContent = stock.market === 'TWSE' ? '上市' : '上櫃';
      button.appendChild(hint);
      el['explore-choices'].appendChild(button);
    });
    if (state.selected) selectStock(state.selected.stockId, state.selected.market, false);
  }
  async function loadDate(day) {
    if (!LimitUpExplorer.iso(day)) {
      notice('請選擇有效日期。', 'error');
      return;
    }
    const token = ++state.token;
    notice(`正在查詢 ${day} 的官方交易日與漲停資料…`);
    try {
      const source = LimitUpExplorer.validateDays(await request({action: 'days',
        from: daysAgo(day, 240), to: day}));
      if (token !== state.token) return;
      const trading = source.trading_days.slice(-60);
      const first = trading[0] || day;
      const calendar = {...source, trading_days: trading,
        statuses: source.statuses.filter(item => item.date >= first)};
      const rows = await getRows(first, day, token);
      if (token !== state.token || rows === null) return;
      LimitUpExplorer.validateRows(calendar, rows);
      state.calendar = calendar;
      state.rows = rows;
      render();
      if (requestedStock) {
        const candidate = LimitUpExplorer.stockChoices(rows, requestedStock)
          .find(item => item.stock_id === requestedStock &&
            (!requestedMarket || item.market === requestedMarket));
        if (candidate) selectStock(candidate.stock_id, candidate.market);
      }
    } catch (error) {
      if (token !== state.token) return;
      state.calendar = null;
      state.rows = [];
      el['explore-day-body'].replaceChildren();
      el['explore-choices'].replaceChildren();
      el['stock-panel'].hidden = true;
      notice(error.message || '資料查詢失敗。', 'error');
    }
  }
  function showTab(notes) {
    el['history-content'].hidden = notes;
    el['notes-content'].hidden = !notes;
    el['history-tab'].setAttribute('aria-selected', String(!notes));
    el['notes-tab'].setAttribute('aria-selected', String(notes));
  }
  el['history-tab'].addEventListener('click', () => showTab(false));
  el['notes-tab'].addEventListener('click', () => showTab(true));
  el['explore-date'].addEventListener('change', () => loadDate(el['explore-date'].value));
  [el['explore-search'], el['explore-market']].forEach(input =>
    input.addEventListener(input === el['explore-search'] ? 'input' : 'change', () => {
      if (state.calendar) render();
    }));
  const today = taiwanToday();
  el['explore-date'].max = today;
  const queryDate = params.get('date');
  if (queryDate && LimitUpExplorer.iso(queryDate) && queryDate <= today) {
    el['explore-date'].value = queryDate;
    loadDate(queryDate);
  } else {
    request({action: 'days', from: daysAgo(today, 240), to: today})
      .then(source => {
        const days = LimitUpExplorer.validateDays(source).statuses;
        const latest = days.filter(item => item.status === 'complete').at(-1)?.date || today;
        el['explore-date'].value = latest;
        return loadDate(latest);
      }).catch(error => notice(error.message || '交易日資料無法讀取。', 'error'));
  }
})();
