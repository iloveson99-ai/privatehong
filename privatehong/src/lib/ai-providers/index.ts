import { callGemini } from './gemini';
import { callGroq } from './groq';
import type { AIMessage, AIResponse, AICallOptions } from './types';

export type { AIMessage, AIResponse, AICallOptions };

const TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function callWithFallback(
  messages: AIMessage[],
  options: AICallOptions = {}
): Promise<AIResponse> {
  // 1. Try Gemini
  try {
    console.log('[ai-providers] Trying Gemini...');
    const result = await withTimeout(callGemini(messages, options), TIMEOUT_MS, 'Gemini');
    console.log('[ai-providers] Gemini succeeded');
    return result;
  } catch (err) {
    console.warn('[ai-providers] Gemini failed:', err);
  }

  // 2. Try Groq (only if key exists)
  if (process.env.GROQ_API_KEY) {
    try {
      console.log('[ai-providers] Trying Groq...');
      const groqOptions: AICallOptions = {
        ...options,
        model: undefined, // use Groq default model
      };
      const result = await withTimeout(callGroq(messages, groqOptions), TIMEOUT_MS, 'Groq');
      console.log('[ai-providers] Groq succeeded');
      return result;
    } catch (err) {
      console.warn('[ai-providers] Groq failed:', err);
    }
  }

  throw new Error('All AI providers failed. No response available.');
}
