import { callWithFallback } from '../ai-providers';
import type { AIMessage } from '../ai-providers/types';
import type { MarketData, PortfolioHolding } from '../market-data';
import type { AggressiveAnalysis } from './types';

const SYSTEM_PROMPT = `당신은 공격적 투자 분석가입니다. 수익 극대화를 목표로 합니다.
- 트렌드와 모멘텀을 중시
- 성장주, 테마주에 적극적
- 단기 기회 포착에 집중
- 리스크를 감수하되 근거 있는 배팅
- 시장 심리와 수급 분석

분석 후 반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트를 절대 포함하지 마세요. 마크다운 코드블록도 쓰지 마세요.
{"market_assessment":"...","key_issues":[...],"recommendations":[{"ticker":"...","name":"...","action":"매수|매도|보유|비중축소|비중확대","reason":"...","conviction":"상|중|하"}],"risk_warnings":[...],"cash_ratio_suggestion":"..."}`;

function parseJsonResponse<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

export async function analyzeAggressive(
  marketData: MarketData,
  portfolio: PortfolioHolding[]
): Promise<AggressiveAnalysis> {
  const userContent = `현재 시장 데이터:\n${JSON.stringify(marketData, null, 2)}\n\n보유 포트폴리오:\n${JSON.stringify(portfolio, null, 2)}`;

  const messages: AIMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const response = await callWithFallback(messages, { temperature: 0.7 });

  try {
    return parseJsonResponse<AggressiveAnalysis>(response.text);
  } catch {
    console.warn('[aggressive-agent] JSON parse failed, retrying with format fix request');
    const fixMessages: AIMessage[] = [
      ...messages,
      { role: 'user', content: `이전 응답이 유효한 JSON이 아닙니다. 다시 JSON만 출력하세요:\n${response.text}` },
    ];
    const retryResponse = await callWithFallback(fixMessages, { temperature: 0.1 });
    return parseJsonResponse<AggressiveAnalysis>(retryResponse.text);
  }
}
