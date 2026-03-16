// Korean news via Naver Open API

const TIMEOUT_MS = 10_000;

export interface NaverNewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#[0-9]+;/g, '').trim();
}

export async function searchNaverNews(query: string, count = 5): Promise<NaverNewsItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${count}&sort=date`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'X-Naver-Client-Id': clientId ?? '',
      'X-Naver-Client-Secret': clientSecret ?? '',
    },
  }).finally(() => clearTimeout(timer));

  if (!res.ok) throw new Error(`Naver news search failed for "${query}": ${res.status}`);

  const data = await res.json();
  const items: NaverNewsItem[] = (data.items ?? []).map((item: Record<string, string>) => ({
    title: stripHtml(item.title ?? ''),
    description: stripHtml(item.description ?? ''),
    link: item.link ?? item.originallink ?? '',
    pubDate: item.pubDate ?? '',
  }));

  return items;
}
