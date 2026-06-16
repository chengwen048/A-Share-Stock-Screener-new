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
const chinaClock = document.querySelector('#chinaClock');
const basicDataNote = document.querySelector('#basicDataNote');
const basicSearchInput = document.querySelector('#basicSearchInput');
const basicLimitSelect = document.querySelector('#basicLimitSelect');
const loadBasicDataButton = document.querySelector('#loadBasicDataButton');
const basicDataBody = document.querySelector('#basicDataBody');
const klinePanel = document.querySelector('#klinePanel');
const klineTitle = document.querySelector('#klineTitle');
const klineMeta = document.querySelector('#klineMeta');
const klineCanvas = document.querySelector('#klineCanvas');
const klineStats = document.querySelector('#klineStats');
const closeKlineButton = document.querySelector('#closeKlineButton');
const watchlistBody = document.querySelector('#watchlistBody');
const watchlistNote = document.querySelector('#watchlistNote');

let conditionDefinitions = [];
let browserDb = null;
let basicDataRows = [];
let watchlistRows = [];
let latestScreenRows = { results: [], nearMisses: [] };

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

function renderChinaClock() {
  if (chinaClock) chinaClock.textContent = formatChinaDateTime(new Date());
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

function cacheDateRange(cache) {
  if (!cache) return '等待数据';
  const start = cache.earliestTradeDateChina ?? formatTradeDateChina(cache.earliestTradeDate);
  const end = cache.latestTradeDateChina ?? formatTradeDateChina(cache.latestTradeDate);
  if (start && end && start !== '-' && end !== '-') return `${start} 至 ${end}`;
  if (end && end !== '-' && cache.historyDays) return `近 ${cache.historyDays} 个交易日，更新至 ${end}`;
  return end && end !== '-' ? `更新至 ${end}` : '等待数据';
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

function klineButton(stock) {
  return `<button type="button" class="detail-button" data-stock-kline="${stockCode(stock)}">看K线</button>`;
}

function watchButton(stock, source) {
  return `<button type="button" class="detail-button secondary" data-watch-add="${stockCode(stock)}" data-watch-source="${source}">加入观察</button>`;
}

function loadWatchlist() {
  try {
    watchlistRows = JSON.parse(localStorage.getItem('a-share-watchlist') || '[]');
  } catch (error) {
    watchlistRows = [];
  }
}

function saveWatchlist() {
  localStorage.setItem('a-share-watchlist', JSON.stringify(watchlistRows));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function passBadge(passed) {
  return `<span class="status-pill ${passed ? 'pass' : 'fail'}">${passed ? '通过' : '未通过'}</span>`;
}

function detailValue(value, formatter = formatNumber) {
  return formatter(value);
}

function renderMiniStats(items) {
  return `<div class="mini-stat-grid">
    ${items
      .map((item) => `<div class="mini-stat">
        <span>${escapeHtml(item.label)}</span>
        <strong class="${item.className ?? ''}">${escapeHtml(item.value)}</strong>
      </div>`)
      .join('')}
  </div>`;
}

function renderMiniStatItems(items) {
  return items
    .map((item) => `<div class="mini-stat">
      <span>${escapeHtml(item.label)}</span>
      <strong class="${item.className ?? ''}">${escapeHtml(item.value)}</strong>
    </div>`)
    .join('');
}

function conditionLabel(key) {
  return conditionDefinitions.find((condition) => condition.key === key)?.label ?? key;
}

function explainCondition(key, payload) {
  const metrics = payload.metrics ?? {};
  const details = payload.details ?? {};
  const passed = Boolean(payload.checks?.[key]);
  const row = { title: conditionLabel(key), passed, formula: '', values: [] };

  if (key === 'movingAverageBullish') {
    row.formula = '判断 MA5 > MA10 > MA20 > MA60。';
    row.values = [
      `MA5 ${formatNumber(metrics.ma5)}`,
      `MA10 ${formatNumber(metrics.ma10)}`,
      `MA20 ${formatNumber(metrics.ma20)}`,
      `MA60 ${formatNumber(metrics.ma60)}`
    ];
  } else if (key === 'aboveYearLine') {
    row.formula = '判断收盘价是否站上 250 日均线。';
    row.values = [`收盘 ${formatNumber(metrics.close)}`, `MA250 ${formatNumber(metrics.ma250)}`];
  } else if (key === 'quietPreviousVolume') {
    row.formula = '放量前 20 个交易日成交量越稳定，CV 越小。默认要求 CV < 0.30。';
    row.values = [`CV ${formatNumber(metrics.volumeCv20BeforeBreakout, 3)}`];
  } else if (key === 'twoDayHugeVolume') {
    row.formula = '分别用今日和上一交易日成交量，除以各自之前 20 个交易日均量。默认要求两天都 >= 2.50。';
    row.values = [
      `今日 ${formatNumber(metrics.todayVolumeMultiple20)} 倍`,
      `上一交易日 ${formatNumber(metrics.yesterdayVolumeMultiple20)} 倍`,
      `今日成交量 ${formatNumber(metrics.todayVolume, 0)}`,
      `上一交易日成交量 ${formatNumber(metrics.yesterdayVolume, 0)}`
    ];
  } else if (key === 'twoDayLongUpperShadow') {
    row.formula = '上影线比例 = (最高价 - max(开盘价, 收盘价)) / (最高价 - 最低价)。默认要求两天都 > 45%。';
    row.values = [
      `今日 ${formatPercentRatio(metrics.todayUpperShadowRatio)}`,
      `上一交易日 ${formatPercentRatio(metrics.yesterdayUpperShadowRatio)}`
    ];
  } else if (key === 'twoDayMainMoneyInflow') {
    row.formula = '主力资金 = 特大单净额 + 大单净额。默认要求两天都大于 0。';
    row.values = [
      `今日 ${formatMoney(metrics.todayMainNetInflow)}`,
      `上一交易日 ${formatMoney(metrics.yesterdayMainNetInflow)}`
    ];
    const todayMoney = details.mainMoneyCalculations?.today;
    const previousMoney = details.mainMoneyCalculations?.previous;
    if (todayMoney?.sourceRowAvailable) {
      row.values.push(`今日大单买/卖 ${formatNumber(todayMoney.buyLargeAmountWan)}万 / ${formatNumber(todayMoney.sellLargeAmountWan)}万`);
      row.values.push(`今日特大单买/卖 ${formatNumber(todayMoney.buyExtraLargeAmountWan)}万 / ${formatNumber(todayMoney.sellExtraLargeAmountWan)}万`);
    }
    if (previousMoney?.sourceRowAvailable) {
      row.values.push(`上一交易日大单买/卖 ${formatNumber(previousMoney.buyLargeAmountWan)}万 / ${formatNumber(previousMoney.sellLargeAmountWan)}万`);
      row.values.push(`上一交易日特大单买/卖 ${formatNumber(previousMoney.buyExtraLargeAmountWan)}万 / ${formatNumber(previousMoney.sellExtraLargeAmountWan)}万`);
    }
  } else if (key === 'todayPctChangeMin') {
    row.formula = '判断今日涨跌幅是否达到你设置的下限。';
    row.values = [`今日涨跌幅 ${formatNumber(metrics.pctChange)}%`];
  } else if (key === 'limitUpInLastTwoTradingDays') {
    row.formula = '最近两个交易日内，只要有一天涨跌幅达到你设置的涨停阈值，就算通过。';
    row.values = [
      `今日涨跌幅 ${formatNumber(metrics.pctChange)}%`,
      `上一交易日涨跌幅 ${formatNumber(metrics.yesterdayPctChange)}%`
    ];
  } else if (key === 'twoDayPriceRise') {
    row.formula = '判断今日和上一交易日是否都上涨到你设置的幅度。';
    row.values = [`今日 ${formatNumber(metrics.pctChange)}%`, `上一交易日 ${formatNumber(metrics.yesterdayPctChange)}%`];
  } else if (key === 'twoDayTotalPctMin') {
    row.formula = '把最近两个交易日的涨跌幅复合计算，判断累计涨幅是否达到下限。';
    row.values = [`两日累计 ${formatNumber(metrics.twoDayPctChange)}%`];
  } else if (key === 'todayAmplitudeRange') {
    row.formula = '振幅 = (最高价 - 最低价) / 收盘价。';
    row.values = [`今日振幅 ${formatNumber(metrics.todayAmplitudePct)}%`];
  } else if (key === 'closeNearHigh') {
    row.formula = '收盘位置越接近日内最高价，数值越高。';
    row.values = [`收盘位置 ${formatNumber(metrics.todayClosePositionPct)}%`];
  } else if (key === 'closeAboveOpen') {
    row.formula = '判断今日收盘价是否高于开盘价。';
    row.values = [`开盘 ${formatNumber(metrics.open)}`, `收盘 ${formatNumber(metrics.close)}`];
  } else if (key === 'priceRange') {
    row.formula = '判断收盘价是否在你设置的股价区间内。';
    row.values = [`收盘 ${formatNumber(metrics.close)}`];
  } else if (key === 'amountMin') {
    row.formula = '判断今日成交额是否达到你设置的下限。';
    row.values = [`成交额 ${formatMoney(metrics.amount)}`];
  } else if (key === 'todayVolumeMultipleMin') {
    row.formula = '判断今日20日均量比是否达到下限。';
    row.values = [`今日20日均量比 ${formatNumber(metrics.todayVolumeMultiple20)} 倍`];
  } else if (key === 'todayVolumeMultipleMax') {
    row.formula = '判断今日量能是否没有过热。';
    row.values = [`今日20日均量比 ${formatNumber(metrics.todayVolumeMultiple20)} 倍`];
  } else if (key === 'turnoverRange') {
    row.formula = '判断今日换手率是否在你设置的区间内。';
    row.values = [`换手率 ${formatNumber(metrics.turnover)}%`];
  } else if (key === 'mainMoneyRatioMin') {
    row.formula = '判断今日主力净流入占成交额的比例是否达到下限。';
    row.values = [`主力占比 ${formatNumber(metrics.todayMainMoneyRatio)}%`];
  } else if (key === 'mainMoneyAmountMin') {
    row.formula = '判断今日主力净流入金额是否达到下限。';
    row.values = [`今日主力净流入 ${formatMoney(metrics.todayMainNetInflow)}`];
  } else if (key === 'twoDayMainMoneyAmountMin') {
    row.formula = '判断今日和上一交易日主力净流入金额是否都达到下限。';
    row.values = [`今日 ${formatMoney(metrics.todayMainNetInflow)}`, `上一交易日 ${formatMoney(metrics.yesterdayMainNetInflow)}`];
  } else if (key === 'floatMarketCapMax') {
    row.formula = '判断流通市值是否低于你设置的上限。';
    row.values = [`流通市值 ${formatMoney(metrics.floatMarketCap)}`];
  } else if (key === 'marketCapRange') {
    row.formula = '判断总市值是否在你设置的区间内。';
    row.values = [`总市值 ${formatMoney(metrics.marketCap)}`];
  } else if (key === 'aboveMa20Pct') {
    row.formula = '判断收盘价相对 20 日均线的偏离幅度。';
    row.values = [`高于 MA20 ${formatNumber(metrics.closeVsMa20Pct)}%`];
  } else if (key === 'aboveMa60Pct') {
    row.formula = '判断收盘价相对 60 日均线的偏离幅度。';
    row.values = [`高于 MA60 ${formatNumber(metrics.closeVsMa60Pct)}%`];
  } else if (key === 'ma20SlopeUp') {
    row.formula = '判断 MA20 是否比上一交易日 MA20 更高。';
    row.values = [`MA20斜率 ${formatNumber(metrics.ma20SlopePct, 3)}%`];
  } else if (key === 'ma60SlopeUp') {
    row.formula = '判断 MA60 是否比上一交易日 MA60 更高。';
    row.values = [`MA60斜率 ${formatNumber(metrics.ma60SlopePct, 3)}%`];
  } else if (key === 'upperShadowMax') {
    row.formula = '判断今日上影线比例是否不高。';
    row.values = [`今日上影线 ${formatPercentRatio(metrics.todayUpperShadowRatio)}`];
  } else if (key === 'lowerShadowMin') {
    row.formula = '判断今日下影线比例是否较长。';
    row.values = [`今日下影线 ${formatPercentRatio(metrics.todayLowerShadowRatio)}`];
  } else if (key === 'notSt') {
    row.formula = '排除名称中带 ST 的股票。';
    row.values = [`股票名称 ${payload.stock?.name ?? '-'}`];
  } else if (key === 'marketScope') {
    row.formula = '判断股票是否属于你选择的市场范围。';
    row.values = [`股票代码 ${payload.stock?.ts_code ?? '-'}`];
  } else {
    row.formula = '按当前条件设置判断。';
    row.values = ['暂无更多说明'];
  }

  return row;
}

function renderDetailHtml(payload) {
  const metrics = payload.metrics ?? {};
  const details = payload.details ?? {};
  const failedKeys = payload.failedKeys ?? [];
  const checkKeys = Object.keys(payload.checks ?? {});
  const passedCount = checkKeys.length - failedKeys.length;
  const conditionRows = checkKeys.map((key) => explainCondition(key, payload));
  const today = details.dailyRows?.todayCompact ?? details.dailyRows?.today ?? {};
  const previous = details.dailyRows?.previousCompact ?? details.dailyRows?.previous ?? {};

  return `<div class="detail-panel">
    <div class="detail-hero">
      <div>
        <span class="section-tag">Calculation</span>
        <h3>${escapeHtml(payload.stock?.name)} ${escapeHtml(payload.stock?.ts_code)}</h3>
        <p>实际交易日：${escapeHtml(details.tradingDatePolicy?.actualLatestTradeDateChina ?? '-')}；上一交易日：${escapeHtml(details.tradingDatePolicy?.previousTradeDateChina ?? '-')}</p>
      </div>
      <div class="score-badge">
        <strong>${passedCount}/${checkKeys.length}</strong>
        <span>条件通过</span>
      </div>
    </div>

    ${renderMiniStats([
      { label: '收盘价', value: detailValue(metrics.close) },
      { label: '今日涨跌幅', value: `${detailValue(metrics.pctChange)}%`, className: valueClass(metrics.pctChange) },
      { label: '20日均量比（今）', value: `${detailValue(metrics.todayVolumeMultiple20)} 倍` },
      { label: '20日均量比（昨）', value: `${detailValue(metrics.yesterdayVolumeMultiple20)} 倍` },
      { label: '主力净流入（今）', value: detailValue(metrics.todayMainNetInflow, formatMoney), className: valueClass(metrics.todayMainNetInflow) },
      { label: '主力净流入（昨）', value: detailValue(metrics.yesterdayMainNetInflow, formatMoney), className: valueClass(metrics.yesterdayMainNetInflow) }
    ])}

    <div class="detail-section">
      <h4>结论</h4>
      <p>${failedKeys.length ? `这只股票目前还有 ${failedKeys.length} 个条件未满足：${escapeHtml(failedKeys.map(conditionLabel).join('、'))}。` : '这只股票满足当前勾选的全部条件。'}</p>
    </div>

    <div class="detail-section">
      <h4>逐项判断</h4>
      <div class="condition-result-list">
        ${conditionRows
          .map((row) => `<article class="condition-result ${row.passed ? 'is-pass' : 'is-fail'}">
            <div class="condition-result-head">
              <strong>${escapeHtml(row.title)}</strong>
              ${passBadge(row.passed)}
            </div>
            <p>${escapeHtml(row.formula)}</p>
            <div class="value-chips">${row.values.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</div>
          </article>`)
          .join('')}
      </div>
    </div>

    <div class="detail-section">
      <h4>原始交易数据</h4>
      ${renderMiniStats([
        { label: '今日开盘 / 最高 / 最低', value: `${formatNumber(today.open)} / ${formatNumber(today.high)} / ${formatNumber(today.low)}` },
        { label: '今日收盘 / 成交量', value: `${formatNumber(today.close)} / ${formatNumber(today.volume, 0)}` },
        { label: '上一交易日开盘 / 最高 / 最低', value: `${formatNumber(previous.open)} / ${formatNumber(previous.high)} / ${formatNumber(previous.low)}` },
        { label: '上一交易日收盘 / 成交量', value: `${formatNumber(previous.close)} / ${formatNumber(previous.volume, 0)}` }
      ])}
    </div>
  </div>`;
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
            <option value="500000000"${param.value === 500000000 ? ' selected' : ''}>5 亿</option>
            <option value="1000000000"${param.value === 1000000000 ? ' selected' : ''}>10 亿</option>
            <option value="3000000000"${param.value === 3000000000 ? ' selected' : ''}>30 亿</option>
            <option value="5000000000"${param.value === 5000000000 ? ' selected' : ''}>50 亿</option>
            <option value="10000000000"${param.value === 10000000000 ? ' selected' : ''}>100 亿</option>
            <option value="30000000000"${param.value === 30000000000 ? ' selected' : ''}>300 亿</option>
            <option value="100000000000"${param.value === 100000000000 ? ' selected' : ''}>1000 亿</option>
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
    resultsBody.innerHTML = emptyRow(10, '当前条件下没有命中的股票。');
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
        <td>${watchButton(stock, '命中结果')}</td>
      </tr>`;
    })
    .join('');
}

function renderNearMisses(rows) {
  if (!rows.length) {
    nearMissBody.innerHTML = emptyRow(7, '暂无接近命中数据。');
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
        <td>${watchButton(stock, '接近命中')}</td>
      </tr>`;
    })
    .join('');
}

function renderWatchlist() {
  watchlistNote.textContent = `当前 ${watchlistRows.length} 只，保存在当前浏览器`;
  if (!watchlistRows.length) {
    watchlistBody.innerHTML = emptyRow(6, '暂无待观察股票。');
    return;
  }

  watchlistBody.innerHTML = watchlistRows
    .map((row) => `<tr>
      <td><span class="code">${escapeHtml(row.tsCode)}</span></td>
      <td>${escapeHtml(row.name ?? '-')}</td>
      <td>${escapeHtml(row.addedAtChina ?? '-')}</td>
      <td>${escapeHtml(row.source ?? '-')}</td>
      <td>
        <div class="stack">
          <span>收盘 ${formatNumber(row.metrics?.close)}</span>
          <span>20日均量比 ${formatNumber(row.metrics?.todayVolumeMultiple20)}</span>
          <span>主力 ${formatMoney(row.metrics?.todayMainNetInflow)}</span>
        </div>
      </td>
      <td>
        <button type="button" class="detail-button secondary" data-watch-remove="${escapeHtml(row.tsCode)}">移除</button>
      </td>
    </tr>`)
    .join('');
}

function addToWatchlist(tsCode, source) {
  const rows = [
    ...[...resultsBody.querySelectorAll('[data-watch-add]')].map((button) => button.dataset.watchAdd),
    ...[...nearMissBody.querySelectorAll('[data-watch-add]')].map((button) => button.dataset.watchAdd)
  ];
  if (!rows.includes(tsCode)) return;
  const allRows = [...latestScreenRows.results, ...latestScreenRows.nearMisses];
  const found = allRows.find((row) => stockCode(row.stock) === tsCode);
  if (!found) return;
  watchlistRows = watchlistRows.filter((row) => row.tsCode !== tsCode);
  watchlistRows.unshift({
    tsCode,
    name: found.stock?.name ?? '',
    source,
    addedAt: new Date().toISOString(),
    addedAtChina: formatChinaDateTime(new Date()),
    metrics: {
      close: found.metrics?.close ?? null,
      todayVolumeMultiple20: found.metrics?.todayVolumeMultiple20 ?? null,
      todayMainNetInflow: found.metrics?.todayMainNetInflow ?? null
    }
  });
  saveWatchlist();
  renderWatchlist();
}

function removeFromWatchlist(tsCode) {
  watchlistRows = watchlistRows.filter((row) => row.tsCode !== tsCode);
  saveWatchlist();
  renderWatchlist();
}

async function showStockDetail(tsCode) {
  stockDetailSection.hidden = false;
  stockDetailTitle.textContent = `${tsCode} 计算明细加载中...`;
  stockDetailBody.innerHTML = '<div class="detail-loading">正在读取交易日、日线、资金流和公式明细...</div>';
  try {
    const response = await fetch(`/api/stock/${encodeURIComponent(tsCode)}/detail`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '明细加载失败');
    stockDetailTitle.textContent = `${payload.stock.name} ${payload.stock.ts_code}`;
    stockDetailBody.innerHTML = renderDetailHtml(payload);
    stockDetailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    stockDetailTitle.textContent = `${tsCode} 明细加载失败`;
    stockDetailBody.innerHTML = `<div class="detail-loading danger">${escapeHtml(error.message)}</div>`;
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

function renderBasicRows() {
  const keyword = basicSearchInput.value.trim().toLowerCase();
  const limit = Number(basicLimitSelect.value);
  const filtered = basicDataRows
    .filter((row) => {
      if (!keyword) return true;
      return `${row.ts_code ?? ''} ${row.name ?? ''} ${row.industry ?? ''}`.toLowerCase().includes(keyword);
    })
    .slice(0, limit);

  basicDataNote.textContent = `共 ${basicDataRows.length} 只，当前显示 ${filtered.length} 只`;
  if (!filtered.length) {
    basicDataBody.innerHTML = emptyRow(9, '没有匹配的股票。');
    return;
  }

  basicDataBody.innerHTML = filtered
    .map(({ stock, metrics }) => `<tr>
      <td><span class="code">${stockCode(stock)}</span></td>
      <td>
        <div class="stack">
          <strong>${escapeHtml(stock.name)}</strong>
          <span class="muted">上市 ${escapeHtml(formatTradeDateChina(stock.list_date) || '-')}</span>
        </div>
      </td>
      <td>
        <div class="stack">
          <span>${escapeHtml(stock.area ?? '-')}</span>
          <span class="muted">${escapeHtml(stock.industry ?? '-')}</span>
        </div>
      </td>
      <td>${escapeHtml(stock.market ?? stock.exchangeName ?? '-')}</td>
      <td>
        <div class="stack">
          <strong>${formatNumber(metrics.close)}</strong>
          <span class="${valueClass(metrics.pctChange)}">${formatNumber(metrics.pctChange)}%</span>
        </div>
      </td>
      <td>
        <div class="stack">
          <span>${formatMoney(metrics.amount)}</span>
          <span class="muted">换手 ${formatNumber(metrics.turnover)}%</span>
        </div>
      </td>
      <td>
        <div class="stack">
          <span>总 ${formatMoney(metrics.marketCap)}</span>
          <span class="muted">流通 ${formatMoney(metrics.floatMarketCap)}</span>
        </div>
      </td>
      <td>
        <div class="stack">
          <span>MA20 ${formatNumber(metrics.ma20)}</span>
          <span class="muted">MA60 ${formatNumber(metrics.ma60)} / MA250 ${formatNumber(metrics.ma250)}</span>
        </div>
      </td>
      <td>${klineButton(stock)}</td>
    </tr>`)
    .join('');
}

async function loadBasicData() {
  loadBasicDataButton.disabled = true;
  loadBasicDataButton.textContent = '读取中...';
  try {
    const response = await fetch('/api/basic-data');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '基本数据加载失败');
    basicDataRows = payload.rows ?? [];
    renderBasicRows();
  } catch (error) {
    basicDataNote.textContent = error.message;
    basicDataBody.innerHTML = emptyRow(9, error.message);
  } finally {
    loadBasicDataButton.disabled = false;
    loadBasicDataButton.textContent = '刷新基本数据';
  }
}

function drawKlineChart(bars) {
  const ctx = klineCanvas.getContext('2d');
  const width = klineCanvas.width;
  const height = klineCanvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#080c25';
  ctx.fillRect(0, 0, width, height);
  if (!bars.length) return;

  const padding = { left: 54, right: 22, top: 24, bottom: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visibleBars = bars.slice(-120);
  const highs = visibleBars.map((bar) => Number(bar.high)).filter(Number.isFinite);
  const lows = visibleBars.map((bar) => Number(bar.low)).filter(Number.isFinite);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = maxPrice - minPrice || 1;
  const xStep = chartWidth / visibleBars.length;
  const candleWidth = Math.max(3, Math.min(9, xStep * 0.58));
  const y = (price) => padding.top + ((maxPrice - price) / priceRange) * chartHeight;

  ctx.strokeStyle = 'rgba(97, 217, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(197, 212, 246, 0.72)';
  ctx.font = '12px system-ui';
  for (let i = 0; i <= 4; i += 1) {
    const yy = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, yy);
    ctx.lineTo(width - padding.right, yy);
    ctx.stroke();
    const price = maxPrice - (priceRange / 4) * i;
    ctx.fillText(formatNumber(price), 8, yy + 4);
  }

  visibleBars.forEach((bar, index) => {
    const open = Number(bar.open);
    const close = Number(bar.close);
    const high = Number(bar.high);
    const low = Number(bar.low);
    if (![open, close, high, low].every(Number.isFinite)) return;
    const x = padding.left + index * xStep + xStep / 2;
    const isUp = close >= open;
    const color = isUp ? '#ff6f91' : '#76ffb5';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y(high));
    ctx.lineTo(x, y(low));
    ctx.stroke();
    const bodyTop = y(Math.max(open, close));
    const bodyHeight = Math.max(2, Math.abs(y(open) - y(close)));
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });

  ctx.fillStyle = 'rgba(197, 212, 246, 0.78)';
  const first = visibleBars[0]?.tradeDateChina ?? '';
  const last = visibleBars.at(-1)?.tradeDateChina ?? '';
  ctx.fillText(first, padding.left, height - 16);
  ctx.fillText(last, width - padding.right - 106, height - 16);
}

async function showKline(tsCode) {
  klinePanel.hidden = false;
  klineTitle.textContent = `${tsCode} K 线加载中...`;
  klineMeta.textContent = '正在读取最近交易日 K 线';
  try {
    const response = await fetch(`/api/stock/${encodeURIComponent(tsCode)}/kline`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || 'K线加载失败');
    const bars = payload.bars ?? [];
    const latest = bars.at(-1) ?? {};
    klineTitle.textContent = `${payload.stock.name} ${payload.stock.ts_code}`;
    klineMeta.textContent = `${bars[0]?.tradeDateChina ?? '-'} 至 ${latest.tradeDateChina ?? '-'}，共 ${bars.length} 根K线`;
    drawKlineChart(bars);
    klineStats.innerHTML = renderMiniStatItems([
      { label: '最新交易日', value: latest.tradeDateChina ?? '-' },
      { label: '收盘价', value: formatNumber(latest.close) },
      { label: '涨跌幅', value: `${formatNumber(latest.pctChange)}%`, className: valueClass(latest.pctChange) },
      { label: '最高 / 最低', value: `${formatNumber(latest.high)} / ${formatNumber(latest.low)}` },
      { label: '成交量', value: formatNumber(latest.volume, 0) },
      { label: '成交额', value: formatMoney(latest.amount) }
    ]);
  } catch (error) {
    klineTitle.textContent = `${tsCode} K 线加载失败`;
    klineMeta.textContent = error.message;
  }
}

function closeKline() {
  klinePanel.hidden = true;
}

function renderPayload(payload) {
  const cache = payload.localCache;
  const dataStatus = payload.dataStatus ?? {};
  stockDataDate.textContent = cacheDateRange(cache);
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
    ? `${cacheDateRange(cache)}，${cache.historyDays} 个交易日`
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
  latestScreenRows = {
    results: payload.results ?? [],
    nearMisses: payload.nearMisses ?? []
  };
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
  renderChinaClock();
  setInterval(renderChinaClock, 1000);
  loadWatchlist();
  renderWatchlist();
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
  await loadBasicData();
}

applyButton.addEventListener('click', applyScreen);
refreshButton.addEventListener('click', refreshData);
conditionList.addEventListener('change', () => {
  activeConditionCount.textContent = `${selectedConditions().filter((condition) => condition.enabled).length} 个`;
});
basicSearchInput.addEventListener('input', renderBasicRows);
basicLimitSelect.addEventListener('change', renderBasicRows);
loadBasicDataButton.addEventListener('click', loadBasicData);
closeKlineButton.addEventListener('click', closeKline);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-stock-detail]');
  if (button) showStockDetail(button.dataset.stockDetail);
  const kline = event.target.closest('[data-stock-kline]');
  if (kline) showKline(kline.dataset.stockKline);
  const addWatch = event.target.closest('[data-watch-add]');
  if (addWatch) addToWatchlist(addWatch.dataset.watchAdd, addWatch.dataset.watchSource);
  const removeWatch = event.target.closest('[data-watch-remove]');
  if (removeWatch) removeFromWatchlist(removeWatch.dataset.watchRemove);
  if (event.target === klinePanel) closeKline();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !klinePanel.hidden) {
    closeKline();
  }
});

document.querySelectorAll('.toc-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.toc-link').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
  });
});

init();
