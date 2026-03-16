// Korean stock market data via Naver Finance mobile API (no auth required)

const TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).finally(() => clearTimeout(timer));
}

export interface KRStockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

export interface KOSPIIndex {
  value: number;
  change: number;
  changePercent: number;
}

export async function getKRStockQuote(ticker: string): Promise<KRStockQuote> {
  const url = `https://m.stock.naver.com/api/stock/${ticker}/basic`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Naver stock quote failed for ${ticker}: ${res.status}`);
  const data = await res.json();

  // Naver Finance mobile API fields (log raw on first use if fields differ)
  const price = Number(data.closePrice ?? data.currentPrice ?? data.stockEndPrice ?? 0);
  const change = Number(data.compareToPreviousClosePrice ?? data.priceChange ?? 0);
  const changePercent = Number(
    data.fluctuationsRatio ?? data.priceChangePercent ?? data.changeRate ?? 0
  );
  const volume = Number(data.accumulatedTradingVolume ?? data.tradingVolume ?? 0);

  return { ticker, price, change, changePercent, volume };
}

export async function getKOSPIIndex(): Promise<KOSPIIndex> {
  const url = `https://m.stock.naver.com/api/index/KOSPI/basic`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Naver KOSPI index failed: ${res.status}`);
  const data = await res.json();

  const value = Number(data.closePrice ?? data.indexValue ?? 0);
  const change = Number(data.compareToPreviousClosePrice ?? data.priceChange ?? 0);
  const changePercent = Number(data.fluctuationsRatio ?? data.changeRate ?? 0);

  return { value, change, changePercent };
}
