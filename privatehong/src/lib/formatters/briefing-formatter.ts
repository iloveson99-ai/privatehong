import type { LeaderRecommendation, ConservativeAnalysis, AggressiveAnalysis } from '../agents/types';
import type { PortfolioHolding } from '../market-data';
import type { TaxSummary } from '../tax/tracker';
import type { HarvestingOpportunity } from '../tax/loss-harvesting';

const KR_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatManWon(amount: number): string {
  return Math.round(amount / 10000).toLocaleString('ko-KR');
}

function formatWithCommas(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

function actionEmoji(action: string): string {
  switch (action) {
    case '매수': return '✅';
    case '매도': return '❌';
    case '보유': return '📌';
    case '비중축소': return '⬇️';
    case '비중확대': return '⬆️';
    default: return '•';
  }
}

export interface Quote {
  price: number;
  changePercent: number;
}

export function formatMorningBriefing(
  leader: LeaderRecommendation,
  conservative: ConservativeAnalysis | null,
  aggressive: AggressiveAnalysis | null
): string {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  const dayName = KR_DAYS[kstNow.getUTCDay()];
  const dateStr = `${yyyy}.${mm}.${dd} (${dayName})`;

  const riskEmoji = { '안전': '🟢', '보통': '🟡', '주의': '🟠', '위험': '🔴' }[leader.risk_level] ?? '⚪';

  let conservativeSection: string;
  if (!conservative) {
    conservativeSection = '⚠️ 분석 실패';
  } else {
    const recs = conservative.recommendations.slice(0, 3);
    conservativeSection = recs.map(r =>
      `• ${actionEmoji(r.action)} <b>${escapeHtml(r.name)}</b>(${escapeHtml(r.ticker)}): ${escapeHtml(r.reason)} [확신: ${r.conviction}]`
    ).join('\n');
    if (conservative.risk_warnings?.length) {
      conservativeSection += '\n⚠️ ' + conservative.risk_warnings.map(escapeHtml).join(' | ');
    }
  }

  let aggressiveSection: string;
  if (!aggressive) {
    aggressiveSection = '⚠️ 분석 실패';
  } else {
    const recs = aggressive.recommendations.slice(0, 3);
    aggressiveSection = recs.map(r =>
      `• ${actionEmoji(r.action)} <b>${escapeHtml(r.name)}</b>(${escapeHtml(r.ticker)}): ${escapeHtml(r.reason)} [확신: ${r.conviction}]`
    ).join('\n');
    if (aggressive.risk_warnings?.length) {
      aggressiveSection += '\n⚠️ ' + aggressive.risk_warnings.map(escapeHtml).join(' | ');
    }
  }

  const actionsSection = leader.actions.map(a => {
    let line = `${actionEmoji(a.action)} <b>${a.action}</b>: ${escapeHtml(a.name)}(${escapeHtml(a.ticker)}) ${escapeHtml(a.quantity_or_amount)}\n  → ${escapeHtml(a.reason)}`;
    if (a.tax_impact && a.tax_impact.trim()) {
      line += `\n  💰 ${escapeHtml(a.tax_impact)}`;
    }
    return line;
  }).join('\n\n');

  const taxAlert = leader.tax_alert;
  const taxSection = [
    `• 연중 실현이익: <b>${formatManWon(taxAlert.ytd_realized_gain)}만 원</b>`,
    `• 공제 잔여: <b>${formatManWon(taxAlert.remaining_deduction)}만 원</b>`,
    `• 예상 연간 세금: <b>${formatManWon(taxAlert.estimated_annual_tax)}만 원</b>`,
    ...(taxAlert.tax_saving_opportunities?.length
      ? taxAlert.tax_saving_opportunities.map(op => `💡 ${escapeHtml(op)}`)
      : []),
  ].join('\n');

  const nextWatchSection = leader.next_watch?.map(w => `• ${escapeHtml(w)}`).join('\n') ?? '';

  let full = `📊 <b>${dateStr} 일일 투자 브리핑</b>
${riskEmoji} 위험등급: <b>${leader.risk_level}</b>

━━━ 핵심 요약 ━━━
${escapeHtml(leader.summary)}

━━━ 시장 전망 ━━━
${escapeHtml(leader.market_outlook)}

━━━ 보수적 투자자 🛡️ ━━━
${conservativeSection}

━━━ 급진적 투자자 🔥 ━━━
${aggressiveSection}

━━━ 종합 투자의견 👑 ━━━
${actionsSection}

━━━ 세금 현황 💰 ━━━
${taxSection}

━━━ 내일 주목 👀 ━━━
${nextWatchSection}`;

  // If over 4000 chars, truncate conservative/aggressive to 3 recs (already done above)
  // but if still over, trim next_watch
  if (full.length > 4000) {
    full = full.substring(0, 3990) + '\n…(생략)';
  }

  return full;
}

export function formatPortfolio(
  holdings: PortfolioHolding[],
  quotes: Map<string, Quote>,
  exchangeRate: number
): string {
  const usHoldings = holdings.filter(h => h.market === 'US');
  const krHoldings = holdings.filter(h => h.market === 'KR');

  let totalUS = 0;
  let totalUSCost = 0;

  const usLines = usHoldings.map(h => {
    const q = quotes.get(h.ticker);
    const currentPriceKRW = q ? q.price * exchangeRate : 0;
    const totalValue = currentPriceKRW * h.quantity;
    const costValue = (h.avg_cost_usd ?? 0) * exchangeRate * h.quantity;
    totalUS += totalValue;
    totalUSCost += costValue;
    const pct = q ? (q.changePercent >= 0 ? '+' : '') + q.changePercent.toFixed(2) : '–';
    return `• <b>${escapeHtml(h.name)}</b> ${h.quantity}주 | 평균 $${h.avg_cost_usd ?? '–'} | 현재 $${q ? q.price.toFixed(2) : '–'} (${pct}%)\n  평가: ₩${formatWithCommas(totalValue)}`;
  });

  let totalKR = 0;
  let totalKRCost = 0;

  const krLines = krHoldings.map(h => {
    const q = quotes.get(h.ticker);
    const currentPrice = q ? q.price : 0;
    const totalValue = currentPrice * h.quantity;
    const costValue = h.avg_cost * h.quantity;
    totalKR += totalValue;
    totalKRCost += costValue;
    const pct = q ? (q.changePercent >= 0 ? '+' : '') + q.changePercent.toFixed(2) : '–';
    return `• <b>${escapeHtml(h.name)}</b> ${h.quantity}주 | 평균 ${formatWithCommas(h.avg_cost)}원 | 현재 ${q ? formatWithCommas(q.price) : '–'}원 (${pct}%)`;
  });

  const grandTotal = totalUS + totalKR;
  const totalCost = totalUSCost + totalKRCost;
  const overallPnL = totalCost > 0 ? ((grandTotal - totalCost) / totalCost * 100).toFixed(2) : '0.00';
  const pnlSign = parseFloat(overallPnL) >= 0 ? '+' : '';

  return `📁 <b>현재 포트폴리오</b>

🇺🇸 <b>미국주식</b>
${usLines.join('\n') || '보유 종목 없음'}
소계: ₩${formatWithCommas(totalUS)}

🇰🇷 <b>한국주식</b>
${krLines.join('\n') || '보유 종목 없음'}
소계: ₩${formatWithCommas(totalKR)}

💰 총 평가금액: <b>₩${formatWithCommas(grandTotal)}</b>
📈 총 수익률: <b>${pnlSign}${overallPnL}%</b>`;
}

export function formatTaxSummary(
  taxSummary: TaxSummary,
  harvestingOpps: HarvestingOpportunity[],
  year: number
): string {
  const lines = [
    `💰 <b>${year}년 세금 현황</b>`,
    '',
    `미국주식 실현이익: <b>${formatManWon(taxSummary.ytdGain)}만 원</b>`,
    `미국주식 실현손실: <b>${formatManWon(taxSummary.ytdLoss)}만 원</b>`,
    `순이익: <b>${formatManWon(taxSummary.netGain)}만 원</b>`,
    `기본공제 잔여: <b>${formatManWon(taxSummary.deductionRemaining)}만 원</b>`,
    `예상 양도소득세: 약 <b>${formatManWon(taxSummary.estimatedTax)}만 원</b>`,
  ];

  if (harvestingOpps.length > 0) {
    lines.push('');
    lines.push('💡 <b>손실상계 기회:</b>');
    for (const opp of harvestingOpps) {
      const urgentMark = opp.urgent ? ' 🔴' : '';
      lines.push(`• ${escapeHtml(opp.name)}(${escapeHtml(opp.ticker)}) 매도 시 약 ${formatManWon(opp.potentialTaxSaving)}만 원 절세 가능${urgentMark}`);
    }
  }

  if (taxSummary.comprehensiveTaxWarning) {
    lines.push('');
    lines.push('⚠️ 금융소득(이자+배당)이 2,000만 원에 근접하고 있습니다. 추가 배당 수령 시 종합과세 대상이 될 수 있으니 주의하세요.');
  }

  return lines.join('\n');
}
