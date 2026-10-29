import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";

// Service role-nøkkelen brukes KUN her, på serveren. `server-only` gjør at
// bygget feiler hvis denne filen noen gang importeres i klientkode.
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getConfig();
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
