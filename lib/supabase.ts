import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fogalhuibozxbilcvuos.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvZ2FsaHVpYm96eGJpbGN2dW9zIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDc5MDIzNCwiZXhwIjoyMDc2MzY2MjM0fQ.Zi5n8ylrfwaYabKd5mgQaicXU4_rlSix1Yy7LEQe1Jc";

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ Missing Supabase env vars, using fallback values");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
