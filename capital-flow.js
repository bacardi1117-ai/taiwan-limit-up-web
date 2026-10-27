(function () {
  'use strict';
  const apiUrl = (window.LIMIT_UP_PUBLIC_API_URL || '').trim();
  const ids = ['flow-date', 'flow-investor', 'flow-direction', 'flow-notice', 'flow-meta',
    'flow-sector-count', 'flow-complete-count', 'flow-partial-count', 'flow-stock-count',
    'flow-ranking-body', 'flow-partial-body', 'flow-empty'];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  let current = null;
  let limitupMembers = {status: 'incomplete', categories: new Map()};
  let generation = 0;

  function dayInTaiwan() {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }
  function daysAgo(day, days) {
    const value = new Date(day + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() - days);
    return value.toISOString().slice(0, 10);
  }
  function taiwanTime(value) {
    if (!value || Number.isNaN(Date.parse(value))) return '未知';
    return new Intl.DateTimeFormat('zh-TW', {timeZone: 'Asia/Taipei',
      dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
  }
  function request(params) {
    return new Promise((resolve, reject) => {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(apiUrl)) {
        reject(new Error('公開資料 API 網址尚未設定。'));
        return;
      }
      const callback = 'limitUpCallback_' + Math.random().toString(36).slice(2);
      const url = new URL(apiUrl);
      Object.entries({...params, callback}).forEach(([key, value]) => url.searchParams.set(key, value));
      const script = document.createElement('script');
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
          sector_day_incomplete: '此日產業資料尚未完整寫入。',
          invalid_date_range: '查詢日期不合法。'
        }[data?.error] || '產業資料暫時無法讀取。'));
        else resolve(data);
      };
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error('無法連線至公開資料 API。'));
      const timer = setTimeout(() => finish(new Error('公開資料 API 回應逾時。')), 25000);
      document.head.appendChild(script);
    });
  }
  function notice(message, kind = '') {
    el['flow-notice'].textContent = message;
    el['flow-notice'].className = 'notice' + (kind ? ' ' + kind : '');
  }
  function td(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }
  function leaderList(categoryId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'flow-leaders';
    for (const direction of ['buy', 'sell']) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = direction === 'buy' ? '主要買超股票' : '主要賣超股票';
      section.appendChild(heading);
      const stocks = CapitalFlowCore.leaders(current.stocks, categoryId, direction);
      if (!stocks.length) {
        const empty = document.createElement('p');
        empty.textContent = '無符合資料';
        section.appendChild(empty);
      }
      stocks.forEach(stock => {
        const entry = document.createElement('p');
        const market = stock.market === 'TWSE' ? '上市' : '上櫃';
        entry.textContent = `${stock.rank}. ${stock.stock_id} ${stock.stock_name}（${market}） · ${CapitalFlowCore.billion(stock.estimated_amount)} 億元`;
        section.appendChild(entry);
      });
      wrapper.appendChild(section);
    }
    return wrapper;
  }
  function limitupList(categoryId) {
    const wrapper = document.createElement('section');
    wrapper.className = 'flow-limitups';
    const title = document.createElement('h3');
    title.textContent = '當日漲停標的';
    wrapper.appendChild(title);
    for (const stock of limitupMembers.categories.get(categoryId) || []) {
      const entry = document.createElement('p');
      const link = document.createElement('a');
      const target = new URL('explore.html', location.href);
      target.searchParams.set('date', current.date);
      target.searchParams.set('stock', stock.stock_id);
      target.searchParams.set('market', stock.market);
      link.href = target.toString();
      link.textContent = `${stock.stock_id} ${stock.stock_name}`;
      entry.append(link, document.createTextNode(`（${stock.market === 'TWSE' ? '上市' : '上櫃'}） · 收盤 ${stock.close} · 漲停價 ${stock.limit_up_price}`));
      wrapper.appendChild(entry);
    }
    return wrapper;
  }
  function appendSector(body, sector, rank, partial) {
    const row = document.createElement('tr');
    if (!partial) td(row, String(rank), 'flow-rank');
    const name = td(row, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stock-button';
    button.setAttribute('aria-expanded', 'false');
    button.textContent = sector.category_name;
    const id = document.createElement('small');
    id.textContent = sector.category_id;
    button.appendChild(id);
    name.appendChild(button);
    const amount = CapitalFlowCore.amount(sector, el['flow-investor'].value);
    td(row, CapitalFlowCore.billion(amount), partial ? 'flow-partial-amount' : 'number');
    td(row, CapitalFlowCore.billion(sector.trade_value));
    td(row, `${sector.up_count}／${sector.down_count}`);
    const limitCell = td(row, '');
    if (limitupMembers.status === 'complete' && Number(sector.limit_up_count) > 0) {
      const limitButton = document.createElement('button');
      limitButton.type = 'button';
      limitButton.className = 'flow-limit-button';
      limitButton.textContent = `${sector.limit_up_count} 檔`;
      limitButton.setAttribute('aria-expanded', 'false');
      limitCell.appendChild(limitButton);
      limitButton.addEventListener('click', () => {
        const panel = detail.querySelector('.flow-limitups');
        panel.hidden = !panel.hidden;
        detail.hidden = false;
        limitButton.setAttribute('aria-expanded', String(!panel.hidden));
      });
    } else {
      limitCell.textContent = limitupMembers.status === 'complete' ? '0 檔'
        : limitupMembers.status === 'mismatch' ? '對應異常' : '漲停資料未完成';
    }
    td(row, `${sector.valid_stock_count}/${sector.constituent_count}`);
    body.appendChild(row);
    const detail = document.createElement('tr');
    detail.className = 'detail-row';
    detail.hidden = true;
    const cell = td(detail, '');
    cell.colSpan = partial ? 6 : 7;
    const note = document.createElement('p');
    note.className = 'flow-detail-note';
    note.textContent = `${partial ? '法人資料部分缺漏；顯示已觀測股票，不代表完整產業。' : '法人資料覆蓋完整。'} ` +
      (sector.classification_status === 'provisional_snapshot'
        ? `分類快照 ${sector.category_snapshot_date}：回溯暫定分類。` : '分類已驗證。');
    cell.append(note, leaderList(sector.category_id));
    if (limitupMembers.status === 'complete' && Number(sector.limit_up_count) > 0) {
      const listing = limitupList(sector.category_id);
      listing.hidden = true;
      cell.appendChild(listing);
    }
    body.appendChild(detail);
    button.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      button.setAttribute('aria-expanded', String(!detail.hidden));
    });
  }
  function render() {
    if (!current) return;
    const {ranked, partial, completeCount} = CapitalFlowCore.partition(
      current.rows, el['flow-investor'].value, el['flow-direction'].value);
    el['flow-sector-count'].textContent = String(current.rows.length);
    el['flow-complete-count'].textContent = String(completeCount);
    el['flow-partial-count'].textContent = String(current.rows.length - completeCount);
    el['flow-stock-count'].textContent = String(current.stocks.length);
    el['flow-ranking-body'].replaceChildren();
    ranked.forEach((sector, index) => appendSector(el['flow-ranking-body'], sector, index + 1, false));
    el['flow-empty'].hidden = ranked.length > 0;
    el['flow-partial-body'].replaceChildren();
    partial.forEach(sector => appendSector(el['flow-partial-body'], sector, null, true));
    const provisional = current.rows.filter(row => row.classification_status === 'provisional_snapshot').length;
    notice(`${current.date}：${completeCount} 類法人資料完整、${partial.length} 類部分缺漏。` +
      (provisional ? ` ${provisional} 類使用回溯暫定分類，請留意分類快照日期。` : ''),
      partial.length || provisional ? 'warning' : '');
    el['flow-meta'].textContent = `資料日期 ${current.date} · 分類快照 ${current.category_snapshot_date}` +
      ` · 最後更新 ${taiwanTime(current.updated_at)}（台灣時間） · 來源：${current.source}`;
  }
  async function loadDay() {
    const day = el['flow-date'].value;
    if (!day) return;
    const token = ++generation;
    notice(`正在讀取 ${day} 產業資料…`);
    try {
      const data = CapitalFlowCore.validDay(await request({action: 'sector_data', from: day, to: day}));
      if (token !== generation) return;
      current = data;
      limitupMembers = {status: 'incomplete', categories: new Map()};
      render();
      try {
        const [mapping, days] = await Promise.all([
          request({action: 'sector_limitups', from: day, to: day}),
          request({action: 'days', from: day, to: day})
        ]);
        if (token !== generation) return;
        const status = days.statuses?.find(item => item.date === day);
        if (!status || status.status !== 'complete') return;
        let offset = 0;
        const quotes = [];
        while (true) {
          const page = await request({action: 'rows', from: day, to: day, limit: 500, offset});
          if (token !== generation) return;
          if (!Array.isArray(page.rows) || !Number.isInteger(page.total_rows) ||
              page.total_rows !== status.twse_count + status.tpex_count) throw new Error('漲停明細筆數不符');
          quotes.push(...page.rows);
          if (page.next_offset == null) break;
          if (!Number.isInteger(page.next_offset) || page.next_offset <= offset || quotes.length > 2000) {
            throw new Error('漲停明細分頁異常');
          }
          offset = page.next_offset;
        }
        limitupMembers = CapitalFlowCore.sectorLimitups(data, mapping, status, quotes);
        render();
      } catch (_) {
        if (token === generation) {
          limitupMembers = {status: 'incomplete', categories: new Map()};
          render();
        }
      }
    } catch (error) {
      if (token !== generation) return;
      current = null;
      el['flow-ranking-body'].replaceChildren();
      el['flow-partial-body'].replaceChildren();
      notice(error.message || '產業資料讀取失敗。', 'error');
    }
  }
  async function loadDates() {
    try {
      const to = dayInTaiwan();
      const result = await request({action: 'sector_days', from: daysAgo(to, 269), to});
      if (!Array.isArray(result.days)) throw new Error('可用日期資料格式不符。');
      el['flow-date'].replaceChildren();
      result.days.forEach(item => {
        const option = document.createElement('option');
        option.value = item.date;
        option.textContent = item.date;
        el['flow-date'].appendChild(option);
      });
      if (!result.days.length) {
        notice('目前沒有已驗證完成的產業交易日。', 'warning');
        return;
      }
      el['flow-date'].disabled = false;
      await loadDay();
    } catch (error) {
      notice(error.message || '可用日期讀取失敗。', 'error');
    }
  }
  el['flow-date'].addEventListener('change', loadDay);
  [el['flow-investor'], el['flow-direction']].forEach(element =>
    element.addEventListener('change', render));
  loadDates();
})();
