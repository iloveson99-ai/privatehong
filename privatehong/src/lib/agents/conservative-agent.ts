import { callWithFallback } from '../ai-providers';
import type { AIMessage } from '../ai-providers/types';
import type { MarketData, PortfolioHolding } from '../market-data';
import type { ConservativeAnalysis } from './types';

const SYSTEM_PROMPT = `당신은 보수적 투자 분석가입니다. 원금 보전을 최우선으로 합니다.
- 변동성이 큰 종목은 비중 축소 권고
- 실적 기반의 안정적 종목 선호
- 급등주 추격매수 절대 반대
- 현금 비중 확보를 항상 고려
- 배당주, 가치주 중심

분석 후 반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트를 절대 포함하지 마세요. 마크다운 코드블록도 쓰지 마세요.
{"market_assessment":"오늘 시장 전반 평가 2-3문장","key_issues":["이슈1","이슈2"],"recommendations":[{"ticker":"종목코드","name":"종목명","action":"매수|매도|보유|비중축소|비중확대","reason":"이유 1-2문장","conviction":"상|중|하"}],"risk_warnings":["리스크1"],"cash_ratio_suggestion":"현금비중 %"}`;

function parseJsonResponse<T>(text: string): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

export async function analyzeConservative(
  marketData: MarketData,
  portfolio: PortfolioHolding[]
): Promise<ConservativeAnalysis> {
  const userContent = `현재 시장 데이터:\n${JSON.stringify(marketData, null, 2)}\n\n보유 포트폴리오:\n${JSON.stringify(portfolio, null, 2)}`;

  const messages: AIMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const response = await callWithFallback(messages, { temperature: 0.3 });

  try {
    return parseJsonResponse<ConservativeAnalysis>(response.text);
  } catch {
    // Retry with format correction request
    console.warn('[conservative-agent] JSON parse failed, retrying with format fix request');
    const fixMessages: AIMessage[] = [
      ...messages,
      { role: 'user', content: `이전 응답이 유효한 JSON이 아닙니다. 다시 JSON만 출력하세요:\n${response.text}` },
    ];
    const retryResponse = await callWithFallback(fixMessages, { temperature: 0.1 });
    return parseJsonResponse<ConservativeAnalysis>(retryResponse.text);
  }
}
