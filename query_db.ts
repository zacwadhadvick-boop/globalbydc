import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://nlyfngpitxuqtczeqjaw.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_q0e5J5_yWRYl_KHS7U6HhA_zbTpGZdC';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Fetching hospital_info...');
  const { data: hData, error: hErr } = await supabase.from('hospital_info').select('*').limit(1);
  if (hErr) {
    console.error('hErr:', hErr);
    return;
  }
  console.log('Current row:', hData);
  
  console.log('Fetching patients count...');
  const { data: pData, error: pErr } = await supabase.from('patients').select('id, name, mrn, phone, registration_type, status, created_at');
  if (pErr) console.error('pErr:', pErr);
  else {
    console.log('Patients count in DB:', pData?.length);
    console.log('Patients in DB:', JSON.stringify(pData, null, 2));
  }

  console.log('Fetching invoices count...');
  const { data: iData, error: iErr } = await supabase.from('invoices').select('*');
  if (iErr) console.error('iErr:', iErr);
  else console.log('Invoices count in DB:', iData?.length);
}

run();
