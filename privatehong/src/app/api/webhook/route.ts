import { NextRequest, NextResponse } from 'next/server';
import { Bot, webhookCallback } from 'grammy';
import type { ParseMode } from '@grammyjs/types';
import { createClient } from '@supabase/supabase-js';
import { collectMarketData } from '@/lib/market-data';
import { formatMorningBriefing, formatPortfolio, formatTaxSummary, Quote } from '@/lib/formatters/briefing-formatter';
import { getTaxSummary } from '@/lib/tax/tracker';
import { findHarvestingOpportunities, HoldingWithQuote, CurrentQuote } from '@/lib/tax/loss-harvesting';
import { callWithFallback } from '@/lib/ai-providers';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─── Lazy bot initialisation ───────────────────────────────────
let _handleUpdate: ((req: NextRequest) => Promise<Response>) | null = null;

function getBotHandler(): (req: NextRequest) => Promise<Response> {
  if (_handleUpdate) return _handleUpdate;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  const bot = new Bot(token);

  // ─── /today ────────────────────────────────────────────────────
  bot.command('today', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    const supabase = getSupabase();
    const today = new Date();
    const kstToday = new Date(today.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = kstToday.toISOString().split('T')[0];

    const { data: briefing } = await supabase
      .from('daily_briefings')
      .select('*')
      .lte('date', dateStr)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (!briefing) {
      await ctx.reply('아직 오늘 브리핑이 생성되지 않았어요. 잠시 후 다시 시도해주세요.');
      return;
    }

    const formatted = formatMorningBriefing(
      briefing.leader_recommendation,
      briefing.conservative_analysis,
      briefing.aggressive_analysis
    );

    // Split and send if needed
    if (formatted.length <= 4096) {
      await ctx.reply(formatted, { parse_mode: 'HTML' });
    } else {
      const half = Math.floor(formatted.length / 2);
      const splitAt = formatted.lastIndexOf('\n', half);
      await ctx.reply(formatted.substring(0, splitAt), { parse_mode: 'HTML' });
      await ctx.reply(formatted.substring(splitAt + 1), { parse_mode: 'HTML' });
    }
  });

  // ─── /portfolio ────────────────────────────────────────────────
  bot.command('portfolio', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    const supabase = getSupabase();
    const { data: holdings } = await supabase.from('portfolio_holdings').select('*');

    if (!holdings || holdings.length === 0) {
      await ctx.reply('보유 종목이 없어요. 먼저 seed-portfolio.ts 를 실행해 주세요.');
      return;
    }

    const marketData = await collectMarketData(holdings as Parameters<typeof collectMarketData>[0]);

    const quotesMap = new Map<string, Quote>();
    for (const [ticker, q] of Object.entries(marketData.usQuotes)) {
      quotesMap.set(ticker, { price: q.price, changePercent: q.changePercent });
    }
    for (const [ticker, q] of Object.entries(marketData.krQuotes)) {
      quotesMap.set(ticker, { price: q.price, changePercent: q.changePercent });
    }

    const exchangeRate = marketData.exchangeRate ?? 1350;
    const formatted = formatPortfolio(holdings as Parameters<typeof formatPortfolio>[0], quotesMap, exchangeRate);
    await ctx.reply(formatted, { parse_mode: 'HTML' });
  });

  // ─── /tax ──────────────────────────────────────────────────────
  bot.command('tax', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    const supabase = getSupabase();
    const year = new Date().getFullYear();

    const taxSummary = await getTaxSummary(supabase, year);

    const { data: holdings } = await supabase.from('portfolio_holdings').select('*');
    const marketData = await collectMarketData(
      (holdings ?? []) as Parameters<typeof collectMarketData>[0]
    );

    const exchangeRate = marketData.exchangeRate ?? 1350;

    const holdingsForHarvest: HoldingWithQuote[] = ((holdings ?? []) as Array<{
      ticker: string; name: string; market: string; quantity: number;
      avg_cost: number; avg_cost_usd: number | null;
    }>).map(h => ({
      ticker: h.ticker,
      name: h.name,
      market: h.market as 'US' | 'KR',
      quantity: h.quantity,
      avg_cost: h.avg_cost,
      avg_cost_usd: h.avg_cost_usd,
    }));

    const currentQuotes: Record<string, CurrentQuote> = {};
    for (const [ticker, q] of Object.entries(marketData.usQuotes)) {
      currentQuotes[ticker] = { ticker, price: q.price * exchangeRate };
    }

    const harvestingOpps = findHarvestingOpportunities(holdingsForHarvest, currentQuotes, {
      ytdGain: taxSummary.ytdGain,
      ytdLoss: taxSummary.ytdLoss,
      netGain: taxSummary.netGain,
      estimatedTax: taxSummary.estimatedTax,
    });

    const formatted = formatTaxSummary(taxSummary, harvestingOpps, year);
    await ctx.reply(formatted, { parse_mode: 'HTML' });
  });

  // ─── /help ─────────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 <b>사용법 안내</b>

📌 <b>명령어</b>
/today - 오늘 브리핑 다시 보기
/portfolio - 현재 포트폴리오
/tax - 올해 세금 현황
/help - 이 도움말

📝 <b>거래 기록 방법</b>
매수: <code>애플 10주 샀어 178달러에</code>
매도: <code>삼성전자 5주 팔았어 85000원에</code>
배당: <code>AAPL 배당 50달러 들어왔어</code>

자유롭게 말씀하시면 알아서 이해할게요 😊`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── Natural language message handler ─────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id.toString();
    const supabase = getSupabase();

    // Save incoming message
    await supabase.from('chat_messages').insert({
      direction: 'incoming',
      message_text: text,
    });

    // Step 1: Check pending confirmation
    const { data: stateRow } = await supabase
      .from('conversation_state')
      .select('state')
      .eq('chat_id', chatId)
      .single();

    const pendingTrade = stateRow?.state?.pendingTrade ?? null;

    if (pendingTrade) {
      const trimmed = text.trim();
      const isYes = /^(네|맞아|ㅇㅇ|응|예|맞음)$/i.test(trimmed);
      const isNo = /^(아니|아니요|ㄴㄴ|노|취소)$/i.test(trimmed);

      if (isYes) {
        // Execute the pending trade
        await executeTrade(supabase, pendingTrade, ctx);
        await supabase.from('conversation_state').delete().eq('chat_id', chatId);
        return;
      } else if (isNo) {
        await supabase.from('conversation_state').delete().eq('chat_id', chatId);
        await ctx.reply('취소했어요. 다시 말씀해 주세요.');
        return;
      } else {
        // Clear old state and treat as new input
        await supabase.from('conversation_state').delete().eq('chat_id', chatId);
      }
    }

    // Step 2: Regex patterns
    const buyKR = /^(.+?)\s*(\d+)주\s*(샀어|매수|샀음|삼)\s*(\d[\d,]*)(원|달러|불)?/;
    const sellKR = /^(.+?)\s*(\d+)주\s*(팔았어|매도|팔았음|팜)\s*(\d[\d,]*)(원|달러|불)?/;
    const dividendKR = /^(.+?)\s*배당\s*(\d[\d,]*)(원|달러|불)/;
    const buyEN = /bought\s+([A-Z]+)\s+(\d+)\s+shares?\s+at\s+\$?([\d.]+)/i;
    const sellEN = /sold\s+([A-Z]+)\s+(\d+)\s+shares?\s+at\s+\$?([\d.]+)/i;

    interface ParsedTrade {
      type: 'BUY' | 'SELL' | 'DIVIDEND';
      ticker?: string;
      name: string;
      quantity: number | null;
      price: number;
      currency: 'KRW' | 'USD';
    }

    let parsed: ParsedTrade | null = null;

    const buyMatch = text.match(buyKR);
    const sellMatch = text.match(sellKR);
    const divMatch = text.match(dividendKR);
    const buyENMatch = text.match(buyEN);
    const sellENMatch = text.match(sellEN);

    if (buyMatch) {
      parsed = {
        type: 'BUY',
        name: buyMatch[1].trim(),
        ticker: undefined,
        quantity: parseInt(buyMatch[2]),
        price: parseFloat(buyMatch[4].replace(/,/g, '')),
        currency: (buyMatch[5] === '달러' || buyMatch[5] === '불') ? 'USD' : 'KRW',
      };
    } else if (sellMatch) {
      parsed = {
        type: 'SELL',
        name: sellMatch[1].trim(),
        ticker: undefined,
        quantity: parseInt(sellMatch[2]),
        price: parseFloat(sellMatch[4].replace(/,/g, '')),
        currency: (sellMatch[5] === '달러' || sellMatch[5] === '불') ? 'USD' : 'KRW',
      };
    } else if (divMatch) {
      parsed = {
        type: 'DIVIDEND',
        name: divMatch[1].trim(),
        ticker: undefined,
        quantity: null,
        price: parseFloat(divMatch[2].replace(/,/g, '')),
        currency: (divMatch[3] === '달러' || divMatch[3] === '불') ? 'USD' : 'KRW',
      };
    } else if (buyENMatch) {
      parsed = {
        type: 'BUY',
        ticker: buyENMatch[1].toUpperCase(),
        name: buyENMatch[1].toUpperCase(),
        quantity: parseInt(buyENMatch[2]),
        price: parseFloat(buyENMatch[3]),
        currency: 'USD',
      };
    } else if (sellENMatch) {
      parsed = {
        type: 'SELL',
        ticker: sellENMatch[1].toUpperCase(),
        name: sellENMatch[1].toUpperCase(),
        quantity: parseInt(sellENMatch[2]),
        price: parseFloat(sellENMatch[3]),
        currency: 'USD',
      };
    }

    // Step 3: AI parsing fallback
    if (!parsed) {
      await ctx.replyWithChatAction('typing');
      try {
        const aiResponse = await callWithFallback([
          {
            role: 'system',
            content: '사용자의 메시지에서 주식 거래 정보를 추출하세요. JSON으로만 응답하세요.\n{"type":"BUY|SELL|DIVIDEND|UNKNOWN","ticker":"종목코드","name":"종목명","quantity":숫자,"price":숫자,"currency":"KRW|USD"}\n거래 정보가 아닌 메시지면 {"type":"UNKNOWN"}으로 응답하세요.',
          },
          { role: 'user', content: text },
        ], { temperature: 0.1 });

        const cleaned = aiResponse.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const aiParsed = JSON.parse(cleaned);
        if (aiParsed.type !== 'UNKNOWN') {
          parsed = aiParsed as ParsedTrade;
        }
      } catch {
        // AI parsing failed — fall through to unknown
      }
    }

    // Step 4: Got a valid trade — ask for confirmation
    if (parsed && parsed.type !== ('UNKNOWN' as string)) {
      const typeLabel = parsed.type === 'BUY' ? '매수' : parsed.type === 'SELL' ? '매도' : '배당';
      const priceStr = parsed.currency === 'USD' ? `$${parsed.price}` : `${parsed.price.toLocaleString('ko-KR')}원`;
      const qtyStr = parsed.quantity != null ? `${parsed.quantity}주` : '';

      const confirmMsg = `✅ 아래 내용이 맞으신가요?\n\n<b>${typeLabel}</b>: ${parsed.name}${parsed.ticker ? `(${parsed.ticker})` : ''} ${qtyStr} @ ${priceStr}\n\n맞으시면 <b>'네'</b>, 수정하시려면 다시 입력해주세요.`;

      await supabase.from('conversation_state').upsert({
        chat_id: chatId,
        state: { pendingTrade: parsed },
        updated_at: new Date().toISOString(),
      });

      await ctx.reply(confirmMsg, { parse_mode: 'HTML' });
      return;
    }

    // Step 5: Unknown
    await ctx.reply(
      '이해하지 못했어요 😅\n\n거래 기록: <code>애플 10주 샀어 178달러에</code>\n명령어: /help 로 사용법 확인',
      { parse_mode: 'HTML' }
    );
  });

  _handleUpdate = webhookCallback(bot, 'std/http') as (req: NextRequest) => Promise<Response>;
  return _handleUpdate;
}

// ─── Execute confirmed trade ───────────────────────────────────
async function executeTrade(
  supabase: ReturnType<typeof getSupabase>,
  trade: {
    type: 'BUY' | 'SELL' | 'DIVIDEND';
    ticker?: string;
    name: string;
    quantity: number | null;
    price: number;
    currency: 'KRW' | 'USD';
  },
  ctx: { reply: (text: string, opts?: { parse_mode?: ParseMode }) => Promise<unknown> }
) {
  const today = new Date();
  const kstToday = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const transactionDate = kstToday.toISOString().split('T')[0];

  // Determine market
  const isUS = trade.currency === 'USD' || (trade.ticker && /^[A-Z]{1,5}$/.test(trade.ticker));
  const market = isUS ? 'US' : 'KR';

  // Settlement date (skip weekends simply)
  function addBusinessDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    let added = 0;
    while (added < days) {
      d.setUTCDate(d.getUTCDate() + 1);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d.toISOString().split('T')[0];
  }

  const settlementDays = market === 'US' ? 1 : 2;
  const settlementDate = addBusinessDays(transactionDate, settlementDays);

  // Get exchange rate for USD trades
  let exchangeRate: number | null = null;
  let priceKRW = trade.price;
  let priceUSD: number | null = null;

  if (trade.currency === 'USD') {
    try {
      const { getExchangeRate } = await import('@/lib/market-data/exchange-rate');
      exchangeRate = await getExchangeRate();
      priceKRW = trade.price * exchangeRate;
      priceUSD = trade.price;
    } catch {
      exchangeRate = 1350;
      priceKRW = trade.price * 1350;
      priceUSD = trade.price;
    }
  }

  // Look up ticker from holdings if not provided
  let ticker = trade.ticker ?? '';
  if (!ticker) {
    const { data: holding } = await supabase
      .from('portfolio_holdings')
      .select('ticker')
      .ilike('name', `%${trade.name}%`)
      .limit(1)
      .single();
    ticker = holding?.ticker ?? trade.name.toUpperCase().replace(/\s/g, '');
  }

  // Calculate realized gain for SELL
  let realizedGain: number | null = null;
  if (trade.type === 'SELL' && trade.quantity != null) {
    const { data: holding } = await supabase
      .from('portfolio_holdings')
      .select('avg_cost, quantity')
      .eq('ticker', ticker)
      .single();
    if (holding) {
      realizedGain = trade.quantity * (priceKRW - holding.avg_cost);
    }
  }

  // Insert transaction
  await supabase.from('transactions').insert({
    ticker,
    name: trade.name,
    market,
    type: trade.type,
    quantity: trade.quantity,
    price: priceKRW,
    price_usd: priceUSD,
    exchange_rate: exchangeRate,
    realized_gain: realizedGain,
    transaction_date: transactionDate,
    settlement_date: settlementDate,
  });

  // Update portfolio_holdings
  if (trade.type === 'BUY' && trade.quantity != null) {
    const { data: existing } = await supabase
      .from('portfolio_holdings')
      .select('*')
      .eq('ticker', ticker)
      .single();

    if (existing) {
      const newQty = existing.quantity + trade.quantity;
      const newAvgCost = (existing.avg_cost * existing.quantity + priceKRW * trade.quantity) / newQty;
      const newAvgCostUSD = priceUSD != null && existing.avg_cost_usd != null
        ? (existing.avg_cost_usd * existing.quantity + priceUSD * trade.quantity) / newQty
        : existing.avg_cost_usd;

      await supabase.from('portfolio_holdings').update({
        quantity: newQty,
        avg_cost: newAvgCost,
        avg_cost_usd: newAvgCostUSD,
        updated_at: new Date().toISOString(),
      }).eq('ticker', ticker);
    } else {
      await supabase.from('portfolio_holdings').insert({
        ticker,
        name: trade.name,
        market,
        quantity: trade.quantity,
        avg_cost: priceKRW,
        avg_cost_usd: priceUSD,
      });
    }
  } else if (trade.type === 'SELL' && trade.quantity != null) {
    const { data: existing } = await supabase
      .from('portfolio_holdings')
      .select('quantity')
      .eq('ticker', ticker)
      .single();

    if (existing) {
      const newQty = existing.quantity - trade.quantity;
      if (newQty <= 0) {
        await supabase.from('portfolio_holdings').delete().eq('ticker', ticker);
      } else {
        await supabase.from('portfolio_holdings').update({
          quantity: newQty,
          updated_at: new Date().toISOString(),
        }).eq('ticker', ticker);
      }
    }
  }

  // Update tax tracker
  try {
    const { updateTaxTracker } = await import('@/lib/tax/tracker');
    await updateTaxTracker(supabase, new Date().getFullYear());
  } catch (e) {
    console.warn('[webhook] Tax tracker update failed:', e);
  }

  // Reply confirmation
  const typeLabel = trade.type === 'BUY' ? '매수' : trade.type === 'SELL' ? '매도' : '배당';
  const priceDisplay = trade.currency === 'USD'
    ? `$${trade.price} (₩${Math.round(priceKRW).toLocaleString('ko-KR')})`
    : `₩${Math.round(priceKRW).toLocaleString('ko-KR')}`;

  const { data: updated } = await supabase
    .from('portfolio_holdings')
    .select('quantity')
    .eq('ticker', ticker)
    .single();

  const newQtyMsg = updated ? `현재 보유: ${ticker} ${updated.quantity}주` : '';

  await ctx.reply(
    `✅ 기록 완료!\n\n<b>${typeLabel}</b>: ${trade.name}(${ticker}) ${trade.quantity ?? ''}${trade.quantity ? '주' : ''} @ ${priceDisplay}\n${newQtyMsg}`,
    { parse_mode: 'HTML' }
  );

  await supabase.from('chat_messages').insert({
    direction: 'outgoing',
    message_text: `${typeLabel} 기록 완료: ${ticker}`,
  });
}

// ─── POST handler ──────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await getBotHandler()(req) as NextResponse;
  } catch (err) {
    console.error('[webhook] Error:', err);
    return NextResponse.json({ ok: false }, { status: 200 }); // always 200 to Telegram
  }
}
