import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://nlyfngpitxuqtczeqjaw.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_q0e5J5_yWRYl_KHS7U6HhA_zbTpGZdC';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Fetching all patients...');
  const { data: allPatients, error: pErr } = await supabase
    .from('patients')
    .select('*');
  
  if (pErr) {
    console.error('Error fetching patients:', pErr);
    return;
  }
  
  console.log('All patients currently in DB:', allPatients);
  
  const patients = (allPatients || []).filter(p => {
    const name = (p.name || '').toLowerCase();
    const mrn = (p.mrn || '').toLowerCase();
    const id = (p.id || '').toLowerCase();
    return name.includes('amit') || mrn.includes('979190') || id === '4fa22728-306d-4430-88b5-000093ee0c80';
  });
  
  console.log('Patients filtered for deletion:', patients);
  
  if (patients.length > 0) {
    const ids = patients.map(p => p.id);
    console.log('Deleting patient IDs:', ids);
    
    // delete related
    const { error: delInvsErr } = await supabase.from('invoices').delete().in('patient_id', ids);
    console.log('Invoices deletion result:', delInvsErr);
    
    const { error: delPatsErr } = await supabase.from('patients').delete().in('id', ids);
    console.log('Patients deletion result:', delPatsErr);
  } else {
    console.log('No patients matched deletion criteria.');
  }

  // Also search for any invoices named Amit Patel
  const { data: allInvoices, error: iErr } = await supabase.from('invoices').select('*');
  if (!iErr && allInvoices) {
    console.log('All Invoices currently in DB:', allInvoices);
    const invoicesToDelete = allInvoices.filter(i => (i.patient_name || '').toLowerCase().includes('amit'));
    if (invoicesToDelete.length > 0) {
      const invIds = invoicesToDelete.map(i => i.id);
      console.log('Deleting invoice items for:', invIds);
      await supabase.from('invoice_items').delete().in('invoice_id', invIds);
      console.log('Deleting invoices:', invIds);
      await supabase.from('invoices').delete().in('id', invIds);
    }
  }
}

run();

