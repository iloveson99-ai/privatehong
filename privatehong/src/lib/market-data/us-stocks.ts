// US stock market data via Finnhub REST API

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface USStockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
}

export interface USNewsItem {
  headline: string;
  summary: string;
  url: string;
  datetime: number;
}

export async function getUSStockQuote(ticker: string): Promise<USStockQuote> {
  const apiKey = process.env.FINNHUB_API_KEY;
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Finnhub quote failed for ${ticker}: ${res.status}`);
  const data = await res.json();
  return {
    ticker,
    price: data.c ?? 0,
    change: data.d ?? 0,
    changePercent: data.dp ?? 0,
    high: data.h ?? 0,
    low: data.l ?? 0,
    volume: data.v ?? 0,
  };
}

export async function getUSMarketNews(count = 10): Promise<USNewsItem[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  const url = `${FINNHUB_BASE}/news?category=general&token=${apiKey}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Finnhub news failed: ${res.status}`);
  const data: USNewsItem[] = await res.json();
  return Array.isArray(data) ? data.slice(0, count) : [];
}
