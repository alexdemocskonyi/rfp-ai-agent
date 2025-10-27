import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser-only client (no auth state persisted)
export const supaBrowser = createClient(url, anon, { auth: { persistSession: false } });
