import { NextRequest, NextResponse } from 'next/server';
import { Bot, webhookCallback } from 'grammy';

export const maxDuration = 60;
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

  // ─── Global error handler ──────────────────────────────────────
  bot.catch((err) => {
    console.error('[grammy] Unhandled error:', err.error, 'ctx:', err.ctx?.update);
  });

  // ─── /start ────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    try {
      const supabase = getSupabase();
      const chatId = ctx.chat.id.toString();

      const { data: holdings, error: holdingsErr } = await supabase
        .from('portfolio_holdings')
        .select('*');

      if (holdingsErr) {
        console.error('[start] portfolio_holdings query error:', holdingsErr);
      }

      const hasHoldings = holdings && holdings.length > 0;

      if (hasHoldings) {
        await ctx.reply(
          `안녕하세요! 👋 다시 오셨네요 😊\n\n현재 <b>${holdings.length}개</b> 종목을 보유 중이세요.\n\n/portfolio - 현재 보유 종목 확인\n/today - 오늘 브리핑 보기\n/help - 사용법 안내`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 먼저 메시지를 보내고, 그 다음 DB 작업
      await ctx.reply(
        `안녕하세요! 👋 AI 투자 어드바이저입니다 😊\n\n매일 아침 시장을 분석해서 투자 브리핑을 보내드릴게요.\n\n먼저 현재 보유하고 계신 주식을 알려주시겠어요?\n\n예시:\n• <code>애플 100주 갖고 있어, 165달러에 샀어</code>\n• <code>삼성전자 200주, 평균 82,000원</code>\n• <code>NVDA 50주 420달러에 매수했어</code>\n\n없으시면 "없어요"라고 말씀해 주세요 🙂`,
        { parse_mode: 'HTML' }
      );

      // 온보딩 상태 저장 (실패해도 사용자에겐 이미 메시지 전송됨)
      const { error: upsertErr } = await supabase.from('conversation_state').upsert({
        chat_id: chatId,
        state: { onboarding: { step: 'waiting_for_holdings', holdings: [] } },
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) {
        console.error('[start] conversation_state upsert error:', upsertErr);
      }
    } catch (err) {
      console.error('[start] Error:', err);
      await ctx.reply('안녕하세요! 😊 잠시 오류가 있었어요. 다시 /start 를 눌러주세요.');
    }
  });

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
      await ctx.reply('아직 오늘 브리핑이 생성되지 않았어요. 잠시 후 다시 시도해주세요. 😊');
      return;
    }

    const formatted = formatMorningBriefing(
      briefing.leader_recommendation,
      briefing.conservative_analysis,
      briefing.aggressive_analysis
    );

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
    const chatId = ctx.chat.id.toString();
    const { data: holdings } = await supabase.from('portfolio_holdings').select('*');

    if (!holdings || holdings.length === 0) {
      // 포트폴리오 없으면 온보딩 시작
      await supabase.from('conversation_state').upsert({
        chat_id: chatId,
        state: { onboarding: { step: 'waiting_for_holdings', holdings: [] } },
        updated_at: new Date().toISOString(),
      });
      await ctx.reply(
        '아직 보유 종목이 등록되지 않았어요 📋\n\n현재 갖고 계신 주식을 알려주시면 바로 등록해드릴게요!\n\n예시:\n• <code>애플 100주 갖고 있어, 165달러에 샀어</code>\n• <code>삼성전자 200주, 평균 82,000원</code>',
        { parse_mode: 'HTML' }
      );
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

    // 현재 대화 상태 로드
    const { data: stateRow } = await supabase
      .from('conversation_state')
      .select('state')
      .eq('chat_id', chatId)
      .single();

    const state = stateRow?.state ?? {};

    // ─── 온보딩 플로우 ─────────────────────────────────────────
    if (state.onboarding?.step === 'waiting_for_holdings' || state.onboarding?.step === 'waiting_for_more') {
      await ctx.replyWithChatAction('typing');
      await handleOnboardingMessage(ctx, text, chatId, supabase, state.onboarding);
      return;
    }

    // ─── 거래 확인 대기 중 ─────────────────────────────────────
    const pendingTrade = state.pendingTrade ?? null;

    if (pendingTrade) {
      const trimmed = text.trim();
      const isYes = /^(네|맞아|ㅇㅇ|응|예|맞음|ㅇ)$/i.test(trimmed);
      const isNo = /^(아니|아니요|ㄴㄴ|노|취소|아냐)$/i.test(trimmed);

      if (isYes) {
        await executeTrade(supabase, pendingTrade, ctx);
        await supabase.from('conversation_state').delete().eq('chat_id', chatId);
        return;
      } else if (isNo) {
        await supabase.from('conversation_state').delete().eq('chat_id', chatId);
        await ctx.reply('취소했어요. 다시 말씀해 주세요 😊');
        return;
      } else {
        await supabase.from('conversation_state').delete().eq('chat_id', chatId);
      }
    }

    // ─── 거래 파싱 (정규식) ────────────────────────────────────
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
        type: 'BUY', name: buyMatch[1].trim(), ticker: undefined,
        quantity: parseInt(buyMatch[2]),
        price: parseFloat(buyMatch[4].replace(/,/g, '')),
        currency: (buyMatch[5] === '달러' || buyMatch[5] === '불') ? 'USD' : 'KRW',
      };
    } else if (sellMatch) {
      parsed = {
        type: 'SELL', name: sellMatch[1].trim(), ticker: undefined,
        quantity: parseInt(sellMatch[2]),
        price: parseFloat(sellMatch[4].replace(/,/g, '')),
        currency: (sellMatch[5] === '달러' || sellMatch[5] === '불') ? 'USD' : 'KRW',
      };
    } else if (divMatch) {
      parsed = {
        type: 'DIVIDEND', name: divMatch[1].trim(), ticker: undefined, quantity: null,
        price: parseFloat(divMatch[2].replace(/,/g, '')),
        currency: (divMatch[3] === '달러' || divMatch[3] === '불') ? 'USD' : 'KRW',
      };
    } else if (buyENMatch) {
      parsed = {
        type: 'BUY', ticker: buyENMatch[1].toUpperCase(), name: buyENMatch[1].toUpperCase(),
        quantity: parseInt(buyENMatch[2]), price: parseFloat(buyENMatch[3]), currency: 'USD',
      };
    } else if (sellENMatch) {
      parsed = {
        type: 'SELL', ticker: sellENMatch[1].toUpperCase(), name: sellENMatch[1].toUpperCase(),
        quantity: parseInt(sellENMatch[2]), price: parseFloat(sellENMatch[3]), currency: 'USD',
      };
    }

    // ─── AI 파싱 폴백 ──────────────────────────────────────────
    if (!parsed) {
      await ctx.replyWithChatAction('typing');
      try {
        const aiResponse = await callWithFallback([
          {
            role: 'system',
            content: `사용자의 메시지를 분석하세요. JSON으로만 응답하세요.

거래 기록이면:
{"type":"BUY|SELL|DIVIDEND","ticker":"종목코드","name":"종목명","quantity":숫자,"price":숫자,"currency":"KRW|USD"}

거래 정보가 아닌 일반 메시지면:
{"type":"UNKNOWN"}

예시:
- "애플 10주 샀어 178달러에" → {"type":"BUY","ticker":"AAPL","name":"애플","quantity":10,"price":178,"currency":"USD"}
- "오늘 날씨 어때?" → {"type":"UNKNOWN"}`,
          },
          { role: 'user', content: text },
        ], { temperature: 0.1 });

        const cleaned = aiResponse.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const aiParsed = JSON.parse(cleaned);
        if (aiParsed.type !== 'UNKNOWN') {
          parsed = aiParsed as ParsedTrade;
        }
      } catch {
        // AI 파싱 실패 — 아래로 진행
      }
    }

    // ─── 거래 확인 요청 ────────────────────────────────────────
    if (parsed && parsed.type !== ('UNKNOWN' as string)) {
      const typeLabel = parsed.type === 'BUY' ? '매수' : parsed.type === 'SELL' ? '매도' : '배당';
      const priceStr = parsed.currency === 'USD' ? `$${parsed.price}` : `${parsed.price.toLocaleString('ko-KR')}원`;
      const qtyStr = parsed.quantity != null ? `${parsed.quantity}주` : '';

      const confirmMsg = `✅ 아래 내용이 맞으신가요?\n\n<b>${typeLabel}</b>: ${parsed.name}${parsed.ticker ? `(${parsed.ticker})` : ''} ${qtyStr} @ ${priceStr}\n\n맞으시면 <b>'네'</b>, 아니면 다시 입력해주세요.`;

      await supabase.from('conversation_state').upsert({
        chat_id: chatId,
        state: { pendingTrade: parsed },
        updated_at: new Date().toISOString(),
      });

      await ctx.reply(confirmMsg, { parse_mode: 'HTML' });
      return;
    }

    // ─── 이해 못한 경우 ────────────────────────────────────────
    await ctx.reply(
      '잘 이해하지 못했어요 😅\n\n거래를 기록하시려면:\n<code>애플 10주 샀어 178달러에</code>\n\n명령어 목록은 /help 를 눌러주세요!',
      { parse_mode: 'HTML' }
    );
  });

  _handleUpdate = webhookCallback(bot, 'std/http') as (req: NextRequest) => Promise<Response>;
  return _handleUpdate;
}

// ─── 온보딩 메시지 처리 ────────────────────────────────────────
async function handleOnboardingMessage(
  ctx: { reply: (text: string, opts?: { parse_mode?: ParseMode }) => Promise<unknown>; replyWithChatAction: (action: 'typing') => Promise<unknown> },
  text: string,
  chatId: string,
  supabase: ReturnType<typeof getSupabase>,
  onboardingState: { step: string; holdings: Array<{ ticker: string; name: string; market: string; quantity: number; avg_cost: number; avg_cost_usd: number | null }> }
) {
  const trimmed = text.trim();

  // 없다고 하는 경우
  const isDone = /^(없어|없어요|없음|그게 다야|끝|다야|완료|이게 다예요|이게 다야)/.test(trimmed);

  if (isDone) {
    const count = onboardingState.holdings.length;
    await supabase.from('conversation_state').delete().eq('chat_id', chatId);

    if (count === 0) {
      await ctx.reply(
        '알겠어요! 나중에 주식을 사시면 언제든지 말씀해 주세요 😊\n\n예: <code>애플 10주 샀어 178달러에</code>',
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        `총 <b>${count}개</b> 종목 등록 완료했어요! 🎉\n\n내일 아침 7시부터 브리핑을 받아보실 수 있어요.\n지금 바로 보시려면 /today 를 눌러주세요 😊`,
        { parse_mode: 'HTML' }
      );
    }
    return;
  }

  // AI로 보유 종목 파싱
  try {
    const aiResponse = await callWithFallback([
      {
        role: 'system',
        content: `사용자가 현재 보유 중인 주식을 알려주고 있습니다. JSON으로만 응답하세요.

보유 종목이면:
{"type":"HOLDING","ticker":"종목코드(모르면 빈문자열)","name":"종목명","quantity":주수,"avgPrice":평균매수가,"currency":"KRW|USD"}

이해 못하면:
{"type":"UNKNOWN"}

예시:
- "애플 100주 165달러에 샀어" → {"type":"HOLDING","ticker":"AAPL","name":"애플","quantity":100,"avgPrice":165,"currency":"USD"}
- "삼성전자 200주 82000원" → {"type":"HOLDING","ticker":"005930","name":"삼성전자","quantity":200,"avgPrice":82000,"currency":"KRW"}
- "SK하이닉스 50주 있어, 155000원에 샀어" → {"type":"HOLDING","ticker":"000660","name":"SK하이닉스","quantity":50,"avgPrice":155000,"currency":"KRW"}`,
      },
      { role: 'user', content: trimmed },
    ], { temperature: 0.1 });

    const cleaned = aiResponse.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.type === 'HOLDING' && parsed.name && parsed.quantity > 0) {
      // 환율 가져오기
      let avgCostKRW = parsed.avgPrice;
      let avgCostUSD: number | null = null;

      if (parsed.currency === 'USD') {
        try {
          const { getExchangeRate } = await import('@/lib/market-data/exchange-rate');
          const rate = await getExchangeRate();
          avgCostKRW = parsed.avgPrice * rate;
          avgCostUSD = parsed.avgPrice;
        } catch {
          avgCostKRW = parsed.avgPrice * 1350;
          avgCostUSD = parsed.avgPrice;
        }
      }

      const market = parsed.currency === 'USD' ? 'US' : 'KR';
      const ticker = parsed.ticker || parsed.name.toUpperCase().replace(/\s/g, '');

      // portfolio_holdings에 upsert
      await supabase.from('portfolio_holdings').upsert({
        ticker,
        name: parsed.name,
        market,
        quantity: parsed.quantity,
        avg_cost: avgCostKRW,
        avg_cost_usd: avgCostUSD,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'ticker' });

      // 온보딩 상태 업데이트
      const updatedHoldings = [...(onboardingState.holdings ?? []), { ticker, name: parsed.name, market, quantity: parsed.quantity, avg_cost: avgCostKRW, avg_cost_usd: avgCostUSD }];

      await supabase.from('conversation_state').upsert({
        chat_id: chatId,
        state: { onboarding: { step: 'waiting_for_more', holdings: updatedHoldings } },
        updated_at: new Date().toISOString(),
      });

      const priceDisplay = parsed.currency === 'USD'
        ? `$${parsed.avgPrice} (₩${Math.round(avgCostKRW).toLocaleString('ko-KR')})`
        : `₩${parsed.avgPrice.toLocaleString('ko-KR')}`;

      await ctx.reply(
        `✅ <b>${parsed.name}</b> ${parsed.quantity}주 @ ${priceDisplay} 등록했어요!\n\n다른 종목도 있으신가요?\n있으시면 말씀해 주시고, 없으시면 <b>"없어요"</b>라고 해주세요 😊`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // 이해 못한 경우
    await ctx.reply(
      '죄송해요, 잘 이해하지 못했어요 😅\n\n이렇게 말씀해 주시면 돼요:\n• <code>애플 100주, 165달러에 샀어</code>\n• <code>삼성전자 200주 82000원</code>\n\n종목이 없으시면 <b>"없어요"</b>라고 해주세요!',
      { parse_mode: 'HTML' }
    );

  } catch {
    await ctx.reply('잠시 오류가 생겼어요. 다시 한번 말씀해 주시겠어요? 😊');
  }
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

  const isUS = trade.currency === 'USD' || (trade.ticker && /^[A-Z]{1,5}$/.test(trade.ticker));
  const market = isUS ? 'US' : 'KR';

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

  await supabase.from('transactions').insert({
    ticker, name: trade.name, market, type: trade.type,
    quantity: trade.quantity, price: priceKRW, price_usd: priceUSD,
    exchange_rate: exchangeRate, realized_gain: realizedGain,
    transaction_date: transactionDate, settlement_date: settlementDate,
  });

  if (trade.type === 'BUY' && trade.quantity != null) {
    const { data: existing } = await supabase
      .from('portfolio_holdings').select('*').eq('ticker', ticker).single();

    if (existing) {
      const newQty = existing.quantity + trade.quantity;
      const newAvgCost = (existing.avg_cost * existing.quantity + priceKRW * trade.quantity) / newQty;
      const newAvgCostUSD = priceUSD != null && existing.avg_cost_usd != null
        ? (existing.avg_cost_usd * existing.quantity + priceUSD * trade.quantity) / newQty
        : existing.avg_cost_usd;
      await supabase.from('portfolio_holdings').update({
        quantity: newQty, avg_cost: newAvgCost, avg_cost_usd: newAvgCostUSD,
        updated_at: new Date().toISOString(),
      }).eq('ticker', ticker);
    } else {
      await supabase.from('portfolio_holdings').insert({
        ticker, name: trade.name, market, quantity: trade.quantity,
        avg_cost: priceKRW, avg_cost_usd: priceUSD,
      });
    }
  } else if (trade.type === 'SELL' && trade.quantity != null) {
    const { data: existing } = await supabase
      .from('portfolio_holdings').select('quantity').eq('ticker', ticker).single();
    if (existing) {
      const newQty = existing.quantity - trade.quantity;
      if (newQty <= 0) {
        await supabase.from('portfolio_holdings').delete().eq('ticker', ticker);
      } else {
        await supabase.from('portfolio_holdings').update({
          quantity: newQty, updated_at: new Date().toISOString(),
        }).eq('ticker', ticker);
      }
    }
  }

  try {
    const { updateTaxTracker } = await import('@/lib/tax/tracker');
    await updateTaxTracker(supabase, new Date().getFullYear());
  } catch (e) {
    console.warn('[webhook] Tax tracker update failed:', e);
  }

  const typeLabel = trade.type === 'BUY' ? '매수' : trade.type === 'SELL' ? '매도' : '배당';
  const priceDisplay = trade.currency === 'USD'
    ? `$${trade.price} (₩${Math.round(priceKRW).toLocaleString('ko-KR')})`
    : `₩${Math.round(priceKRW).toLocaleString('ko-KR')}`;

  const { data: updated } = await supabase
    .from('portfolio_holdings').select('quantity').eq('ticker', ticker).single();
  const newQtyMsg = updated ? `\n현재 보유: ${ticker} ${updated.quantity}주` : '';

  await ctx.reply(
    `✅ 기록 완료!\n\n<b>${typeLabel}</b>: ${trade.name}(${ticker}) ${trade.quantity ?? ''}${trade.quantity ? '주' : ''} @ ${priceDisplay}${newQtyMsg}`,
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
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
