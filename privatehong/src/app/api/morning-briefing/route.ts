export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { collectMarketData } from '@/lib/market-data';
import { runAllAgents } from '@/lib/agents';
import { formatMorningBriefing } from '@/lib/formatters/briefing-formatter';
import { sendMessage } from '@/lib/telegram';
import { getTaxSummary, updateTaxTracker } from '@/lib/tax/tracker';

// Korean holidays for 2026 (fixed + hardcoded lunar)
const KR_HOLIDAYS_2026 = new Set([
  '01-01', '03-01', '05-05', '06-06',
  '08-15', '10-03', '10-09', '12-25',
  // 설날 2026
  '02-16', '02-17', '02-18',
  // 추석 2026
  '09-24', '09-25', '09-26',
]);

function isTradingDay(kstDate: Date): boolean {
  const dow = kstDate.getUTCDay();
  if (dow === 0 || dow === 6) return false;

  const mm = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstDate.getUTCDate()).padStart(2, '0');
  const key = `${mm}-${dd}`;

  return !KR_HOLIDAYS_2026.has(key);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Auth check
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateStr = kstNow.toISOString().split('T')[0];
  const year = kstNow.getUTCFullYear();

  // 2. Trading day check
  if (!isTradingDay(kstNow)) {
    await sendMessage('📅 오늘은 휴장일이에요. 좋은 하루 보내세요! 😊');
    return NextResponse.json({ ok: true, skipped: 'holiday' });
  }

  try {
    // 3. Fetch portfolio
    const { data: holdings } = await supabase.from('portfolio_holdings').select('*');
    const safeHoldings = (holdings ?? []) as Parameters<typeof collectMarketData>[0];

    // 4. Fetch tax tracker
    const taxSummary = await getTaxSummary(supabase, year);
    const taxTracker = {
      ytd_realized_gain_us: taxSummary.ytdGain,
      ytd_realized_loss_us: taxSummary.ytdLoss,
      ytd_dividend_income: 0,
      estimated_tax: taxSummary.estimatedTax,
    };

    // 5. Collect market data
    const marketData = await collectMarketData(safeHoldings);

    // 6. Run AI agents
    const { conservative, aggressive, leader, providerUsed } = await runAllAgents(
      marketData,
      safeHoldings,
      taxTracker
    );

    // 7. Format briefing
    const briefingText = formatMorningBriefing(leader, conservative, aggressive);

    // 8. Send to Telegram
    await sendMessage(briefingText);

    // 9. Save to DB
    await supabase.from('daily_briefings').upsert({
      date: dateStr,
      conservative_analysis: conservative,
      aggressive_analysis: aggressive,
      leader_recommendation: leader,
      market_data_snapshot: marketData,
      provider_used: providerUsed,
    }, { onConflict: 'date' });

    // 10. Update tax tracker
    await updateTaxTracker(supabase, year);

    return NextResponse.json({ ok: true, date: dateStr, provider: providerUsed });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[morning-briefing] Fatal error:', err);
    await sendMessage(`⚠️ 오늘 브리핑 생성 중 오류가 발생했어요.\n${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
