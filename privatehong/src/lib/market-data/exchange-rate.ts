// USD/KRW exchange rate fetcher with fallback

const FALLBACK_RATE = 1350;
let cachedRate: number | null = null;

export async function getExchangeRate(): Promise<number> {
  if (cachedRate !== null) return cachedRate;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) throw new Error(`Exchange rate API failed: ${res.status}`);

    const data = await res.json();
    const rate = data?.rates?.KRW;

    if (typeof rate !== 'number' || rate <= 0) {
      throw new Error('Invalid KRW rate in response');
    }

    cachedRate = rate;
    return rate;
  } catch (err) {
    console.warn('[exchange-rate] Primary fetch failed, using fallback rate:', err);
    return FALLBACK_RATE;
  }
}
