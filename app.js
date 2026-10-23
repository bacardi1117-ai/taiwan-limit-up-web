(function () {
  'use strict';
  const apiUrl = (window.LIMIT_UP_PUBLIC_API_URL || '').trim();
  const elements = Object.fromEntries([
    'period', 'custom-days', 'custom-group', 'market', 'sort', 'search', 'notice', 'coverage',
    'metric-coverage', 'metric-coverage-sub', 'metric-hits', 'metric-stocks', 'metric-streak',
    'daily-chart', 'chart-table', 'ranking-body', 'empty'
  ].map(id => [id, document.getElementById(id)]));
  const state = {days: null, rows: [], generation: 0};

  function taiwanDate() {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }
  function daysAgo(iso, count) {
    const day = new Date(iso + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - count);
    return day.toISOString().slice(0, 10);
  }
  function taiwanTime(iso) {
    if (!iso || Number.isNaN(Date.parse(iso))) return '未知';
    return new Intl.DateTimeFormat('zh-TW', {timeZone: 'Asia/Taipei',
      dateStyle: 'medium', timeStyle: 'short'}).format(new Date(iso));
  }
  function request(params) {
    return new Promise((resolve, reject) => {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(apiUrl)) {
        reject(new Error('請先設定公開查詢 Web App 網址。'));
        return;
      }
      const callback = 'limitUpCallback_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const url = new URL(apiUrl);
      Object.entries({...params, callback}).forEach(([key, value]) => url.searchParams.set(key, value));
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
        else if (!data || data.ok !== true) reject(new Error({
          public_read_disabled: '公開查詢尚未啟用。',
          calendar_unavailable: '官方交易日資料暫時無法取得。',
          invalid_date_range: '查詢日期區間不合法。'
        }[data?.error] || '資料查詢失敗，請稍後再試。'));
        else resolve(data);
      };
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error('無法連線至資料 API。'));
      const timer = setTimeout(() => finish(new Error('資料 API 回應逾時。')), 25000);
      document.head.appendChild(script);
    });
  }
  function requestedDays() {
    const value = elements.period.value === 'custom' ? Number(elements['custom-days'].value) : Number(elements.period.value);
    if (!Number.isInteger(value) || value < 1 || value > 120) throw new Error('自訂交易日數須介於 1 至 120。');
    return value;
  }
  function setNotice(message, kind = '') {
    elements.notice.textContent = message;
    elements.notice.className = 'notice' + (kind ? ' ' + kind : '');
  }
  async function loadDays() {
    setNotice('正在讀取官方交易日與資料狀態…');
    const to = taiwanDate();
    state.days = await request({action: 'days', from: daysAgo(to, 240), to});
    const coverage = state.days.coverage;
    elements.coverage.textContent = coverage.first_complete
      ? `已驗證資料：${coverage.first_complete} 至 ${coverage.last_complete} · ${coverage.complete_days} 個交易日 · 最後成功更新 ${taiwanTime(coverage.last_success_at)}（台灣時間）`
      : '目前尚無經驗證完成的歷史交易日。';
    await loadRows();
  }
  async function loadRows() {
    if (!state.days) return;
    const generation = ++state.generation;
    try {
      const n = requestedDays();
      const selected = state.days.trading_days.slice(-n);
      if (!selected.length) {
        state.rows = [];
        render();
        return;
      }
      setNotice(`正在載入近 ${n} 個交易日的已驗證紀錄…`);
      const rows = [];
      let offset = 0;
      let expectedTotal = null;
      do {
        const page = await request({action: 'rows', from: selected[0], to: selected[selected.length - 1],
                                    offset, limit: 500});
        if (generation !== state.generation) return;
        if (!Array.isArray(page.rows) || !Number.isInteger(page.total_rows) ||
            (expectedTotal !== null && page.total_rows !== expectedTotal)) throw new Error('資料分頁內容不一致。');
        expectedTotal = page.total_rows;
        rows.push(...page.rows);
        if (page.next_offset === null) break;
        if (!Number.isInteger(page.next_offset) || page.next_offset <= offset || rows.length > 15000) {
          throw new Error('資料分頁異常。');
        }
        offset = page.next_offset;
      } while (true);
      if (rows.length !== expectedTotal) throw new Error('資料筆數不符。');
      const counts = new Map();
      rows.forEach(row => {
        const key = row.date + '\0' + row.market;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      for (const day of state.days.statuses.filter(item => selected.includes(item.date) && item.status === 'complete')) {
        if ((counts.get(day.date + '\0TWSE') || 0) !== day.twse_count ||
            (counts.get(day.date + '\0TPEx') || 0) !== day.tpex_count) {
          throw new Error('每日市場筆數與狀態索引不符。');
        }
      }
      state.rows = rows;
      render();
    } catch (error) {
      if (generation === state.generation) {
        state.rows = [];
        setNotice(error.message || '資料載入失敗。', 'error');
        clearResults();
      }
    }
  }
  function clearResults() {
    ['metric-coverage', 'metric-hits', 'metric-stocks', 'metric-streak'].forEach(id => {
      elements[id].textContent = '—';
    });
    elements['ranking-body'].replaceChildren();
    elements['daily-chart'].replaceChildren();
  }
  function render() {
    const n = requestedDays();
    const data = LimitUpStats.summarize({tradingDays: state.days.trading_days,
      statuses: state.days.statuses, rows: state.rows, requestedDays: n, market: elements.market.value});
    const period = data.period;
    elements['metric-coverage'].textContent = `${period.complete}/${n}`;
    elements['metric-coverage-sub'].textContent = `已取得 ${period.available} 個交易日`;
    elements['metric-hits'].textContent = String(data.stocks.reduce((sum, stock) => sum + stock.count, 0));
    elements['metric-stocks'].textContent = String(data.stocks.length);
    elements['metric-streak'].textContent = period.full
      ? String(Math.max(0, ...data.stocks.map(stock => stock.longest))) : '—';
    if (!period.full) {
      const reason = period.failed.length
        ? `其中 ${period.failed.length} 日抓取失敗` : '仍有日期未收錄';
      setNotice(`目前僅 ${period.complete}/${n} 個交易日經完整驗證（${reason}）。次數為已收錄值，連板暫不計算。`, 'warning');
    } else {
      setNotice(`${period.from} 至 ${period.to}：${n} 個交易日資料完整，可計算連板。`);
    }
    renderChart(data.daily);
    renderRanking(data.stocks);
  }
  function svg(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
  function renderChart(daily) {
    const target = elements['daily-chart'];
    target.replaceChildren();
    const width = Math.max(620, daily.length * 25 + 60);
    const height = 220;
    target.setAttribute('viewBox', `0 0 ${width} ${height}`);
    target.setAttribute('width', width);
    const max = Math.max(1, ...daily.filter(item => item.status === 'complete').map(item => item.TWSE + item.TPEx));
    target.appendChild(svg('line', {x1: 34, y1: 174, x2: width - 10, y2: 174, stroke: '#cbdcd8'}));
    const step = (width - 55) / Math.max(1, daily.length);
    daily.forEach((item, index) => {
      const x = 42 + index * step;
      const barWidth = Math.max(6, Math.min(18, step - 4));
      if (item.status === 'complete') {
        const first = item.TWSE / max * 138;
        const second = item.TPEx / max * 138;
        target.appendChild(svg('rect', {x, y: 174 - first, width: barWidth,
          height: first, rx: 2, fill: '#087b7d'}));
        target.appendChild(svg('rect', {x, y: 174 - first - second, width: barWidth,
          height: second, rx: 2, fill: '#e6a45f'}));
      } else {
        target.appendChild(svg('rect', {x, y: 164, width: barWidth, height: 10,
          rx: 2, fill: item.status === 'failed' ? '#d9786e' : '#c7d3d1'}));
      }
      const title = svg('title', {});
      title.textContent = `${item.date}：${item.status === 'complete'
        ? `上市 ${item.TWSE} 家，上櫃 ${item.TPEx} 家` : item.status === 'failed' ? '抓取失敗' :
          item.status === 'unverified' ? '舊資料未驗證' : '資料未收錄'}`;
      target.lastChild.appendChild(title);
      if (index === 0 || index === daily.length - 1 || index % Math.max(1, Math.ceil(daily.length / 8)) === 0) {
        const label = svg('text', {x: x - 4, y: 198, fill: '#849b9d', 'font-size': 10});
        label.textContent = item.date.slice(5);
        target.appendChild(label);
      }
    });
    elements['chart-table'].textContent = daily.map(item => `${item.date} ${item.status === 'complete'
      ? `上市 ${item.TWSE} 家，上櫃 ${item.TPEx} 家` : item.status === 'failed' ? '抓取失敗' :
        item.status === 'unverified' ? '舊資料未驗證' : '資料未收錄'}`).join('；');
  }
  function cell(row, text, className = '') {
    const element = document.createElement('td');
    element.textContent = text;
    if (className) element.className = className;
    row.appendChild(element);
    return element;
  }
  function renderRanking(stocks) {
    const term = elements.search.value.trim().toLocaleLowerCase('zh-Hant');
    const filtered = LimitUpStats.sortStocks(stocks, elements.sort.value)
      .filter(stock => `${stock.stock_id} ${stock.stock_name}`.toLocaleLowerCase('zh-Hant').includes(term));
    const body = elements['ranking-body'];
    body.replaceChildren();
    filtered.forEach(stock => {
      const row = document.createElement('tr');
      const identity = cell(row, '');
      const button = document.createElement('button');
      button.className = 'stock-button';
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.textContent = stock.stock_name;
      const id = document.createElement('small');
      id.textContent = stock.stock_id;
      button.appendChild(id);
      identity.appendChild(button);
      const market = cell(row, '');
      const pill = document.createElement('span');
      pill.className = 'pill' + (stock.market === 'TPEx' ? ' tpex' : '');
      pill.textContent = stock.market === 'TWSE' ? '上市' : '上櫃';
      market.appendChild(pill);
      cell(row, String(stock.count), 'number');
      cell(row, stock.longest === null ? '—' : String(stock.longest));
      cell(row, stock.current === null ? '—' : String(stock.current));
      cell(row, stock.last_date);
      body.appendChild(row);
      const detail = document.createElement('tr');
      detail.className = 'detail-row';
      detail.hidden = true;
      const wrapper = cell(detail, '');
      wrapper.colSpan = 6;
      const list = document.createElement('div');
      list.className = 'detail-list';
      stock.hits.forEach(hit => {
        const entry = document.createElement('div');
        entry.className = 'detail-item';
        const day = document.createElement('strong');
        day.textContent = hit.date;
        entry.append(day, document.createTextNode(`收盤 ${hit.close} · 漲停價 ${hit.limit_up_price}`));
        list.appendChild(entry);
      });
      wrapper.appendChild(list);
      body.appendChild(detail);
      button.addEventListener('click', () => {
        detail.hidden = !detail.hidden;
        button.setAttribute('aria-expanded', String(!detail.hidden));
      });
    });
    elements.empty.hidden = filtered.length > 0;
  }
  elements.period.addEventListener('change', () => {
    elements['custom-group'].hidden = elements.period.value !== 'custom';
    loadRows();
  });
  elements['custom-days'].addEventListener('change', loadRows);
  [elements.market, elements.sort, elements.search].forEach(element =>
    element.addEventListener(element === elements.search ? 'input' : 'change', () => {
      if (state.days) render();
    }));
  loadDays().catch(error => {
    setNotice(error.message || '資料載入失敗。', 'error');
    elements.coverage.textContent = '資料範圍暫時無法確認。';
    clearResults();
  });
})();
