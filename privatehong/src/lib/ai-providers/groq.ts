import type { AIMessage, AIResponse, AICallOptions } from './types';

const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';

export async function callGroq(messages: AIMessage[], options: AICallOptions = {}): Promise<AIResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const body = {
    model: options.model ?? DEFAULT_MODEL,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 4096,
  };

  const res = await fetch(GROQ_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Groq API error ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';

  return { text, provider: 'groq' };
}
