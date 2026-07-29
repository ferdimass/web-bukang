import { createClient } from '@supabase/supabase-js';

let rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
let rawKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

if (!rawUrl || rawUrl.includes('placeholder')) {
  rawUrl = 'https://placeholder.supabase.co';
} else {
  // Ensure protocol is included if user pasted domain only (e.g. xyz.supabase.co)
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    rawUrl = `https://${rawUrl}`;
  }
}

// Strip trailing slashes
const supabaseUrl = rawUrl.replace(/\/+$/, '');
const supabaseAnonKey = rawKey || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
