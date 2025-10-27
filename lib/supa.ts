import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseAdmin(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!/^https?:\/\//i.test(url)) throw new Error("supabaseUrl is required.");
  if (!key) throw new Error("supabaseKey is required.");

  return createClient(url, key, { auth: { persistSession: false } });
}
