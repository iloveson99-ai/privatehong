// Environment variable type definitions
// All variables are set in Vercel dashboard - read from process.env

declare namespace NodeJS {
  interface ProcessEnv {
    // Telegram
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;

    // Supabase
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;

    // Google Gemini
    GEMINI_API_KEY: string;

    // Groq (optional fallback AI)
    GROQ_API_KEY?: string;

    // Finnhub (US stock quotes + news)
    FINNHUB_API_KEY: string;

    // Naver Open API (Korean news search)
    NAVER_CLIENT_ID: string;
    NAVER_CLIENT_SECRET: string;

    // App
    CRON_SECRET: string;
    NEXT_PUBLIC_APP_URL: string;
  }
}
