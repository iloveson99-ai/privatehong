import { Bot } from 'grammy';

let _bot: Bot | null = null;

export function getBot(): Bot {
  if (!_bot) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }
    _bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
  }
  return _bot;
}

// Export a lazy proxy so callers can do `bot.command(...)` etc.
// The proxy only initialises the real bot on first property access,
// which happens at request time (not at module evaluation / build time).
export const bot: Bot = new Proxy({} as Bot, {
  get(_target, prop: string | symbol) {
    const b = getBot();
    const val = (b as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === 'function') {
      return (val as Function).bind(b);
    }
    return val;
  },
  set(_target, prop: string | symbol, value: unknown) {
    const b = getBot();
    (b as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
});

/**
 * Split text into chunks no larger than maxLen, breaking at newlines.
 */
function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    const addition = current ? '\n' + line : line;
    if ((current + addition).length > maxLen) {
      if (current) chunks.push(current);
      current = line.length > maxLen ? line.substring(0, maxLen) : line;
    } else {
      current += addition;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sendMessage(text: string): Promise<void> {
  const b = getBot();
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await b.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
  }
}

export async function sendTypingAction(): Promise<void> {
  const b = getBot();
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  await b.api.sendChatAction(chatId, 'typing');
}
