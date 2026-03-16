// Market data aggregator — collects all data in parallel with graceful degradation

import { getUSStockQuote, getUSMarketNews, USStockQuote, USNewsItem } from './us-stocks';
import { getKRStockQuote, getKOSPIIndex, KRStockQuote, KOSPIIndex } from './kr-stocks';
import { searchNaverNews, NaverNewsItem } from './news';
import { getExchangeRate } from './exchange-rate';

export interface PortfolioHolding {
  id: string;
  ticker: string;
  name: string;
  market: 'US' | 'KR';
  quantity: number;
  avg_cost: number;
  avg_cost_usd: number | null;
}

export interface MarketData {
  timestamp: string;
  exchangeRate: number | null;
  kospi: KOSPIIndex | null;
  usQuotes: Record<string, USStockQuote>;
  krQuotes: Record<string, KRStockQuote>;
  usNews: USNewsItem[];
  krNews: NaverNewsItem[];
  fetchErrors: string[];
}

export type { USStockQuote, USNewsItem, KRStockQuote, KOSPIIndex, NaverNewsItem };

const KR_NEWS_KEYWORDS = ['코스피', '코스닥', '미국증시', '연준', '환율'];

export async function collectMarketData(holdings: PortfolioHolding[]): Promise<MarketData> {
  const errors: string[] = [];
  const usHoldings = holdings.filter((h) => h.market === 'US');
  const krHoldings = holdings.filter((h) => h.market === 'KR');

  // Build news keyword list: standard keywords + held stock names
  const newsKeywords = [...KR_NEWS_KEYWORDS, ...krHoldings.map((h) => h.name), ...usHoldings.map((h) => h.name)];
  const uniqueKeywords = [...new Set(newsKeywords)];

  // Fire all fetches in parallel — split by return type to preserve TypeScript narrowing
  const [
    [exchangeRateResult, kospiResult, usNewsResult],
    usQuoteResults,
    krQuoteResults,
    krNewsResults,
  ] = await Promise.all([
    Promise.allSettled([
      getExchangeRate(),
      getKOSPIIndex(),
      getUSMarketNews(10),
    ]),
    Promise.allSettled(usHoldings.map((h) => getUSStockQuote(h.ticker))),
    Promise.allSettled(krHoldings.map((h) => getKRStockQuote(h.ticker))),
    Promise.allSettled(uniqueKeywords.map((kw) => searchNaverNews(kw, 5))),
  ]);

  // Exchange rate
  let exchangeRate: number | null = null;
  if (exchangeRateResult.status === 'fulfilled') {
    exchangeRate = exchangeRateResult.value;
  } else {
    errors.push(`Exchange rate: ${exchangeRateResult.reason}`);
  }

  // KOSPI
  let kospi: KOSPIIndex | null = null;
  if (kospiResult.status === 'fulfilled') {
    kospi = kospiResult.value;
  } else {
    errors.push(`KOSPI: ${kospiResult.reason}`);
  }

  // US news
  let usNews: USNewsItem[] = [];
  if (usNewsResult.status === 'fulfilled') {
    usNews = usNewsResult.value;
  } else {
    errors.push(`US news: ${usNewsResult.reason}`);
  }

  // US stock quotes
  const usQuotes: Record<string, USStockQuote> = {};
  usQuoteResults.forEach((result, i) => {
    const ticker = usHoldings[i].ticker;
    if (result.status === 'fulfilled') {
      usQuotes[ticker] = result.value;
    } else {
      errors.push(`US quote ${ticker}: ${result.reason}`);
    }
  });

  // KR stock quotes
  const krQuotes: Record<string, KRStockQuote> = {};
  krQuoteResults.forEach((result, i) => {
    const ticker = krHoldings[i].ticker;
    if (result.status === 'fulfilled') {
      krQuotes[ticker] = result.value;
    } else {
      errors.push(`KR quote ${ticker}: ${result.reason}`);
    }
  });

  // Korean news (flatten and deduplicate by link)
  const seenLinks = new Set<string>();
  const krNews: NaverNewsItem[] = [];
  krNewsResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        if (!seenLinks.has(item.link)) {
          seenLinks.add(item.link);
          krNews.push(item);
        }
      }
    } else {
      errors.push(`KR news: ${result.reason}`);
    }
  });

  if (errors.length > 0) {
    console.warn('[market-data] Some fetches failed:', errors);
  }

  return {
    timestamp: new Date().toISOString(),
    exchangeRate,
    kospi,
    usQuotes,
    krQuotes,
    usNews,
    krNews,
    fetchErrors: errors,
  };
}
