const refreshButton = document.querySelector('#refreshButton');
const applyButton = document.querySelector('#applyButton');
const stockDataDate = document.querySelector('#stockDataDate');
const updatedAt = document.querySelector('#updatedAt');
const expiresAt = document.querySelector('#expiresAt');
const scannedCount = document.querySelector('#scannedCount');
const matchedCount = document.querySelector('#matchedCount');
const activeConditionCount = document.querySelector('#activeConditionCount');
const apiKeyStatus = document.querySelector('#apiKeyStatus');
const sourceText = document.querySelector('#sourceText');
const tushareHttpUrl = document.querySelector('#tushareHttpUrl');
const universeStatus = document.querySelector('#universeStatus');
const localCacheStatus = document.querySelector('#localCacheStatus');
const dataStatusText = document.querySelector('#dataStatusText');
const browserCacheStatus = document.querySelector('#browserCacheStatus');
const serverSnapshotStatus = document.querySelector('#serverSnapshotStatus');
const browserSnapshotStatus = document.querySelector('#browserSnapshotStatus');
const browserSnapshotCount = document.querySelector('#browserSnapshotCount');
const resultNote = document.querySelector('#resultNote');
const warningBox = document.querySelector('#warningBox');
const resultsBody = document.querySelector('#resultsBody');
const nearMissBody = document.querySelector('#nearMissBody');
const incompleteBody = document.querySelector('#incompleteBody');
const conditionList = document.querySelector('#conditionList');
const stockDetailSection = document.querySelector('#stockDetailSection');
const stockDetailTitle = document.querySelector('#stockDetailTitle');
const stockDetailBody = document.querySelector('#stockDetailBody');

let conditionDefinitions = [];
let browserDb = null;

function formatChinaDateTime(value = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function openBrowserCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('a-share-stock-screener', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains('snapshots')) {
        db.deleteObjectStore('snapshots');
      }
      if (db.objectStoreNames.contains('meta')) {
        db.deleteObjectStore('meta');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        const store = db.createObjectStore('snapshots', { keyPath: 'savedAt' });
        store.createIndex('byTradeDate', 'tradeDate');
        store.createIndex('bySavedAtChina', 'savedAtChina');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveBrowserCache(payload) {
  if (!browserDb) browserDb = await openBrowserCache();
  const savedAt = new Date();
  const tx = browserDb.transaction(['snapshots', 'meta'], 'readwrite');
  tx.objectStore('snapshots').put({
    savedAt: savedAt.toISOString(),
    savedAtChina: formatChinaDateTime(savedAt),
    updatedAtChina: payload.updatedAtChina ?? null,
    tradeDate: payload.localCache?.latestTradeDateChina ?? null,
    snapshotLoaded: Boolean(payload.snapshotLoaded),
    dataStatusLabel: payload.dataStatus?.label ?? null,
    dataStatusDetail: payload.dataStatus?.detail ?? null,
    payload
  });
  tx.objectStore('meta').put({
    key: 'latest',
    savedAt: savedAt.toISOString(),
    savedAtChina: formatChinaDateTime(savedAt),
    updatedAtChina: payload.updatedAtChina ?? null,
    tradeDate: payload.localCache?.latestTradeDateChina ?? null,
    snapshotLoaded: Boolean(payload.snapshotLoaded)
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadBrowserCache() {
  if (!browserDb) browserDb = await openBrowserCache();
  return new Promise((resolve, reject) => {
    const tx = browserDb.transaction(['snapshots', 'meta'], 'readonly');
    const snapshotReq = tx.objectStore('snapshots').getAll();
    const metaReq = tx.objectStore('meta').get('latest');
    const result = { snapshot: null, meta: null, snapshots: [] };
    snapshotReq.onsuccess = () => {
      result.snapshots = snapshotReq.result ?? [];
      result.snapshot = result.snapshots.at(-1)?.payload ?? null;
    };
    metaReq.onsuccess = () => {
      result.meta = metaReq.result ?? null;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function browserCacheSummary(meta, snapshots = []) {
  return {
    savedAtChina: meta?.savedAtChina ?? null,
    updatedAtChina: meta?.updatedAtChina ?? null,
    tradeDate: meta?.tradeDate ?? null,
    snapshotCount: snapshots.length
  };
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${formatNumber(number / 100000000, 2)} 亿`;
  if (abs >= 10000) return `${formatNumber(number / 10000, 2)} 万`;
  return formatNumber(number, 0);
}

function valueClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'muted';
  return number >= 0 ? 'positive' : 'negative';
}

function formatPercentRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${formatNumber(number * 100, 1)}%`;
}

function formatTradeDateChina(value) {
  const text = String(value ?? '');
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}年${text.slice(4, 6)}月${text.slice(6, 8)}日`;
  }
  return '-';
}

function stockCode(stock) {
  return stock.ts_code ?? `${stock.code}.${stock.exchange}`;
}

function emptyRow(colspan, text) {
  return `<tr><td colspan="${colspan}" class="empty">${text}</td></tr>`;
}

function detailButton(stock) {
  return `<button type="button" class="detail-button" data-stock-detail="${stockCode(stock)}">查看计算</button>`;
}

function paramsToHtml(condition) {
  if (!condition.params?.length) return '';
  return `<div class="param-grid">
    ${condition.params
      .map((param) => {
        if (param.type === 'select') {
          return `<label>${param.label}<select data-param="${param.key}">
            ${(param.options ?? [])
              .map((option) => `<option value="${option.value}"${param.value === option.value ? ' selected' : ''}>${option.label}</option>`)
              .join('')}
          </select></label>`;
        }
        if (param.type === 'money') {
          return `<label>${param.label}<select data-param="${param.key}">
            <option value="50000000"${param.value === 50000000 ? ' selected' : ''}>5000 万</option>
            <option value="100000000"${param.value === 100000000 ? ' selected' : ''}>1 亿</option>
            <option value="300000000"${param.value === 300000000 ? ' selected' : ''}>3 亿</option>
            <option value="1000000000"${param.value === 1000000000 ? ' selected' : ''}>10 亿</option>
            <option value="30000000000"${param.value === 30000000000 ? ' selected' : ''}>300 亿</option>
          </select></label>`;
        }
        return `<label>${param.label}<input data-param="${param.key}" type="number" value="${param.value}" step="${param.step ?? 1}" /></label>`;
      })
      .join('')}
  </div>`;
}

function renderConditions() {
  const groups = [...new Set(conditionDefinitions.map((condition) => condition.group ?? '其他'))];
  conditionList.innerHTML = groups
    .map((group) => {
      const cards = conditionDefinitions
        .filter((condition) => (condition.group ?? '其他') === group)
        .map(
          (condition) => `<article class="condition-card" data-condition="${condition.key}">
        <label class="condition-toggle">
          <input type="checkbox" ${condition.defaultEnabled ? 'checked' : ''} />
          <span>
            <strong>${condition.label}</strong>
            <small>${condition.description}</small>
          </span>
        </label>
        ${paramsToHtml(condition)}
      </article>`
        )
        .join('');
      return `<section class="condition-group"><h3>${group}</h3><div class="condition-grid-inner">${cards}</div></section>`;
    })
    .join('');
}

function selectedConditions() {
  return conditionDefinitions.map((definition) => {
    const card = conditionList.querySelector(`[data-condition="${definition.key}"]`);
    const params = {};
    card?.querySelectorAll('[data-param]').forEach((input) => {
      const rawValue = input.value;
      params[input.dataset.param] = Number.isFinite(Number(rawValue)) && rawValue.trim() !== '' ? Number(rawValue) : rawValue;
    });
    return {
      key: definition.key,
      enabled: Boolean(card?.querySelector('input[type="checkbox"]')?.checked),
      params
    };
  });
}

function failedLabels(row) {
  return (row.failedKeys ?? [])
    .map((key) => conditionDefinitions.find((condition) => condition.key === key)?.label ?? key)
    .join('、');
}

function renderResults(rows) {
  if (!rows.length) {
    resultsBody.innerHTML = emptyRow(9, '当前条件下没有命中的股票。');
    return;
  }

  resultsBody.innerHTML = rows
    .map(({ stock, metrics }) => {
      return `<tr>
        <td><span class="code">${stockCode(stock)}</span></td>
        <td>
          <div class="stack">
            <strong>${stock.name}</strong>
            <span class="muted">${metrics.tradeDate}</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <strong>${formatNumber(metrics.close)}</strong>
            <span class="${metrics.pctChange >= 0 ? 'positive' : 'negative'}">${formatNumber(metrics.pctChange)}%</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <span>MA5 ${formatNumber(metrics.ma5)}</span>
            <span>MA10 ${formatNumber(metrics.ma10)} / MA20 ${formatNumber(metrics.ma20)}</span>
            <span>MA60 ${formatNumber(metrics.ma60)} / MA250 ${formatNumber(metrics.ma250)}</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <span>今 20日均量比 ${formatNumber(metrics.todayVolumeMultiple20)} 倍</span>
            <span>昨 20日均量比 ${formatNumber(metrics.yesterdayVolumeMultiple20)} 倍</span>
            <span>CV ${formatNumber(metrics.volumeCv20BeforeBreakout, 3)}</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <span>今 ${formatPercentRatio(metrics.todayUpperShadowRatio)}</span>
            <span>昨 ${formatPercentRatio(metrics.yesterdayUpperShadowRatio)}</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <span class="${valueClass(metrics.todayMainNetInflow)}">今 ${formatMoney(metrics.todayMainNetInflow)}</span>
            <span class="${valueClass(metrics.yesterdayMainNetInflow)}">昨 ${formatMoney(metrics.yesterdayMainNetInflow)}</span>
            <span>占比 ${formatNumber(metrics.todayMainMoneyRatio)}%</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <span>成交额 ${formatMoney(metrics.amount)}</span>
            <span>换手 ${formatNumber(metrics.turnover)}%</span>
            <span>流通市值 ${formatMoney(metrics.floatMarketCap)}</span>
          </div>
        </td>
        <td>${detailButton(stock)}</td>
      </tr>`;
    })
    .join('');
}

function renderNearMisses(rows) {
  if (!rows.length) {
    nearMissBody.innerHTML = emptyRow(6, '暂无接近命中数据。');
    return;
  }

  nearMissBody.innerHTML = rows
    .map(({ stock, passCount, metrics, activeConditionCount: rowConditionCount, failedKeys, ...row }) => {
      const total = Object.keys(row.checks ?? {}).length || rowConditionCount || 0;
      return `<tr>
        <td><span class="code">${stockCode(stock)}</span></td>
        <td>${stock.name}</td>
        <td>${passCount}/${total}</td>
        <td class="danger">${failedLabels({ failedKeys }) || '-'}</td>
        <td>
          <div class="stack">
            <span>收盘 ${formatNumber(metrics.close)}，MA250 ${formatNumber(metrics.ma250)}</span>
            <span>20日均量比 今 ${formatNumber(metrics.todayVolumeMultiple20)} / 昨 ${formatNumber(metrics.yesterdayVolumeMultiple20)}</span>
            <span>主力 今 ${formatMoney(metrics.todayMainNetInflow)} / 昨 ${formatMoney(metrics.yesterdayMainNetInflow)}</span>
          </div>
        </td>
        <td>${detailButton(stock)}</td>
      </tr>`;
    })
    .join('');
}

async function showStockDetail(tsCode) {
  stockDetailSection.hidden = false;
  stockDetailTitle.textContent = `${tsCode} 计算明细加载中...`;
  stockDetailBody.textContent = '正在读取交易日、日线、资金流和公式明细...';
  try {
    const response = await fetch(`/api/stock/${encodeURIComponent(tsCode)}/detail`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '明细加载失败');
    stockDetailTitle.textContent = `${payload.stock.name} ${payload.stock.ts_code}，实际交易日 ${payload.details.tradingDatePolicy.actualLatestTradeDateChina} / 上一交易日 ${payload.details.tradingDatePolicy.previousTradeDateChina}`;
    stockDetailBody.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    stockDetailTitle.textContent = `${tsCode} 明细加载失败`;
    stockDetailBody.textContent = error.message;
  }
}

function renderIncomplete(rows) {
  if (!rows.length) {
    incompleteBody.innerHTML = emptyRow(6, '没有缺少历史数据的股票。');
    return;
  }

  incompleteBody.innerHTML = rows
    .map(({ stock, historyBars, latestTradeDate, missingBars, reason }) => `<tr>
      <td><span class="code">${stockCode(stock)}</span></td>
      <td>${stock.name}</td>
      <td>${historyBars}</td>
      <td>${latestTradeDate ?? '-'}</td>
      <td>${missingBars}</td>
      <td class="danger">${reason}</td>
    </tr>`)
    .join('');
}

function renderPayload(payload) {
  const cache = payload.localCache;
  const dataStatus = payload.dataStatus ?? {};
  stockDataDate.textContent = cache?.latestTradeDateChina ?? formatTradeDateChina(cache?.latestTradeDate) ?? '等待数据';
  updatedAt.textContent = payload.updatedAtChina ?? '正在更新';
  expiresAt.textContent = payload.expiresAtChina ?? '-';
  scannedCount.textContent = `${payload.evaluatedCount ?? 0} / ${payload.incompleteCount ?? 0} / ${payload.stockCount ?? payload.candidateCount ?? 0}`;
  matchedCount.textContent = String(payload.matchedCount ?? 0);
  activeConditionCount.textContent = `${payload.activeConditionCount ?? 0} 个`;
  apiKeyStatus.textContent = payload.tushareTokenConfigured ? '已配置' : '未配置';
  apiKeyStatus.className = payload.tushareTokenConfigured ? '' : 'danger';
  sourceText.textContent = payload.source ?? '-';
  tushareHttpUrl.textContent = payload.tushareHttpUrl ?? 'http://8.148.76.181:8686/';
  universeStatus.textContent = payload.universeComplete
    ? `完整全市场：${payload.totalAshareCount ?? payload.stockCount ?? 0} 只`
    : `兜底样本：${payload.stockCount ?? payload.candidateCount ?? 0} / ${payload.totalAshareCount ?? '-'} 只`;
  universeStatus.className = payload.universeComplete ? 'positive' : 'danger';
  localCacheStatus.textContent = cache
    ? `更新至 ${cache.latestTradeDateChina ?? formatTradeDateChina(cache.latestTradeDate)}，${cache.historyDays} 日历史`
    : '正在建立';
  dataStatusText.textContent = dataStatus.label
    ? `${dataStatus.label}${dataStatus.detail ? `｜${dataStatus.detail}` : ''}`
    : '等待数据';
  serverSnapshotStatus.textContent = payload.snapshotLoaded
    ? `已加载，快照生成于 ${payload.updatedAtChina ?? '-'}`
    : dataStatus.label ?? '等待数据';
  browserSnapshotStatus.textContent = payload.browserCache?.savedAtChina
    ? `已写入浏览器，保存于 ${payload.browserCache.savedAtChina}`
    : '尚未写入浏览器';
  browserSnapshotCount.textContent = `${payload.browserCache?.snapshotCount ?? 0} 个版本`;
  browserCacheStatus.textContent = payload.browserCache?.savedAtChina
    ? `已保存于 ${payload.browserCache.savedAtChina}`
    : '尚未保存';
  resultNote.textContent = payload.refreshJob?.running
    ? `后台增量更新中：${payload.refreshJob.phase ?? '处理中'}，启动于 ${payload.refreshJob.startedAtChina}`
    : dataStatus.state === 'degraded'
      ? `快照可继续使用，最后错误：${dataStatus.lastError ?? '未知'}`
      : `缓存内筛选，历史数据持续保留`;

  const errors = payload.errors?.length ? `部分股票评估失败：${payload.errors.join('；')}` : '';
  const warningText = [payload.warning, errors].filter(Boolean).join('。');
  warningBox.hidden = !warningText;
  warningBox.textContent = warningText;
  renderResults(payload.results ?? []);
  renderNearMisses(payload.nearMisses ?? []);
  renderIncomplete(payload.incompleteRows ?? []);
}

async function applyScreen() {
  applyButton.disabled = true;
  applyButton.textContent = '筛选中...';
  const params = new URLSearchParams({ conditions: JSON.stringify(selectedConditions()) });
  try {
    const response = await fetch(`/api/screen?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '筛选失败');
    try {
      await saveBrowserCache(payload);
      const cachedAfterSave = await loadBrowserCache();
      payload.browserCache = browserCacheSummary(cachedAfterSave.meta, cachedAfterSave.snapshots);
    } catch (error) {
      payload.browserCache = null;
    }
    renderPayload(payload);
  } catch (error) {
    warningBox.hidden = false;
    warningBox.textContent = error.message;
  } finally {
    applyButton.disabled = false;
    applyButton.textContent = '应用筛选';
  }
}

async function refreshData() {
  refreshButton.disabled = true;
  refreshButton.textContent = '更新中...';
  try {
    await fetch('/api/refresh', { method: 'POST' });
    warningBox.hidden = false;
    warningBox.textContent = '后台正在补充 Tushare 最新数据，历史缓存会持续保留。';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await applyScreen();
      if (!resultNote.textContent.includes('后台增量更新中')) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = '增量更新';
  }
}

async function init() {
  const response = await fetch('/api/conditions');
  const payload = await response.json();
  conditionDefinitions = payload.conditions ?? [];
  renderConditions();
  try {
    const cached = await loadBrowserCache();
    if (cached.snapshot) {
      renderPayload({ ...cached.snapshot, browserCache: browserCacheSummary(cached.meta, cached.snapshots) });
    }
  } catch (error) {
    browserCacheStatus.textContent = '浏览器缓存未初始化';
  }
  try {
    const snapshotResponse = await fetch('/api/snapshot');
    if (snapshotResponse.ok) {
      const snapshotPayload = await snapshotResponse.json();
      await saveBrowserCache(snapshotPayload);
      const cachedAfterSnapshotSave = await loadBrowserCache();
      renderPayload({
        ...snapshotPayload,
        browserCache: browserCacheSummary(cachedAfterSnapshotSave.meta, cachedAfterSnapshotSave.snapshots)
      });
    }
  } catch (error) {
    browserCacheStatus.textContent = '服务端快照同步失败';
  }
  await applyScreen();
}

applyButton.addEventListener('click', applyScreen);
refreshButton.addEventListener('click', refreshData);
conditionList.addEventListener('change', () => {
  activeConditionCount.textContent = `${selectedConditions().filter((condition) => condition.enabled).length} 个`;
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-stock-detail]');
  if (button) showStockDetail(button.dataset.stockDetail);
});

init();
