// TODO: Supabase client setup
// - Browser client (anon key) for client-side use
// - Server client (service role key) for API routes
// - Types will be added once DB schema is created
//
// Tables to be created:
//   - briefing_logs: store sent briefings (date, content, status)
//   - watchlist: mother's stock watchlist
//   - settings: bot configuration (language, risk tolerance, etc.)

import { createClient } from "@supabase/supabase-js";

// TODO: Export server-side Supabase client
// export const supabaseServer = createClient(
//   process.env.NEXT_PUBLIC_SUPABASE_URL,
//   process.env.SUPABASE_SERVICE_ROLE_KEY
// );

export {};
