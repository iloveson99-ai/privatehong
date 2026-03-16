import { callGemini } from '../ai-providers/gemini';
import { callGroq } from '../ai-providers/groq';
import type { AIMessage } from '../ai-providers/types';
import type { MarketData, PortfolioHolding } from '../market-data';
import type { ConservativeAnalysis, AggressiveAnalysis, LeaderRecommendation } from './types';

const SYSTEM_PROMPT = `당신은 수석 투자 전략가입니다. 보수적 분석가와 공격적 분석가의 의견을 종합하여 최종 투자 결정을 내립니다.
투자자 프로필:
- 미국주식 약 2억 원 (키움증권), 한국주식 약 1억 원 (하나투자증권) 보유
- 월 평균 300만 원 이상 수익 목표
- 세금 최적화 중요
세금 규칙 (반드시 매 추천에 반영):
- 미국주식 양도소득세: 22% (20% + 지방소득세 2%), 연 250만 원 기본공제
- 손실은 같은 해 안에서만 상계 가능 (이월 불가)
- 한국에는 워시세일 룰 없음 → 손실 실현 후 즉시 재매수 가능
- 국내주식: 대주주(50억 이상) 아니면 양도세 면세
- 금융소득(이자+배당) 연 2,000만 원 초과 시 종합과세 주의
- 미국주식 결제일 T+1, 12월 29일 이후 거래는 다음 해 과세
규칙:
1. 두 분석가 의견 일치 → 강한 확신으로 추천
2. 의견 불일치 → 근거 비교 후 최종 판단
3. 애매하게 말하지 말고 명확하게 "사세요", "파세요", "그대로 두세요"
4. 포지션 사이즈 구체적으로 (몇 주 또는 얼마치)
5. 모든 매도 추천에 세금 영향 명시
6. 손실상계 기회가 있으면 반드시 언급
반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트를 절대 포함하지 마세요. 마크다운 코드블록도 쓰지 마세요.
{"summary":"오늘의 핵심 한 줄","market_outlook":"시장 전망 2-3문장","actions":[{"ticker":"종목코드","name":"종목명","action":"매수|매도|보유|비중축소|비중확대","quantity_or_amount":"10주 또는 100만원어치","reason":"이유","tax_impact":"세금 영향"}],"tax_alert":{"ytd_realized_gain":숫자,"remaining_deduction":숫자,"estimated_annual_tax":숫자,"tax_saving_opportunities":["기회1"]},"risk_level":"안전|보통|주의|위험","next_watch":["내일 주목 이벤트1"]}`;

const TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function parseJsonResponse<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

export interface TaxTrackerState {
  ytd_realized_gain_us: number;
  ytd_realized_loss_us: number;
  ytd_dividend_income: number;
  estimated_tax: number;
}

export async function synthesizeRecommendation(
  conservative: ConservativeAnalysis | null,
  aggressive: AggressiveAnalysis | null,
  marketData: MarketData,
  portfolio: PortfolioHolding[],
  taxTracker: TaxTrackerState
): Promise<LeaderRecommendation> {
  const userContent = `보수적 분석가 의견:\n${JSON.stringify(conservative, null, 2)}\n\n공격적 분석가 의견:\n${JSON.stringify(aggressive, null, 2)}\n\n시장 데이터:\n${JSON.stringify(marketData, null, 2)}\n\n포트폴리오:\n${JSON.stringify(portfolio, null, 2)}\n\n세금 현황:\n${JSON.stringify(taxTracker, null, 2)}`;

  const messages: AIMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  // Leader agent uses the stronger Gemini Pro model
  const geminiProOptions = { model: 'gemini-2.5-pro-preview-05-06', temperature: 0.4 };

  let responseText: string;
  try {
    console.log('[leader-agent] Trying Gemini Pro...');
    const result = await withTimeout(callGemini(messages, geminiProOptions), TIMEOUT_MS, 'Gemini Pro');
    responseText = result.text;
  } catch (err) {
    console.warn('[leader-agent] Gemini Pro failed, trying Groq fallback:', err);
    if (!process.env.GROQ_API_KEY) throw new Error('Leader agent: Gemini failed and no Groq key available');
    const groqResult = await withTimeout(callGroq(messages, { temperature: 0.4 }), TIMEOUT_MS, 'Groq');
    responseText = groqResult.text;
  }

  try {
    return parseJsonResponse<LeaderRecommendation>(responseText);
  } catch {
    console.warn('[leader-agent] JSON parse failed, retrying...');
    const fixMessages: AIMessage[] = [
      ...messages,
      { role: 'user', content: `이전 응답이 유효한 JSON이 아닙니다. 다시 JSON만 출력하세요:\n${responseText}` },
    ];
    const retryResult = await withTimeout(
      callGemini(fixMessages, { ...geminiProOptions, temperature: 0.1 }),
      TIMEOUT_MS,
      'Gemini Pro retry'
    );
    return parseJsonResponse<LeaderRecommendation>(retryResult.text);
  }
}
