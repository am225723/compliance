import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ysdbfpszitsqnvphbpza.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Zbxw642S1aZXf1j0CCdUaA_LHwWRqTe';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
