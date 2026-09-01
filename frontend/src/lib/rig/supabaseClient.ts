import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Lazily-constructed singleton — one client per browser tab, not one per hook call. */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Add them to frontend/.env — see .env.example.',
    );
  }

  client = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}
