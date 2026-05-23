import http from "node:http";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = process.env.PORT || 4173;
const host = process.env.HOST || "0.0.0.0";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const ranges = {
  "7d": { range: "7d", interval: "30m" },
  "1m": { range: "1mo", interval: "1d" },
  "3m": { range: "3mo", interval: "1d" },
  "6m": { range: "6mo", interval: "1d" },
  "12m": { range: "1y", interval: "1d" },
  "ytd": { range: "ytd", interval: "1d" },
  "3y": { range: "3y", interval: "1wk" },
  "5y": { range: "5y", interval: "1wk" }
};

const yahooHosts = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"];
const curatedSymbols = [
  { symbol: "DTE.DE", name: "Deutsche Telekom AG", exchange: "GER", quoteType: "EQUITY", keywords: ["deutsche", "telekom", "deutsche telekom"] },
  { symbol: "DHL.DE", name: "DHL Group AG (Deutsche Post)", exchange: "GER", quoteType: "EQUITY", keywords: ["deutsche", "post", "deutsche post", "dhl"] },
  { symbol: "DBK.DE", name: "Deutsche Bank AG", exchange: "GER", quoteType: "EQUITY", keywords: ["deutsche", "bank", "deutsche bank"] }
];

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function yahoo(path) {
  let lastStatus = "unknown";
  for (const host of yahooHosts) {
    const response = await fetch(`${host}${path}`, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 StockValueRadar/1.0"
      }
    });

    if (response.ok) return response.json();
    lastStatus = response.status;
  }

  throw new Error(`Yahoo request failed: ${lastStatus}`);
}

async function safeYahoo(path, fallback = null) {
  try {
    return await yahoo(path);
  } catch {
    return fallback;
  }
}

function cleanSymbol(input) {
  return String(input || "")
    .trim()
    .replace(/^\$/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeSearch(input) {
  return String(input || "")
    .trim()
    .replace(/^\$/, "")
    .replace(/\s+/g, " ");
}

function displayName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+[A-Z]$/, "")
    .trim();
}

function unwrap(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  return value ?? null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function sma(series, length) {
  if (series.length < length) return null;
  return average(series.slice(-length));
}

function pctDistance(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) return null;
  return ((current - reference) / reference) * 100;
}

function valueSignal(metric, goodMax, badMin, invert = false) {
  if (!Number.isFinite(metric)) return { score: 50, confidence: 0 };
  const raw = clamp((metric - goodMax) / (badMin - goodMax), 0, 1) * 100;
  return { score: invert ? 100 - raw : raw, confidence: 1 };
}

function weightedScore(parts) {
  const usable = parts.filter((part) => part.confidence > 0);
  if (!usable.length) return 50;
  const weight = usable.reduce((sum, part) => sum + part.weight * part.confidence, 0);
  const score = usable.reduce((sum, part) => sum + part.score * part.weight * part.confidence, 0);
  return Math.round(score / weight);
}

function verdict(score, fundamentalCount = 0) {
  if (fundamentalCount < 3) {
    if (score >= 65) return "Technisch attraktiv";
    if (score >= 35) return "Neutral";
    return "Technisch riskant";
  }
  if (score >= 76) return "Invest";
  if (score >= 56) return "Eher attraktiv";
  if (score >= 38) return "Neutral";
  if (score >= 22) return "Teuer";
  return "Don't invest";
}

function volatility(values) {
  if (values.length < 3) return null;
  const returns = values.slice(1)
    .map((value, index) => Math.log(value / values[index]))
    .filter((value) => Number.isFinite(value));
  if (returns.length < 2) return null;
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function maxDrawdown(values) {
  let peak = -Infinity;
  let worst = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, ((value - peak) / peak) * 100);
  }
  return worst;
}

function rsi(values, length = 14) {
  if (values.length <= length) return null;
  const slice = values.slice(-(length + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index] - slice[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function toPoint(timestamp, quote) {
  const close = quote?.close ?? [];
  return timestamp
    .map((time, index) => ({
      date: new Date(time * 1000).toISOString(),
      close: close[index]
    }))
    .filter((point) => Number.isFinite(point.close));
}

function formatMaybe(value) {
  return Number.isFinite(value) && Math.abs(value) > 0.000001 ? value : null;
}

function compactNumber(value) {
  if (!Number.isFinite(value)) return null;
  return value;
}

async function resolveSymbol(query) {
  const search = normalizeSearch(query);
  const symbol = cleanSymbol(query);
  const data = await safeYahoo(`/v1/finance/search?q=${encodeURIComponent(search)}&quotesCount=12&newsCount=0`, { quotes: [] });
  const quotes = data.quotes || [];
  const exact = quotes.find((item) => cleanSymbol(item.symbol) === symbol);
  const named = quotes.find((item) => {
    const name = normalizeSearch(item.shortname || item.longname || "").toLowerCase();
    return ["EQUITY", "ETF"].includes(item.quoteType) && name.includes(search.toLowerCase());
  });
  const equity = quotes.find((item) => ["EQUITY", "ETF"].includes(item.quoteType));
  const aliases = {
    "THE TRADE DESK": { symbol: "TTD", shortname: "The Trade Desk, Inc.", exchange: "NGM" },
    "TRADE DESK": { symbol: "TTD", shortname: "The Trade Desk, Inc.", exchange: "NGM" },
    "SALESFORCE": { symbol: "CRM", shortname: "Salesforce, Inc.", exchange: "NYQ" },
    "DEUTSCHE POST": { symbol: "DHL.DE", shortname: "DHL Group AG (Deutsche Post)", exchange: "GER" },
    "DHL": { symbol: "DHL.DE", shortname: "DHL Group AG (Deutsche Post)", exchange: "GER" }
  };
  return exact || named || equity || aliases[search.toUpperCase()] || { symbol };
}

async function searchSymbols(query) {
  const search = normalizeSearch(query);
  if (search.length < 2) return [];

  const data = await safeYahoo(`/v1/finance/search?q=${encodeURIComponent(search)}&quotesCount=10&newsCount=0`, { quotes: [] });
  const seen = new Set();
  const curated = curatedSymbols.filter((item) => {
    const lower = search.toLowerCase();
    return item.keywords.some((keyword) => keyword.includes(lower) || lower.includes(keyword));
  });
  return [...curated, ...(data.quotes || [])]
    .filter((item) => ["EQUITY", "ETF"].includes(item.quoteType) && item.symbol)
    .filter((item) => {
      const key = cleanSymbol(item.symbol);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      name: displayName(item.name || item.shortname || item.longname || item.symbol),
      exchange: item.exchange || "",
      type: item.quoteType
    }));
}

async function getFxRate(currency) {
  if (!currency || currency === "EUR") return 1;
  try {
    const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(`${currency}EUR=X`)}?range=1d&interval=1d`);
    return data.chart?.result?.[0]?.meta?.regularMarketPrice || 1;
  } catch {
    try {
      const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=EUR`);
      if (!response.ok) return 1;
      const data = await response.json();
      return data.rates?.EUR || 1;
    } catch {
      return 1;
    }
  }
}

function eurSeries(points, fxRate) {
  return points.map((point) => ({
    ...point,
    close: point.close * fxRate
  }));
}

async function getQuoteSummary(symbol) {
  try {
    const modules = "summaryDetail,defaultKeyStatistics,financialData,price,assetProfile,incomeStatementHistory";
    const data = await yahoo(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`);
    return data.quoteSummary?.result?.[0] || {};
  } catch {
    return {};
  }
}

function stooqSymbol(symbol) {
  const clean = symbol.toLowerCase();
  if (clean.includes(".")) return clean;
  return `${clean}.us`;
}

function rangeStart(range, now = new Date()) {
  const date = new Date(now);
  if (range === "ytd") return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const days = { "7d": 10, "1m": 35, "3m": 100, "6m": 200, "12m": 370, "3y": 1110, "5y": 1850 }[range] || 370;
  date.setDate(date.getDate() - days);
  return date;
}

async function stooqChart(symbol, selectedRange) {
  const response = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&i=d`, {
    headers: { "user-agent": "Mozilla/5.0 StockValueRadar/1.0" }
  });
  if (!response.ok) throw new Error(`Stooq request failed: ${response.status}`);
  const text = await response.text();
  if (!text.includes(",")) throw new Error("Keine Stooq-Daten gefunden.");

  const start = rangeStart(selectedRange);
  const rows = text.trim().split(/\r?\n/).slice(1);
  const points = rows
    .map((row) => {
      const [date, , , , close] = row.split(",");
      return { date: new Date(`${date}T16:00:00.000Z`).toISOString(), close: Number(close) };
    })
    .filter((point) => Number.isFinite(point.close) && new Date(point.date) >= start);

  if (!points.length) throw new Error("Keine Stooq-Kurse im Zeitraum gefunden.");
  return {
    points,
    currency: symbol.includes(".DE") || symbol.includes(".F") ? "EUR" : "USD",
    current: points.at(-1).close
  };
}

async function getChart(symbol, selectedRange) {
  const rangeConfig = ranges[selectedRange] || ranges["12m"];
  try {
    const chartData = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${rangeConfig.range}&interval=${rangeConfig.interval}&includePrePost=false&events=div%2Csplits`);
    const result = chartData.chart?.result?.[0];
    if (!result) throw new Error("Kein Kursverlauf gefunden.");
    return {
      result,
      points: toPoint(result.timestamp || [], result.indicators?.quote?.[0]),
      currency: result.meta?.currency || "USD",
      current: result.meta?.regularMarketPrice
    };
  } catch {
    const fallback = await stooqChart(symbol, selectedRange);
    return {
      result: { meta: { currency: fallback.currency, regularMarketPrice: fallback.current } },
      points: fallback.points,
      currency: fallback.currency,
      current: fallback.current
    };
  }
}

async function getTechnicalChart(symbol) {
  try {
    const chartData = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&includePrePost=false&events=div%2Csplits`);
    const result = chartData.chart?.result?.[0];
    const points = toPoint(result?.timestamp || [], result?.indicators?.quote?.[0]);
    if (points.length >= 30) {
      return {
        points,
        currency: result.meta?.currency || "USD"
      };
    }
  } catch {
    // Fall back to the visible range below.
  }

  return null;
}

function movingAverageAtDate(history, dateIso, length) {
  const date = new Date(dateIso).getTime();
  const usable = history.filter((point) => new Date(point.date).getTime() <= date);
  if (usable.length < length) return null;
  return average(usable.slice(-length).map((point) => point.close));
}

function enrichChartWithSma(chartPoints, historyPoints) {
  return chartPoints.map((point) => ({
    ...point,
    sma200: formatMaybe(movingAverageAtDate(historyPoints, point.date, 200))
  }));
}

function logoUrl(symbol) {
  const clean = symbol.replace(/\..*$/, "");
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(clean)}.png`;
}

function buildRationale({ score, metrics, fundamentalCount }) {
  const reasons = [];

  if (Number.isFinite(metrics.pe)) {
    if (metrics.pe < 18) reasons.push(`Das KGV von ${metrics.pe.toFixed(1)} wirkt im historischen Vergleich eher moderat.`);
    else if (metrics.pe > 35) reasons.push(`Das KGV von ${metrics.pe.toFixed(1)} zeigt eine anspruchsvolle Bewertung.`);
  }

  if (Number.isFinite(metrics.yearlyReturn)) {
    if (metrics.yearlyReturn > 12) reasons.push(`Im gewählten Zeitraum liegt die Aktie ${metrics.yearlyReturn.toFixed(1)}% im Plus; kurzfristig kann schon viel Optimismus eingepreist sein.`);
    else if (metrics.yearlyReturn < -12) reasons.push(`Im gewählten Zeitraum ist die Aktie ${Math.abs(metrics.yearlyReturn).toFixed(1)}% gefallen; das kann eine Chance sein, bleibt aber technisch angeschlagen.`);
  }

  if (Number.isFinite(metrics.dist200)) {
    if (metrics.dist200 < -10) reasons.push(`Der Kurs liegt ${Math.abs(metrics.dist200).toFixed(1)}% unter dem SMA 200, also deutlich unter dem langfristigen Trend.`);
    else if (metrics.dist200 > 15) reasons.push(`Der Kurs liegt ${metrics.dist200.toFixed(1)}% über dem SMA 200; ein Teil der Erwartung ist bereits eingepreist.`);
    else reasons.push(`Der Kurs liegt nahe am SMA 200, was technisch eher ausgewogen wirkt.`);
  }

  if (Number.isFinite(metrics.maxDrawdown) && metrics.maxDrawdown < -12) {
    reasons.push(`Der maximale Rückgang im gewählten Zeitraum liegt bei ${Math.abs(metrics.maxDrawdown).toFixed(1)}%, die Schwankung ist also spürbar.`);
  }

  if (Number.isFinite(metrics.rsi14)) {
    if (metrics.rsi14 < 35) reasons.push(`Der RSI 14 liegt bei ${metrics.rsi14.toFixed(1)} und signalisiert kurzfristig eine überverkaufte Lage.`);
    else if (metrics.rsi14 > 70) reasons.push(`Der RSI 14 liegt bei ${metrics.rsi14.toFixed(1)} und signalisiert kurzfristig eine überkaufte Lage.`);
  }

  if (Number.isFinite(metrics.annualVolatility) && metrics.annualVolatility > 55) {
    reasons.push(`Die Volatilität im gewählten Zeitraum ist mit ${metrics.annualVolatility.toFixed(1)}% hoch; die Aktie bleibt riskant.`);
  }

  if (fundamentalCount < 3) {
    reasons.push("Fundamentaldaten sind über die öffentlichen Quellen nur begrenzt verfügbar, deshalb zählt die technische Lage stärker.");
  }

  if (!reasons.length) {
    reasons.push(score >= 50
      ? "Die verfügbaren Bewertungs- und Trenddaten sprechen insgesamt eher für ein attraktives Chance-Risiko-Profil."
      : "Die verfügbaren Bewertungs- und Trenddaten sprechen insgesamt für Zurückhaltung.");
  }

  return reasons.slice(0, 4);
}

function unwrapFinancialStatement(statement) {
  if (!statement?.endDate) return null;
  return {
    year: new Date(unwrap(statement.endDate) * 1000).getUTCFullYear(),
    revenue: unwrap(statement.totalRevenue),
    netIncome: unwrap(statement.netIncome)
  };
}

function yoy(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function annualFinancials(summary, sharesOutstanding, fxRate) {
  const statements = (summary.incomeStatementHistory?.incomeStatementHistory || [])
    .map(unwrapFinancialStatement)
    .filter(Boolean)
    .sort((a, b) => b.year - a.year);
  const current = statements.find((item) => item.year === 2025) || statements[0];
  const previous = statements.find((item) => item.year === 2024) || statements.find((item) => item.year === current?.year - 1);
  if (!current) return null;

  const eps = Number.isFinite(current.netIncome) && Number.isFinite(sharesOutstanding) && sharesOutstanding > 0
    ? current.netIncome / sharesOutstanding
    : null;
  const previousEps = Number.isFinite(previous?.netIncome) && Number.isFinite(sharesOutstanding) && sharesOutstanding > 0
    ? previous.netIncome / sharesOutstanding
    : null;

  return {
    year: current.year,
    revenue: formatMaybe(current.revenue ? current.revenue * fxRate : null),
    revenueYoy: formatMaybe(yoy(current.revenue, previous?.revenue)),
    profit: formatMaybe(current.netIncome ? current.netIncome * fxRate : null),
    profitYoy: formatMaybe(yoy(current.netIncome, previous?.netIncome)),
    eps: formatMaybe(eps ? eps * fxRate : null),
    epsYoy: formatMaybe(yoy(eps, previousEps))
  };
}

async function getAnnualFinancials(symbol, fxRate) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = Math.floor(new Date("2020-01-01T00:00:00.000Z").getTime() / 1000);
  const types = "annualTotalRevenue,annualNetIncome,annualDilutedEPS";
  const data = await safeYahoo(`/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${period1}&period2=${now}`, null);
  const results = data?.timeseries?.result || [];
  const byYear = new Map();

  for (const item of results) {
    for (const key of ["annualTotalRevenue", "annualNetIncome", "annualDilutedEPS"]) {
      for (const entry of item[key] || []) {
        const year = new Date(entry.asOfDate).getUTCFullYear();
        const record = byYear.get(year) || { year };
        const value = unwrap(entry.reportedValue);
        if (key === "annualTotalRevenue") record.revenue = value;
        if (key === "annualNetIncome") record.profit = value;
        if (key === "annualDilutedEPS") record.eps = value;
        byYear.set(year, record);
      }
    }
  }

  const rows = [...byYear.values()].sort((a, b) => b.year - a.year);
  const current = rows.find((item) => item.year === 2025) || rows[0];
  const previous = rows.find((item) => item.year === 2024) || rows.find((item) => item.year === current?.year - 1);
  if (!current) return null;

  return {
    year: current.year,
    revenue: formatMaybe(current.revenue ? current.revenue * fxRate : null),
    revenueYoy: formatMaybe(yoy(current.revenue, previous?.revenue)),
    profit: formatMaybe(current.profit ? current.profit * fxRate : null),
    profitYoy: formatMaybe(yoy(current.profit, previous?.profit)),
    eps: formatMaybe(current.eps ? current.eps * fxRate : null),
    epsYoy: formatMaybe(yoy(current.eps, previous?.eps))
  };
}

async function stockPayload(query, selectedRange = "12m") {
  const resolved = await resolveSymbol(query);
  const symbol = cleanSymbol(resolved.symbol || query);
  if (!/^[A-Z0-9.-]{1,15}$/.test(symbol)) {
    throw new Error("Kein passender Ticker gefunden.");
  }

  const [chartResult, technicalResult, quoteData, summary] = await Promise.all([
    getChart(symbol, selectedRange),
    getTechnicalChart(symbol),
    safeYahoo(`/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`, { quoteResponse: { result: [] } }),
    getQuoteSummary(symbol)
  ]);

  const quote = quoteData.quoteResponse?.result?.[0] || {};
  const currency = chartResult.currency || quote.currency || unwrap(summary.price?.currency) || "USD";
  const fxRate = await getFxRate(currency);
  const points = eurSeries(chartResult.points, fxRate);
  const technicalCurrency = technicalResult?.currency || currency;
  const technicalFxRate = await getFxRate(technicalCurrency);
  const technicalPoints = eurSeries(technicalResult?.points || chartResult.points, technicalFxRate);
  const closes = points.map((point) => point.close);
  const technicalCloses = technicalPoints.map((point) => point.close);
  const current = closes.at(-1) ?? (chartResult.current * fxRate);
  const previousClose = chartResult.result?.meta?.chartPreviousClose
    ? chartResult.result.meta.chartPreviousClose * fxRate
    : null;
  const dayChangePercent = quote.regularMarketChangePercent ?? pctDistance(current, previousClose);

  const eps = unwrap(summary.defaultKeyStatistics?.trailingEps) ?? quote.epsTrailingTwelveMonths;
  const pe = unwrap(summary.summaryDetail?.trailingPE) ?? quote.trailingPE;
  const forwardPe = unwrap(summary.summaryDetail?.forwardPE) ?? quote.forwardPE;
  const peg = unwrap(summary.defaultKeyStatistics?.pegRatio) ?? quote.pegRatio;
  const priceToBook = unwrap(summary.defaultKeyStatistics?.priceToBook) ?? quote.priceToBook;
  const profitMargin = unwrap(summary.financialData?.profitMargins);
  const revenueGrowth = unwrap(summary.financialData?.revenueGrowth);
  const debtToEquity = unwrap(summary.financialData?.debtToEquity);
  const shortFloat = unwrap(summary.defaultKeyStatistics?.shortPercentOfFloat) ?? quote.shortPercentOfFloat;
  const beta = unwrap(summary.summaryDetail?.beta) ?? quote.beta;
  const dividendYield = unwrap(summary.summaryDetail?.dividendYield) ?? quote.trailingAnnualDividendYield;
  const targetMean = (unwrap(summary.financialData?.targetMeanPrice) ?? quote.targetMeanPrice) * fxRate;
  const periodLength = (length) => Math.min(length, closes.length);
  const sma20 = sma(closes, periodLength(20));
  const sma50 = sma(closes, periodLength(50));
  const sma200 = sma(closes, periodLength(200));
  const dist20 = pctDistance(current, sma20);
  const dist50 = pctDistance(current, sma50);
  const dist200 = pctDistance(current, sma200);
  const rangeStartPrice = closes[0];
  const rangeReturn = pctDistance(current, rangeStartPrice);
  const analystUpside = pctDistance(targetMean, current);
  const allTimeHigh = Math.max(...technicalCloses);
  const rangeHigh = Math.max(...closes);
  const low = Math.min(...closes);
  const distHigh = pctDistance(current, allTimeHigh);
  const distRangeHigh = pctDistance(current, rangeHigh);
  const distLow = pctDistance(current, low);
  const annualVolatility = volatility(closes);
  const drawdown = maxDrawdown(closes);
  const rsi14 = rsi(closes);

  const fundamentalValues = [
    pe,
    forwardPe,
    peg,
    priceToBook,
    profitMargin,
    revenueGrowth,
    debtToEquity,
    shortFloat,
    beta,
    dividendYield
  ];
  const fundamentalCount = fundamentalValues.filter(Number.isFinite).length;

  const metrics = {
    pe: formatMaybe(pe),
    forwardPe: formatMaybe(forwardPe),
    peg: formatMaybe(peg),
    eps: formatMaybe(eps ? eps * fxRate : null),
    priceToBook: formatMaybe(priceToBook),
    profitMargin: formatMaybe(profitMargin ? profitMargin * 100 : null),
    revenueGrowth: formatMaybe(revenueGrowth ? revenueGrowth * 100 : null),
    debtToEquity: formatMaybe(debtToEquity),
    shortFloat: formatMaybe(shortFloat ? shortFloat * 100 : null),
    beta: formatMaybe(beta),
    dividendYield: formatMaybe(dividendYield ? dividendYield * 100 : null),
    analystTarget: formatMaybe(targetMean),
    analystUpside: formatMaybe(analystUpside),
    sma20: formatMaybe(sma20),
    sma50: formatMaybe(sma50),
    sma200: formatMaybe(sma200),
    dist20: formatMaybe(dist20),
    dist50: formatMaybe(dist50),
    dist200: formatMaybe(dist200),
    yearlyReturn: formatMaybe(rangeReturn),
    rangeHigh: formatMaybe(allTimeHigh),
    distHigh: formatMaybe(distHigh),
    rangeLow: formatMaybe(low),
    distLow: formatMaybe(distLow),
    annualVolatility: formatMaybe(annualVolatility),
    maxDrawdown: formatMaybe(drawdown),
    rsi14: formatMaybe(rsi14)
  };

  const riskScore = weightedScore([
    { ...valueSignal(pe, 14, 40), weight: 1.35 },
    { ...valueSignal(forwardPe, 12, 35), weight: 1.2 },
    { ...valueSignal(peg, 0.8, 2.5), weight: 1.1 },
    { ...valueSignal(priceToBook, 1.5, 8), weight: 0.7 },
    { ...valueSignal(dist200, -10, 25), weight: 0.55 },
    { ...valueSignal(dist50, -6, 14), weight: 0.35 },
    { ...valueSignal(distRangeHigh, -28, -3), weight: 0.75 },
    { ...valueSignal(rangeReturn, -18, 24), weight: 0.65 },
    { ...valueSignal(rsi14, 34, 72), weight: 0.8 },
    { ...valueSignal(annualVolatility, 24, 78), weight: 0.5 },
    { ...valueSignal(drawdown, -4, -32), weight: 0.5 },
    { ...valueSignal(shortFloat ? shortFloat * 100 : null, 2, 18), weight: 0.55 },
    { ...valueSignal(debtToEquity, 40, 220), weight: 0.55 },
    { ...valueSignal(profitMargin ? profitMargin * 100 : null, 8, 28, true), weight: 0.7 },
    { ...valueSignal(revenueGrowth ? revenueGrowth * 100 : null, 2, 22, true), weight: 0.6 },
    { ...valueSignal(analystUpside, 30, -20, true), weight: 0.75 }
  ]);
  const score = 100 - riskScore;

  const name = quote.longName || quote.shortName || resolved.longname || resolved.shortname || symbol;
  const exchange = quote.fullExchangeName || quote.exchange || resolved.exchange || "";
  const sharesOutstanding = unwrap(summary.defaultKeyStatistics?.sharesOutstanding) ?? quote.sharesOutstanding;
  const marketCap = unwrap(summary.price?.marketCap) ?? quote.marketCap;
  const financials = await getAnnualFinancials(symbol, fxRate) || annualFinancials(summary, sharesOutstanding, fxRate);

  return {
    symbol,
    name: displayName(name),
    exchange,
    sourceCurrency: currency,
    fxRate,
    profile: {
      logo: logoUrl(symbol),
      exchange,
      marketCap: compactNumber(Number.isFinite(marketCap) ? marketCap * fxRate : null),
      employees: compactNumber(unwrap(summary.assetProfile?.fullTimeEmployees)),
      sector: summary.assetProfile?.sector || null,
      industry: summary.assetProfile?.industry || null,
      financials
    },
    dataQuality: {
      fundamentalCount,
      note: fundamentalCount < 3
        ? "Fundamentalwerte sind über die öffentlichen Quellen aktuell nur begrenzt verfügbar; die Einschätzung basiert stärker auf Kurs, Momentum und Risiko."
        : "Fundamentalwerte und technische Kennzahlen sind in die Einschätzung eingeflossen."
    },
    range: selectedRange,
    price: formatMaybe(current),
    changePercent: formatMaybe(dayChangePercent),
    chart: enrichChartWithSma(points, technicalPoints),
    score,
    verdict: verdict(score, fundamentalCount),
    rationale: buildRationale({ score, metrics, fundamentalCount }),
    metrics
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");

  for (const baseDir of [publicDir, root]) {
    const filePath = join(baseDir, normalized);
    if (!filePath.startsWith(baseDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      // Try the next allowed static directory.
    }
  }

  res.writeHead(404);
  res.end("Not found");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/stock") {
    const query = url.searchParams.get("q");
    const range = url.searchParams.get("range") || "12m";
    if (!query) return sendJson(res, 400, { error: "Bitte Aktie oder Ticker eingeben." });

    try {
      return sendJson(res, 200, await stockPayload(query, range));
    } catch (error) {
      return sendJson(res, 502, {
        error: "Die Finanzdaten konnten gerade nicht geladen werden.",
        detail: error.message
      });
    }
  }

  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q");
    try {
      return sendJson(res, 200, { results: await searchSymbols(query) });
    } catch (error) {
      return sendJson(res, 200, { results: [] });
    }
  }

  return serveStatic(req, res);
});

function localUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}

server.listen(port, host, () => {
  console.log(`Stock Value Radar läuft auf http://localhost:${port}`);
  for (const url of localUrls()) {
    console.log(`Im selben WLAN erreichbar unter ${url}`);
  }
});
