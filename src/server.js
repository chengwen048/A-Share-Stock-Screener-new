import 'dotenv/config';
import express from 'express';
import pLimit from 'p-limit';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const CHINA_TIME_ZONE = 'Asia/Shanghai';
const CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TUSHARE_HTTP_URL = process.env.TUSHARE_HTTP_URL || 'http://8.148.76.181:8686/';
const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || '';
const DATA_DIR = path.join(__dirname, '..', 'data', 'tushare');
const CACHE_DIRS = {
  daily: path.join(DATA_DIR, 'daily'),
  dailyBasic: path.join(DATA_DIR, 'daily_basic'),
  moneyflow: path.join(DATA_DIR, 'moneyflow'),
  meta: path.join(DATA_DIR, 'meta'),
  snapshot: path.join(DATA_DIR, 'snapshot')
};

const conditionDefinitions = [
  {
    key: 'movingAverageBullish',
    label: '均线多头排列',
    group: '核心形态',
    description: '5日 > 10日 > 20日 > 60日均线',
    defaultEnabled: true
  },
  {
    key: 'aboveYearLine',
    label: '年线之上',
    group: '核心形态',
    description: '收盘价 > 250日均线',
    defaultEnabled: true
  },
  {
    key: 'quietPreviousVolume',
    label: '前期成交量沉闷',
    group: '核心形态',
    description: '放量前20日成交量变异系数 < 阈值',
    defaultEnabled: true,
    params: [{ key: 'cvMax', label: 'CV小于', type: 'number', value: 0.3, step: 0.01 }]
  },
  {
    key: 'twoDayHugeVolume',
    label: '连续两天放巨量',
    group: '核心形态',
    description: '当天和昨天成交量 / 各自前20日均量 >= 阈值',
    defaultEnabled: true,
    params: [{ key: 'ratioMin', label: '20日均量比至少', type: 'number', value: 2.5, step: 0.1 }]
  },
  {
    key: 'twoDayLongUpperShadow',
    label: '连续两天长上影线',
    group: '核心形态',
    description: '上影线比例连续两天 > 阈值',
    defaultEnabled: true,
    params: [{ key: 'ratioMin', label: '比例大于', type: 'number', value: 0.45, step: 0.01 }]
  },
  {
    key: 'twoDayMainMoneyInflow',
    label: '连续两天主力净流入',
    group: '核心资金',
    description: '特大单 + 大单净流入连续两天 > 0',
    defaultEnabled: true
  },
  {
    key: 'todayPctChangeMin',
    label: '今日涨幅下限',
    group: '行情扩展',
    description: '今日涨跌幅不低于指定百分比',
    defaultEnabled: false,
    params: [{ key: 'min', label: '涨幅 >= %', type: 'number', value: 0, step: 0.1 }]
  },
  {
    key: 'marketScope',
    label: '市场范围',
    group: '行情扩展',
    description: '按沪深京与重点板块范围过滤',
    defaultEnabled: false,
    params: [
      {
        key: 'scope',
        label: '范围',
        type: 'select',
        value: 'ALL',
        options: [
          { value: 'ALL', label: '全部 A 股' },
          { value: 'SH', label: '沪市' },
          { value: 'SZ', label: '深市' },
          { value: 'GEM', label: '创业板' },
          { value: 'STAR', label: '科创板' },
          { value: 'BJ', label: '北交所' }
        ]
      }
    ]
  },
  {
    key: 'priceRange',
    label: '股价区间',
    group: '行情扩展',
    description: '收盘价在指定区间内',
    defaultEnabled: false,
    params: [
      { key: 'min', label: '最低价', type: 'number', value: 5, step: 0.1 },
      { key: 'max', label: '最高价', type: 'number', value: 80, step: 0.1 }
    ]
  },
  {
    key: 'amountMin',
    label: '成交额下限',
    group: '行情扩展',
    description: '今日成交额不低于指定金额',
    defaultEnabled: false,
    params: [{ key: 'min', label: '至少', type: 'money', value: 100000000 }]
  },
  {
    key: 'turnoverRange',
    label: '换手率区间',
    group: '行情扩展',
    description: '今日换手率在指定范围内',
    defaultEnabled: false,
    params: [
      { key: 'min', label: '最低%', type: 'number', value: 2, step: 0.1 },
      { key: 'max', label: '最高%', type: 'number', value: 20, step: 0.1 }
    ]
  },
  {
    key: 'mainMoneyRatioMin',
    label: '主力净流入占比',
    group: '资金扩展',
    description: '今日主力净流入 / 今日成交额不低于指定比例',
    defaultEnabled: false,
    params: [{ key: 'min', label: '占比 >= %', type: 'number', value: 1, step: 0.1 }]
  },
  {
    key: 'twoDayMainMoneyAmountMin',
    label: '两日主力金额下限',
    group: '资金扩展',
    description: '今天和昨天主力净流入金额均不低于指定金额',
    defaultEnabled: false,
    params: [{ key: 'min', label: '至少', type: 'money', value: 10000000 }]
  },
  {
    key: 'notSt',
    label: '排除 ST',
    group: '风险过滤',
    description: '剔除简称包含 ST、*ST 的股票',
    defaultEnabled: false
  },
  {
    key: 'floatMarketCapMax',
    label: '流通市值上限',
    group: '风险过滤',
    description: '流通市值不高于指定金额',
    defaultEnabled: false,
    params: [{ key: 'max', label: '不高于', type: 'money', value: 30000000000 }]
  },
  {
    key: 'aboveMa20Pct',
    label: '强于20日线',
    group: '行情扩展',
    description: '收盘价高于20日均线指定百分比',
    defaultEnabled: false,
    params: [{ key: 'min', label: '高于%', type: 'number', value: 3, step: 0.1 }]
  }
];

const conditionMap = new Map(conditionDefinitions.map((condition) => [condition.key, condition]));
const tsState = {
  token: TUSHARE_TOKEN,
  httpUrl: DEFAULT_TUSHARE_HTTP_URL
};

let datasetCache = null;
let refreshJob = {
  running: false,
  startedAt: null,
  startedAtChina: null,
  finishedAt: null,
  finishedAtChina: null,
  error: null,
  lastErrorAt: null,
  lastErrorAtChina: null,
  phase: null,
  progress: null,
  promise: null
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function nowIso() {
  return new Date().toISOString();
}

function formatChinaTime(value = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function parseDateToIso(dateStr) {
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00.000Z`;
}

function isoToTradeDate(value) {
  const text = String(value ?? '');
  if (/^\d{8}$/.test(text)) return text;
  const match = text.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : '';
}

function toNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const numeric = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (!values.length) return null;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function movingAverage(rows, endIndex, windowSize, field = 'close') {
  const start = endIndex - windowSize + 1;
  if (start < 0) return null;
  const values = rows.slice(start, endIndex + 1).map((row) => row[field]).filter(Number.isFinite);
  if (values.length !== windowSize) return null;
  return average(values);
}

function previousAverageVolume(rows, endIndex, windowSize = 20) {
  const start = endIndex - windowSize;
  if (start < 0) return null;
  const values = rows.slice(start, endIndex).map((row) => row.volume).filter(Number.isFinite);
  if (values.length !== windowSize) return null;
  return average(values);
}

function previousVolumeCv(rows, endIndex, windowSize = 20) {
  const start = endIndex - windowSize;
  if (start < 0) return null;
  const values = rows.slice(start, endIndex).map((row) => row.volume).filter(Number.isFinite);
  if (values.length !== windowSize) return null;
  const mean = average(values);
  if (!mean) return null;
  return stddev(values) / mean;
}

function upperShadowRatio(row) {
  if (!row) return null;
  const range = row.high - row.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  return (row.high - Math.max(row.open, row.close)) / range;
}

function percentFromAmount(value, precision = 2) {
  if (!Number.isFinite(value)) return null;
  return Number((value * 100).toFixed(precision));
}

function parseKlineRow(row) {
  return {
    date: parseDateToIso(String(row.trade_date)),
    open: toNumber(row.open),
    close: toNumber(row.close),
    high: toNumber(row.high),
    low: toNumber(row.low),
    volume: toNumber(row.vol),
    amount: toNumber(row.amount) === null ? null : toNumber(row.amount) * 1000,
    pctChange: toNumber(row.pct_chg),
    change: toNumber(row.change),
    turnover: toNumber(row.turnover_rate)
  };
}

function parseMoneyFlowRow(row) {
  return {
    date: parseDateToIso(String(row.trade_date)),
    superLargeIn: toNumber(row.buy_elg_amount) === null ? null : toNumber(row.buy_elg_amount) * 10000,
    superLargeOut: toNumber(row.sell_elg_amount) === null ? null : toNumber(row.sell_elg_amount) * 10000,
    largeIn: toNumber(row.buy_lg_amount) === null ? null : toNumber(row.buy_lg_amount) * 10000,
    largeOut: toNumber(row.sell_lg_amount) === null ? null : toNumber(row.sell_lg_amount) * 10000,
    mediumIn: toNumber(row.buy_md_amount) === null ? null : toNumber(row.buy_md_amount) * 10000,
    mediumOut: toNumber(row.sell_md_amount) === null ? null : toNumber(row.sell_md_amount) * 10000,
    smallIn: toNumber(row.buy_sm_amount) === null ? null : toNumber(row.buy_sm_amount) * 10000,
    smallOut: toNumber(row.sell_sm_amount) === null ? null : toNumber(row.sell_sm_amount) * 10000
  };
}

function buildDataStatus() {
  if (!datasetCache) {
    return {
      state: 'loading',
      label: refreshJob.running ? '首次加载中' : '等待快照',
      detail: refreshJob.running ? '正在构建首份全市场快照' : '尚未完成首份快照加载',
      snapshotLoaded: false,
      refreshRunning: refreshJob.running,
      actualDailyDataLatestTradeDateChina: null,
      exchangeCalendarLatestOpenDateChina: null,
      updatedAtChina: null,
      lastError: refreshJob.error,
      lastErrorAtChina: refreshJob.lastErrorAtChina,
      nextCheckAtChina: null
    };
  }

  if (refreshJob.running) {
    return {
      state: 'refreshing',
      label: datasetCache.snapshotLoaded ? '快照可用，增量更新中' : '增量更新中',
      detail: `启动于 ${refreshJob.startedAtChina}`,
      snapshotLoaded: Boolean(datasetCache.snapshotLoaded),
      refreshRunning: true,
      actualDailyDataLatestTradeDateChina: datasetCache.localCache?.latestTradeDateChina ?? null,
      exchangeCalendarLatestOpenDateChina: datasetCache.localCache?.calendarLatestTradeDateChina ?? null,
      updatedAtChina: datasetCache.updatedAtChina ?? null,
      lastError: refreshJob.error,
      lastErrorAtChina: refreshJob.lastErrorAtChina,
      nextCheckAtChina: datasetCache.expiresAtChina ?? null
    };
  }

  if (refreshJob.error) {
    return {
      state: 'degraded',
      label: datasetCache.snapshotLoaded ? '快照可用，更新失败' : '更新失败',
      detail: refreshJob.error,
      snapshotLoaded: Boolean(datasetCache.snapshotLoaded),
      refreshRunning: false,
      actualDailyDataLatestTradeDateChina: datasetCache.localCache?.latestTradeDateChina ?? null,
      exchangeCalendarLatestOpenDateChina: datasetCache.localCache?.calendarLatestTradeDateChina ?? null,
      updatedAtChina: datasetCache.updatedAtChina ?? null,
      lastError: refreshJob.error,
      lastErrorAtChina: refreshJob.lastErrorAtChina,
      nextCheckAtChina: datasetCache.expiresAtChina ?? null
    };
  }

  return {
    state: 'ready',
    label: datasetCache.snapshotLoaded ? '快照已加载' : '缓存已就绪',
    detail: `最新交易日 ${datasetCache.localCache?.latestTradeDateChina ?? datasetCache.updatedAtChina ?? '-'}`,
    snapshotLoaded: Boolean(datasetCache.snapshotLoaded),
    refreshRunning: false,
    actualDailyDataLatestTradeDateChina: datasetCache.localCache?.latestTradeDateChina ?? null,
    exchangeCalendarLatestOpenDateChina: datasetCache.localCache?.calendarLatestTradeDateChina ?? null,
    updatedAtChina: datasetCache.updatedAtChina ?? null,
    lastError: null,
    lastErrorAtChina: refreshJob.lastErrorAtChina,
    nextCheckAtChina: datasetCache.expiresAtChina ?? null
  };
}

function normalizeListField(row) {
  const [code, exchange] = String(row.ts_code ?? '').split('.');
  return {
    ts_code: row.ts_code,
    code,
    exchange,
    symbol: row.symbol,
    name: row.name,
    area: row.area,
    industry: row.industry,
    market: row.market,
    exchangeName: row.exchange,
    list_date: row.list_date,
    curr_type: row.curr_type
  };
}

async function tushareRequest(apiName, params = {}, fields = '') {
  const response = await fetch(tsState.httpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_name: apiName,
      token: tsState.token,
      params,
      fields
    })
  });
  if (!response.ok) {
    throw new Error(`Tushare HTTP 请求失败: HTTP ${response.status}`);
  }
  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(`Tushare 接口失败: ${json.msg || json.code}`);
  }
  return json.data ?? { fields: [], items: [] };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCacheDirs() {
  await Promise.all(Object.values(CACHE_DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
}

function cacheFile(kind, key) {
  return path.join(CACHE_DIRS[kind], `${key}.json`);
}

function snapshotFile() {
  return path.join(CACHE_DIRS.snapshot, 'dataset.json');
}

async function getCachedDateRows(kind, tradeDate, fetcher) {
  const filePath = cacheFile(kind, tradeDate);
  const cached = await readJsonFile(filePath);
  if (Array.isArray(cached?.rows) && cached.rows.length > 0) return cached.rows;
  const rows = await fetcher(tradeDate);
  await writeJsonFile(filePath, {
    tradeDate,
    fetchedAt: nowIso(),
    fetchedAtChina: formatChinaTime(),
    rows
  });
  return rows;
}

function markRefreshProgress(phase, progress = null) {
  refreshJob.phase = phase;
  refreshJob.progress = progress;
}

async function getCachedMeta(key, fetcher) {
  const filePath = cacheFile('meta', key);
  const cached = await readJsonFile(filePath);
  if (cached?.rows) return cached.rows;
  const rows = await fetcher();
  await writeJsonFile(filePath, {
    key,
    fetchedAt: nowIso(),
    fetchedAtChina: formatChinaTime(),
    rows
  });
  return rows;
}

async function readSnapshot() {
  return readJsonFile(snapshotFile());
}

async function writeSnapshot(payload) {
  await writeJsonFile(snapshotFile(), payload);
}

async function getTradingDates() {
  const data = await tushareRequest('trade_cal', {
    exchange: 'SSE',
    start_date: '20240101',
    end_date: formatChinaTime(new Date()).replace(/[-/ :]/g, '').slice(0, 8),
    is_open: '1'
  }, 'cal_date,is_open,pretrade_date');
  return (data.items ?? []).map((item) => String(item[0])).sort();
}

async function getStockBasics() {
  return getCachedMeta('stock_basic_L', async () => {
    const data = await tushareRequest('stock_basic', {
      exchange: '',
      list_status: 'L',
      is_hs: '',
      fields: 'ts_code,symbol,name,area,industry,market,exchange,list_date,curr_type'
    }, 'ts_code,symbol,name,area,industry,market,exchange,list_date,curr_type');
    return (data.items ?? []).map((item) => normalizeListField({
      ts_code: item[0],
      symbol: item[1],
      name: item[2],
      area: item[3],
      industry: item[4],
      market: item[5],
      exchange: item[6],
      list_date: item[7],
      curr_type: item[8]
    }));
  });
}

async function getDailyBars(tsCode, startDate, endDate) {
  const data = await tushareRequest('daily', {
    ts_code: tsCode,
    start_date: startDate,
    end_date: endDate
  }, 'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount');
  const fields = data.fields ?? [];
  return (data.items ?? [])
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])))
    .map(parseKlineRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getDailyByTradeDate(tradeDate) {
  return getCachedDateRows('daily', tradeDate, fetchDailyByTradeDate);
}

async function fetchDailyByTradeDate(tradeDate) {
  const data = await tushareRequest('daily', {
    trade_date: tradeDate
  }, 'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount');
  const fields = data.fields ?? [];
  return (data.items ?? [])
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])));
}

async function getDailyBasicByTradeDate(tradeDate) {
  return getCachedDateRows('dailyBasic', tradeDate, fetchDailyBasicByTradeDate);
}

async function fetchDailyBasicByTradeDate(tradeDate) {
  const data = await tushareRequest('daily_basic', {
    trade_date: tradeDate
  }, 'ts_code,trade_date,turnover_rate,total_mv,circ_mv');
  const fields = data.fields ?? [];
  return (data.items ?? [])
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])));
}

async function getMoneyFlowByTradeDate(tradeDate) {
  return getCachedDateRows('moneyflow', tradeDate, fetchMoneyFlowByTradeDate);
}

async function fetchMoneyFlowByTradeDate(tradeDate) {
  const data = await tushareRequest('moneyflow', {
    trade_date: tradeDate
  }, 'ts_code,trade_date,buy_sm_amount,sell_sm_amount,buy_md_amount,sell_md_amount,buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount');
  const fields = data.fields ?? [];
  return (data.items ?? [])
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])));
}

async function getMoneyFlow(tsCode, startDate, endDate) {
  const data = await tushareRequest('moneyflow', {
    ts_code: tsCode,
    start_date: startDate,
    end_date: endDate
  }, 'ts_code,trade_date,buy_sm_amount,sell_sm_amount,buy_md_amount,sell_md_amount,buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount');
  const fields = data.fields ?? [];
  return (data.items ?? [])
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])))
    .map(parseMoneyFlowRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getMoneyFlowRawForStock(tsCode, startDate, endDate) {
  const data = await tushareRequest('moneyflow', {
    ts_code: tsCode,
    start_date: startDate,
    end_date: endDate
  }, 'ts_code,trade_date,buy_sm_amount,sell_sm_amount,buy_md_amount,sell_md_amount,buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount');
  const fields = data.fields ?? [];
  return (data.items ?? [])
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])))
    .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
}

async function getDailyRowsForStockFromDateCache(tsCode, tradingDates) {
  const rows = [];
  for (const tradeDate of tradingDates) {
    const dailyRows = await getDailyByTradeDate(tradeDate);
    const row = dailyRows.find((item) => item.ts_code === tsCode);
    if (row) rows.push(parseKlineRow(row));
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function getMoneyFlowRawForStockFromDateCache(tsCode, tradeDates) {
  const rows = [];
  for (const tradeDate of tradeDates) {
    const flowRows = await getMoneyFlowByTradeDate(tradeDate);
    const row = flowRows.find((item) => item.ts_code === tsCode);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  return rows;
}

function compactBar(row) {
  if (!row) return null;
  return {
    tradeDate: isoToTradeDate(row.date),
    tradeDateChina: formatTradeDateChina(row.date),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volumeLots: row.volume,
    amountYuan: row.amount,
    pctChangePercent: row.pctChange,
    turnoverPercent: row.turnover
  };
}

function movingAverageDetail(rows, endIndex, windowSize) {
  const start = endIndex - windowSize + 1;
  const windowRows = start >= 0 ? rows.slice(start, endIndex + 1) : [];
  const closes = windowRows.map((row) => row.close).filter(Number.isFinite);
  return {
    windowSize,
    formula: `${windowSize}日均线 = 最近${windowSize}个交易日收盘价之和 / ${windowSize}`,
    tradeDateStart: windowRows.at(0) ? isoToTradeDate(windowRows.at(0).date) : null,
    tradeDateEnd: windowRows.at(-1) ? isoToTradeDate(windowRows.at(-1).date) : null,
    closeSum: closes.length === windowSize ? closes.reduce((sum, value) => sum + value, 0) : null,
    validCloseCount: closes.length,
    value: closes.length === windowSize ? average(closes) : null,
    sourceRows: windowRows.map((row) => ({
      tradeDate: isoToTradeDate(row.date),
      close: row.close
    }))
  };
}

function previousVolumeAverageDetail(rows, endIndex, windowSize = 20) {
  const start = endIndex - windowSize;
  const windowRows = start >= 0 ? rows.slice(start, endIndex) : [];
  const volumes = windowRows.map((row) => row.volume).filter(Number.isFinite);
  return {
    windowSize,
    formula: `前${windowSize}个交易日成交量均值 = 前${windowSize}个交易日成交量之和 / ${windowSize}`,
    tradeDateStart: windowRows.at(0) ? isoToTradeDate(windowRows.at(0).date) : null,
    tradeDateEnd: windowRows.at(-1) ? isoToTradeDate(windowRows.at(-1).date) : null,
    volumeSumLots: volumes.length === windowSize ? volumes.reduce((sum, value) => sum + value, 0) : null,
    validVolumeCount: volumes.length,
    value: volumes.length === windowSize ? average(volumes) : null,
    sourceRows: windowRows.map((row) => ({
      tradeDate: isoToTradeDate(row.date),
      volumeLots: row.volume
    }))
  };
}

function previousVolumeCvDetail(rows, endIndex, windowSize = 20) {
  const avgDetail = previousVolumeAverageDetail(rows, endIndex, windowSize);
  const volumes = avgDetail.sourceRows.map((row) => row.volumeLots).filter(Number.isFinite);
  const mean = volumes.length === windowSize ? average(volumes) : null;
  const std = volumes.length === windowSize ? stddev(volumes) : null;
  return {
    ...avgDetail,
    formula: `成交量变异系数 = 前${windowSize}个交易日成交量标准差 / 前${windowSize}个交易日成交量均值`,
    meanVolumeLots: mean,
    stddevVolumeLots: std,
    value: mean ? std / mean : null
  };
}

function upperShadowDetail(row) {
  return {
    sourceRow: compactBar(row),
    formula: '(最高价 - max(开盘价, 收盘价)) / (最高价 - 最低价)',
    numerator: row ? row.high - Math.max(row.open, row.close) : null,
    denominator: row ? row.high - row.low : null,
    value: upperShadowRatio(row)
  };
}

function moneyFlowDetail(rawRow) {
  if (!rawRow) {
    return {
      sourceRowAvailable: false,
      formula: '主力净流入 = (大单买入 - 大单卖出 + 特大单买入 - 特大单卖出) * 10000',
      valueYuan: null
    };
  }
  const buyLargeWan = toNumber(rawRow.buy_lg_amount);
  const sellLargeWan = toNumber(rawRow.sell_lg_amount);
  const buyExtraLargeWan = toNumber(rawRow.buy_elg_amount);
  const sellExtraLargeWan = toNumber(rawRow.sell_elg_amount);
  const valueYuan = [buyLargeWan, sellLargeWan, buyExtraLargeWan, sellExtraLargeWan].every(hasValue)
    ? ((buyLargeWan - sellLargeWan) + (buyExtraLargeWan - sellExtraLargeWan)) * 10000
    : null;
  return {
    sourceRowAvailable: true,
    tradeDate: String(rawRow.trade_date),
    tradeDateChina: formatTradeDateChina(rawRow.trade_date),
    formula: '主力净流入 = (大单买入 - 大单卖出 + 特大单买入 - 特大单卖出) * 10000',
    buyLargeAmountWan: buyLargeWan,
    sellLargeAmountWan: sellLargeWan,
    buyExtraLargeAmountWan: buyExtraLargeWan,
    sellExtraLargeAmountWan: sellExtraLargeWan,
    valueYuan
  };
}

function buildCalculationDetails({ stock, bars, rawFlows, metrics }) {
  const lastIndex = bars.length - 1;
  const prevIndex = bars.length - 2;
  const today = bars.at(-1) ?? null;
  const previous = bars.at(-2) ?? null;
  const rawFlowByDate = new Map(rawFlows.map((row) => [parseDateToIso(String(row.trade_date)), row]));
  const todayAvgVolume20 = previousVolumeAverageDetail(bars, lastIndex);
  const previousAvgVolume20 = previousVolumeAverageDetail(bars, prevIndex);

  return {
    stockCode: stock.ts_code,
    stockName: stock.name,
    tradingDatePolicy: {
      description: '所有指标只使用 Tushare trade_cal 中 is_open=1 的交易日；若交易日当天日线为空，则回退到最近一个有实际日线数据的交易日。',
      actualLatestTradeDate: isoToTradeDate(today?.date),
      actualLatestTradeDateChina: formatTradeDateChina(today?.date),
      previousTradeDate: isoToTradeDate(previous?.date),
      previousTradeDateChina: formatTradeDateChina(previous?.date)
    },
    dailyRows: {
      today,
      previous,
      todayCompact: compactBar(today),
      previousCompact: compactBar(previous)
    },
    movingAverages: {
      ma5: movingAverageDetail(bars, lastIndex, 5),
      ma10: movingAverageDetail(bars, lastIndex, 10),
      ma20: movingAverageDetail(bars, lastIndex, 20),
      ma60: movingAverageDetail(bars, lastIndex, 60),
      ma250: movingAverageDetail(bars, lastIndex, 250)
    },
    yearLineCondition: {
      formula: '收盘价 > 250日均线',
      close: today?.close ?? null,
      ma250: metrics?.ma250 ?? movingAverage(bars, lastIndex, 250),
      passed: hasValue(today?.close) && hasValue(metrics?.ma250) && today.close > metrics.ma250
    },
    volumeCalculations: {
      today20DayVolumeMultiple: {
        formula: '今日20日均量比 = 今日成交量 / 今日之前20个交易日成交量均值',
        todayVolumeLots: today?.volume ?? null,
        previous20DayAverageVolumeLots: todayAvgVolume20.value,
        value: todayAvgVolume20.value ? today.volume / todayAvgVolume20.value : null,
        sourceWindow: todayAvgVolume20.sourceRows
      },
      previous20DayVolumeMultiple: {
        formula: '昨日20日均量比 = 昨日成交量 / 昨日之前20个交易日成交量均值',
        previousVolumeLots: previous?.volume ?? null,
        previous20DayAverageVolumeLots: previousAvgVolume20.value,
        value: previousAvgVolume20.value ? previous.volume / previousAvgVolume20.value : null,
        sourceWindow: previousAvgVolume20.sourceRows
      },
      previousVolumeCvBeforeBreakout: previousVolumeCvDetail(bars, prevIndex)
    },
    upperShadowCalculations: {
      today: upperShadowDetail(today),
      previous: upperShadowDetail(previous)
    },
    mainMoneyCalculations: {
      today: moneyFlowDetail(today ? rawFlowByDate.get(today.date) : null),
      previous: moneyFlowDetail(previous ? rawFlowByDate.get(previous.date) : null)
    }
  };
}

function marketScopeMatch(scope, row) {
  const code = row.ts_code?.split('.')[0] ?? '';
  const exchange = row.exchangeName ?? row.exchange;
  if (scope === 'ALL') return true;
  if (scope === 'SH') return exchange === 'SSE' || exchange === 'SH';
  if (scope === 'SZ') return exchange === 'SZSE' || exchange === 'SZ';
  if (scope === 'GEM') return code.startsWith('300');
  if (scope === 'STAR') return code.startsWith('688');
  if (scope === 'BJ') return exchange === 'BSE' || exchange === 'BJ' || code.startsWith('8') || code.startsWith('4') || code.startsWith('9');
  return true;
}

function parseMoneyValue(value) {
  if (typeof value === 'number') return value;
  if (!value) return null;
  const text = String(value).trim();
  const numeric = Number(text.replace(/,/g, ''));
  if (Number.isFinite(numeric)) return numeric;
  if (text.endsWith('万亿')) return Number.parseFloat(text) * 1_000_000_000_000;
  if (text.endsWith('亿')) return Number.parseFloat(text) * 100_000_000;
  if (text.endsWith('万')) return Number.parseFloat(text) * 10_000;
  return null;
}

function evaluateStock(row, bars, flows, activeConditions) {
  const lastIndex = bars.length - 1;
  const prevIndex = bars.length - 2;
  const today = bars.at(-1) ?? null;
  const yesterday = bars.at(-2) ?? null;
  const ma5 = movingAverage(bars, lastIndex, 5);
  const ma10 = movingAverage(bars, lastIndex, 10);
  const ma20 = movingAverage(bars, lastIndex, 20);
  const ma60 = movingAverage(bars, lastIndex, 60);
  const ma250 = movingAverage(bars, lastIndex, 250);
  const todayAvgVolume20 = previousAverageVolume(bars, lastIndex);
  const yesterdayAvgVolume20 = previousAverageVolume(bars, prevIndex);
  const volumeCv20BeforeBreakout = previousVolumeCv(bars, prevIndex);
  const todayVolumeRatio = todayAvgVolume20 ? today.volume / todayAvgVolume20 : null;
  const yesterdayVolumeRatio = yesterdayAvgVolume20 ? yesterday.volume / yesterdayAvgVolume20 : null;
  const todayUpperShadowRatio = upperShadowRatio(today);
  const yesterdayUpperShadowRatio = upperShadowRatio(yesterday);
  const flowByDate = new Map(flows.map((flow) => [flow.date, flow]));
  const todayFlow = today ? flowByDate.get(today.date) ?? null : null;
  const yesterdayFlow = yesterday ? flowByDate.get(yesterday.date) ?? null : null;
  const todayMainNetInflow = todayFlow
    ? (todayFlow.largeIn ?? 0) - (todayFlow.largeOut ?? 0) + (todayFlow.superLargeIn ?? 0) - (todayFlow.superLargeOut ?? 0)
    : null;
  const yesterdayMainNetInflow = yesterdayFlow
    ? (yesterdayFlow.largeIn ?? 0) - (yesterdayFlow.largeOut ?? 0) + (yesterdayFlow.superLargeIn ?? 0) - (yesterdayFlow.superLargeOut ?? 0)
    : null;
  const todayAmount = today?.amount ?? null;
  const quoteVolumeRatio = toNumber(row.quoteVolumeRatio);
  const floatMarketCap = toNumber(row.floatMarketCap);
  const marketCap = toNumber(row.marketCap);

  const metrics = {
    tradeDate: today?.date ?? null,
    previousTradeDate: yesterday?.date ?? null,
    close: today?.close ?? null,
    pctChange: today?.pctChange ?? null,
    amount: todayAmount,
    turnover: today?.turnover ?? null,
    ma5,
    ma10,
    ma20,
    ma60,
    ma250,
    closeVsMa250Pct: hasValue(ma250) && hasValue(today?.close) ? ((today.close - ma250) / ma250) * 100 : null,
    closeVsMa20Pct: hasValue(ma20) && hasValue(today?.close) ? ((today.close - ma20) / ma20) * 100 : null,
    volumeCv20BeforeBreakout,
    todayVolumeRatio,
    todayVolumeMultiple20: todayVolumeRatio,
    yesterdayVolumeRatio,
    yesterdayVolumeMultiple20: yesterdayVolumeRatio,
    quoteVolumeRatio,
    todayUpperShadowRatio,
    yesterdayUpperShadowRatio,
    todayMainNetInflow,
    yesterdayMainNetInflow,
    todayMainMoneyRatio: hasValue(todayAmount) && hasValue(todayMainNetInflow) ? (todayMainNetInflow / todayAmount) * 100 : null,
    todayVolume: today?.volume ?? null,
    yesterdayVolume: yesterday?.volume ?? null,
    marketCap,
    floatMarketCap
  };

  const checks = {};
  for (const condition of activeConditions) {
    checks[condition.key] = runCondition(condition, { stock: row, metrics });
  }
  const failedKeys = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
  return {
    stock: row,
    metrics,
    checks,
    passed: failedKeys.length === 0,
    passCount: Object.keys(checks).length - failedKeys.length,
    failedKeys
  };
}

function describeIncompleteStock(stock, bars) {
  const historyBars = bars.length;
  const latestTradeDate = bars.at(-1)?.date ?? null;
  return {
    stock,
    historyBars,
    latestTradeDate,
    missingBars: Math.max(0, 252 - historyBars),
    reason: historyBars === 0
      ? '近260个交易日无日线数据，相关条件按未满足处理'
      : `历史K线仅 ${historyBars} 根，少于 252 根，相关条件按未满足处理`
  };
}

function getParam(condition, key) {
  const definition = conditionMap.get(condition.key);
  const fallback = definition?.params?.find((param) => param.key === key)?.value;
  const value = condition.params?.[key];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function runCondition(condition, rowOrBundle) {
  const metrics = rowOrBundle.metrics;
  const stock = rowOrBundle.stock;
  const name = stock.name ?? '';
  const todayVolumeMultiple20 = metrics.todayVolumeMultiple20 ?? metrics.todayVolumeRatio;
  const yesterdayVolumeMultiple20 = metrics.yesterdayVolumeMultiple20 ?? metrics.yesterdayVolumeRatio;
  switch (condition.key) {
    case 'movingAverageBullish':
      return [metrics.ma5, metrics.ma10, metrics.ma20, metrics.ma60].every(hasValue) &&
        metrics.ma5 > metrics.ma10 && metrics.ma10 > metrics.ma20 && metrics.ma20 > metrics.ma60;
    case 'aboveYearLine':
      return hasValue(metrics.close) && hasValue(metrics.ma250) && metrics.close > metrics.ma250;
    case 'quietPreviousVolume':
      return hasValue(metrics.volumeCv20BeforeBreakout) && metrics.volumeCv20BeforeBreakout < getParam(condition, 'cvMax');
    case 'twoDayHugeVolume':
      return (
        hasValue(todayVolumeMultiple20) &&
        hasValue(yesterdayVolumeMultiple20) &&
        todayVolumeMultiple20 >= getParam(condition, 'ratioMin') &&
        yesterdayVolumeMultiple20 >= getParam(condition, 'ratioMin')
      );
    case 'twoDayLongUpperShadow':
      return (
        hasValue(metrics.todayUpperShadowRatio) &&
        hasValue(metrics.yesterdayUpperShadowRatio) &&
        metrics.todayUpperShadowRatio > getParam(condition, 'ratioMin') &&
        metrics.yesterdayUpperShadowRatio > getParam(condition, 'ratioMin')
      );
    case 'twoDayMainMoneyInflow':
      return hasValue(metrics.todayMainNetInflow) && hasValue(metrics.yesterdayMainNetInflow) &&
        metrics.todayMainNetInflow > 0 && metrics.yesterdayMainNetInflow > 0;
    case 'todayPctChangeMin':
      return hasValue(metrics.pctChange) && metrics.pctChange >= getParam(condition, 'min');
    case 'marketScope': {
      const scope = condition.params?.scope ?? 'ALL';
      return marketScopeMatch(scope, stock);
    }
    case 'priceRange':
      return hasValue(metrics.close) && metrics.close >= getParam(condition, 'min') && metrics.close <= getParam(condition, 'max');
    case 'amountMin':
      return hasValue(metrics.amount) && metrics.amount >= getParam(condition, 'min');
    case 'turnoverRange':
      return hasValue(metrics.turnover) && metrics.turnover >= getParam(condition, 'min') && metrics.turnover <= getParam(condition, 'max');
    case 'mainMoneyRatioMin':
      return hasValue(metrics.todayMainMoneyRatio) && metrics.todayMainMoneyRatio >= getParam(condition, 'min');
    case 'twoDayMainMoneyAmountMin':
      return (
        hasValue(metrics.todayMainNetInflow) &&
        hasValue(metrics.yesterdayMainNetInflow) &&
        metrics.todayMainNetInflow >= getParam(condition, 'min') &&
        metrics.yesterdayMainNetInflow >= getParam(condition, 'min')
      );
    case 'notSt':
      return !/ST/i.test(name);
    case 'floatMarketCapMax':
      return hasValue(metrics.floatMarketCap) && metrics.floatMarketCap <= getParam(condition, 'max');
    case 'aboveMa20Pct':
      return hasValue(metrics.closeVsMa20Pct) && metrics.closeVsMa20Pct >= getParam(condition, 'min');
    default:
      return true;
  }
}

function normalizeConditions(rawConditions) {
  if (!Array.isArray(rawConditions)) {
    return conditionDefinitions
      .filter((condition) => condition.defaultEnabled)
      .map((condition) => ({ key: condition.key, params: Object.fromEntries((condition.params ?? []).map((param) => [param.key, param.value])) }));
  }

  return rawConditions
    .filter((condition) => condition?.enabled !== false && conditionMap.has(condition?.key))
    .map((condition) => ({ key: condition.key, params: condition.params ?? {} }));
}

function formatTradeDateChina(value) {
  const text = String(value ?? '');
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}年${text.slice(4, 6)}月${text.slice(6, 8)}日`;
  }
  const isoText = text.slice(0, 10);
  const isoMatch = isoText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}年${isoMatch[2]}月${isoMatch[3]}日`;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

async function buildFullMarketRows(stockBasics, tradingDates, activeConditions) {
  const recentDates = tradingDates.slice(-260);
  const byCode = new Map(stockBasics.map((stock) => [stock.ts_code, { stock, bars: [], flows: [] }]));
  let downloadedDailyDays = 0;
  let downloadedBasicDays = 0;
  let downloadedFlowDays = 0;
  const incompleteRows = [];
  const populatedDailyDates = [];
  const emptyDailyDates = [];

  for (const [index, tradeDate] of recentDates.entries()) {
    markRefreshProgress('读取日线交易日缓存', {
      tradeDate,
      current: index + 1,
      total: recentDates.length
    });
    const dailyWasCached = Boolean(await readJsonFile(cacheFile('daily', tradeDate)));
    const dailyRows = await getDailyByTradeDate(tradeDate);
    if (!dailyWasCached) downloadedDailyDays += 1;
    if (dailyRows.length > 0) {
      populatedDailyDates.push(tradeDate);
    } else {
      emptyDailyDates.push(tradeDate);
      continue;
    }

    for (const dailyRow of dailyRows) {
      const bucket = byCode.get(dailyRow.ts_code);
      if (!bucket) continue;
      bucket.bars.push(parseKlineRow(dailyRow));
    }
    if (!dailyWasCached) await delay(120);
  }

  const latestDataDate = populatedDailyDates.at(-1) ?? recentDates.at(-1);
  const latestDataIso = parseDateToIso(latestDataDate);
  markRefreshProgress('读取最新交易日基础指标', {
    latestDataDate
  });
  const basicWasCached = Boolean(await readJsonFile(cacheFile('dailyBasic', latestDataDate)));
  const basicRows = await getDailyBasicByTradeDate(latestDataDate);
  if (!basicWasCached) downloadedBasicDays += 1;
  const basicMap = new Map(basicRows.map((row) => [row.ts_code, row]));
  for (const [tsCode, bucket] of byCode.entries()) {
    const basic = basicMap.get(tsCode);
    if (!basic) continue;
    bucket.stock.marketCap = toNumber(basic.total_mv) ? toNumber(basic.total_mv) * 10000 : null;
    bucket.stock.floatMarketCap = toNumber(basic.circ_mv) ? toNumber(basic.circ_mv) * 10000 : null;
    const latestBar = bucket.bars.find((bar) => bar.date === latestDataIso);
    if (latestBar) latestBar.turnover = toNumber(basic.turnover_rate);
  }

  const latestDataIndex = tradingDates.indexOf(latestDataDate);
  const flowDates = latestDataIndex >= 1
    ? tradingDates.slice(Math.max(0, latestDataIndex - 1), latestDataIndex + 1)
    : tradingDates.slice(-2);
  for (const tradeDate of flowDates) {
    markRefreshProgress('读取主力资金交易日缓存', {
      tradeDate,
      flowDates
    });
    const flowWasCached = Boolean(await readJsonFile(cacheFile('moneyflow', tradeDate)));
    const flowRows = await getMoneyFlowByTradeDate(tradeDate);
    if (!flowWasCached) downloadedFlowDays += 1;
    for (const flowRow of flowRows) {
      const bucket = byCode.get(flowRow.ts_code);
      if (!bucket) continue;
      bucket.flows.push(parseMoneyFlowRow(flowRow));
    }
    if (!flowWasCached) await delay(120);
  }

  const rows = [];
  const errors = [];
  markRefreshProgress('计算全市场筛选指标', {
    stockCount: byCode.size,
    latestDataDate,
    previousTradeDate: flowDates.at(0)
  });
  for (const bucket of byCode.values()) {
    try {
      bucket.bars.sort((a, b) => a.date.localeCompare(b.date));
      bucket.flows.sort((a, b) => a.date.localeCompare(b.date));
      if (bucket.bars.length < 252) {
        incompleteRows.push(describeIncompleteStock(bucket.stock, bucket.bars));
      }
      const evaluated = evaluateStock(bucket.stock, bucket.bars, bucket.flows, activeConditions);
      if (evaluated) rows.push(evaluated);
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  incompleteRows.sort((a, b) => a.historyBars - b.historyBars || a.stock.ts_code.localeCompare(b.stock.ts_code));

  return {
    rows,
    errors,
    incompleteRows,
    localCache: {
      historyDays: recentDates.length,
      calendarLatestTradeDate: recentDates.at(-1),
      calendarLatestTradeDateChina: formatTradeDateChina(recentDates.at(-1)),
      latestTradeDate: latestDataDate,
      latestTradeDateChina: formatTradeDateChina(latestDataDate),
      previousTradeDate: flowDates.at(0) ?? null,
      previousTradeDateChina: formatTradeDateChina(flowDates.at(0)),
      emptyDailyDates,
      downloadedDailyDays,
      downloadedBasicDays,
      downloadedFlowDays,
      reusedDailyDays: recentDates.length - downloadedDailyDays,
      reusedFlowDays: flowDates.length - downloadedFlowDays
    }
  };
}

async function refreshDataset({ force = false, reason = 'manual' } = {}) {
  const fresh = datasetCache && Date.now() - new Date(datasetCache.updatedAt).getTime() < CACHE_TTL_MS;
  if (fresh && !force) return datasetCache;
  if (refreshJob.running) return refreshJob.promise;

  refreshJob = {
    running: true,
    startedAt: nowIso(),
    startedAtChina: formatChinaTime(),
    finishedAt: null,
    finishedAtChina: null,
    error: null,
    lastErrorAt: refreshJob.lastErrorAt ?? null,
    lastErrorAtChina: refreshJob.lastErrorAtChina ?? null,
    phase: '准备更新',
    progress: null,
    promise: null
  };

  refreshJob.promise = (async () => {
    try {
      await ensureCacheDirs();
      markRefreshProgress('读取交易日历');
      const tradingDates = await getTradingDates();
      const endDate = tradingDates.at(-1);
      if (!endDate) throw new Error('未获取到交易日');
      markRefreshProgress('读取 A 股股票列表');
      const stockBasics = await getStockBasics();
      const activeConditions = normalizeConditions();
      const total = stockBasics.length;
      const { rows: results, errors, incompleteRows, localCache } = await buildFullMarketRows(stockBasics, tradingDates, activeConditions);

      datasetCache = {
        updatedAt: nowIso(),
        updatedAtChina: formatChinaTime(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
        expiresAtChina: formatChinaTime(Date.now() + CACHE_TTL_MS),
        source: 'Tushare Pro HTTP',
        warning: errors.length ? `部分股票计算失败：${[...new Set(errors)].slice(0, 8).join('；')}` : '',
        refreshReason: reason,
        totalAshareCount: total,
        stockCount: total,
        candidateCount: total,
        universeComplete: true,
        evaluatedCount: results.length,
        incompleteCount: incompleteRows.length,
        incompleteRows,
        errors: [...new Set(errors)].slice(0, 8),
        rows: results,
        snapshotLoaded: Boolean(datasetCache?.snapshotLoaded),
        tushareTokenConfigured: Boolean(tsState.token),
        tushareHttpUrl: tsState.httpUrl,
        localCache,
        dataStatus: null
      };
      datasetCache.dataStatus = buildDataStatus();
      await writeSnapshot(datasetCache);
      refreshJob.finishedAt = datasetCache.updatedAt;
      refreshJob.finishedAtChina = datasetCache.updatedAtChina;
      refreshJob.error = null;
      markRefreshProgress('更新完成', {
        latestTradeDate: localCache.latestTradeDate,
        calendarLatestTradeDate: localCache.calendarLatestTradeDate
      });
      return datasetCache;
    } catch (error) {
      refreshJob.error = error.message || '更新失败';
      refreshJob.lastErrorAt = nowIso();
      refreshJob.lastErrorAtChina = formatChinaTime();
      if (!datasetCache) throw error;
      return datasetCache;
    } finally {
      refreshJob.running = false;
    }
  })();

  return refreshJob.promise;
}

async function loadSnapshotIntoCache() {
  try {
    await ensureCacheDirs();
    const snapshot = await readSnapshot();
    if (snapshot?.rows && Array.isArray(snapshot.rows)) {
      datasetCache = {
        ...snapshot,
        snapshotLoaded: true,
        dataStatus: snapshot.dataStatus ?? null
      };
      datasetCache.dataStatus = buildDataStatus();
    }
  } catch (error) {
    console.warn('读取本地快照失败:', error.message || error);
  }
}

function screenFromCache(activeConditions) {
  const rows = (datasetCache?.rows ?? []).map((row) => {
    const checks = Object.fromEntries(activeConditions.map((condition) => [condition.key, runCondition(condition, row)]));
    const failedKeys = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
    return {
      ...row,
      checks,
      passed: failedKeys.length === 0,
      passCount: Object.keys(checks).length - failedKeys.length,
      failedKeys
    };
  });
  const results = rows
    .filter((row) => row.passed)
    .sort((a, b) => (b.metrics.todayMainNetInflow ?? 0) - (a.metrics.todayMainNetInflow ?? 0));
  const nearMisses = rows
    .filter((row) => !row.passed)
    .sort((a, b) => b.passCount - a.passCount)
    .slice(0, 80);

  return {
    ...datasetCache,
    rows: undefined,
    incompleteRows: datasetCache?.incompleteRows ?? [],
    activeConditions,
    activeConditionCount: activeConditions.length,
    matchedCount: results.length,
    incompleteCount: datasetCache?.incompleteRows?.length ?? 0,
    results,
    nearMisses,
    snapshotLoaded: Boolean(datasetCache?.snapshotLoaded),
    dataStatus: buildDataStatus(),
    refreshJob
  };
}

app.get('/api/conditions', (req, res) => {
  res.json({ conditions: conditionDefinitions });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    now: nowIso(),
    nowChina: formatChinaTime(),
    tushareHttpUrl: tsState.httpUrl,
    tushareTokenConfigured: Boolean(tsState.token),
    cacheUpdatedAt: datasetCache?.updatedAt ?? null,
    cacheUpdatedAtChina: datasetCache?.updatedAtChina ?? null,
    snapshotLoaded: Boolean(datasetCache?.snapshotLoaded),
    dataStatus: buildDataStatus(),
    refreshJob
  });
});

app.get('/api/snapshot', (req, res) => {
  if (!datasetCache) {
    res.status(404).json({
      ok: false,
      message: '快照尚未加载',
      dataStatus: buildDataStatus()
    });
    return;
  }

  res.json({
    ...datasetCache,
    snapshotLoaded: Boolean(datasetCache.snapshotLoaded),
    dataStatus: buildDataStatus(),
    refreshJob
  });
});

app.get('/api/stock/:tsCode/detail', async (req, res) => {
  try {
    const tsCode = String(req.params.tsCode || '').toUpperCase();
    const stock = (datasetCache?.rows ?? []).find((row) => row.stock?.ts_code === tsCode)?.stock
      ?? (await getStockBasics()).find((row) => row.ts_code === tsCode);
    if (!stock) {
      res.status(404).json({ message: `未找到股票：${tsCode}` });
      return;
    }

    const tradingDates = await getTradingDates();
    const recentDates = tradingDates.slice(-260);
    const bars = await getDailyBars(tsCode, recentDates.at(0), recentDates.at(-1));
    if (!bars.length) {
      res.status(404).json({ message: `${tsCode} 没有可用日线数据` });
      return;
    }

    const latestDate = isoToTradeDate(bars.at(-1).date);
    const latestIndex = tradingDates.indexOf(latestDate);
    const flowDates = latestIndex >= 1
      ? tradingDates.slice(Math.max(0, latestIndex - 1), latestIndex + 1)
      : tradingDates.slice(-2);
    const rawFlows = (await getMoneyFlowRawForStock(tsCode, flowDates.at(0), flowDates.at(-1)))
      .filter((row) => flowDates.includes(String(row.trade_date)));
    const parsedFlows = rawFlows.map(parseMoneyFlowRow);
    const evaluated = evaluateStock(stock, bars, parsedFlows, normalizeConditions());

    res.json({
      stock,
      metrics: evaluated.metrics,
      checks: evaluated.checks,
      failedKeys: evaluated.failedKeys,
      details: buildCalculationDetails({
        stock,
        bars,
        rawFlows,
        metrics: evaluated.metrics
      })
    });
  } catch (error) {
    res.status(500).json({ message: error.message || '详情加载失败' });
  }
});

app.post('/api/refresh', (req, res) => {
  refreshDataset({ force: true, reason: 'manual' }).catch(() => {});
  res.status(202).json({
    accepted: true,
    refreshJob,
    cacheUpdatedAt: datasetCache?.updatedAt ?? null,
    cacheUpdatedAtChina: datasetCache?.updatedAtChina ?? null,
    dataStatus: buildDataStatus()
  });
});

app.get('/api/screen', async (req, res) => {
  const rawConditions = req.query.conditions ? JSON.parse(String(req.query.conditions)) : null;
  const activeConditions = normalizeConditions(rawConditions);
  const cacheIsStale = !datasetCache || Date.now() - new Date(datasetCache.updatedAt).getTime() >= CACHE_TTL_MS;

  if (cacheIsStale) {
    refreshDataset({ force: false, reason: datasetCache ? 'hourly' : 'initial' }).catch(() => {});
  }

  if (!datasetCache) {
    res.json({
      updatedAt: null,
      updatedAtChina: null,
      source: '正在加载 Tushare 数据',
      warning: refreshJob.error,
      totalAshareCount: 0,
      stockCount: 0,
      candidateCount: 0,
      universeComplete: true,
      evaluatedCount: 0,
      incompleteCount: 0,
      incompleteRows: [],
      matchedCount: 0,
      errors: refreshJob.error ? [refreshJob.error] : [],
      results: [],
      nearMisses: [],
      activeConditions,
      activeConditionCount: activeConditions.length,
      snapshotLoaded: false,
      dataStatus: buildDataStatus(),
      tushareHttpUrl: tsState.httpUrl,
      tushareTokenConfigured: Boolean(tsState.token),
      localCache: null,
      refreshJob
    });
    return;
  }

  res.json(screenFromCache(activeConditions));
});

await loadSnapshotIntoCache();

app.listen(port, () => {
  console.log(`A 股股票筛选平台已启动: http://localhost:${port}`);
});

setInterval(() => {
  refreshDataset({ force: false, reason: 'hourly' }).catch(() => {});
}, CACHE_TTL_MS);

setTimeout(() => {
  const cacheIsStale = !datasetCache || Date.now() - new Date(datasetCache.updatedAt).getTime() >= CACHE_TTL_MS;
  if (cacheIsStale) {
    refreshDataset({ force: false, reason: datasetCache ? 'startup' : 'initial' }).catch(() => {});
  }
}, 1000);
