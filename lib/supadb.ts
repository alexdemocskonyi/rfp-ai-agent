import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
export const supa = (url && key) ? createClient(url, key, { auth: { persistSession: false } }) : null;
export const hasSupabase = !!supa;
