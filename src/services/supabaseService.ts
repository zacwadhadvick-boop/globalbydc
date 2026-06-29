import { supabase, broadcastDataMutation, isSupabaseConfigured } from '../lib/supabase';
import { toast } from 'sonner';
import { storage, STORAGE_KEYS } from '../lib/storage';
import { DEFAULT_PHARMACY_SETTINGS } from '../lib/pharmacyInvoicePrint';
import { 
  MOCK_PRESCRIPTIONS, 
  MOCK_NURSE_SHIFTS, 
  MOCK_THEATRES,
  MOCK_PATIENTS,
  MOCK_BEDS,
  MOCK_APPOINTMENTS,
  MOCK_BILLING,
  MOCK_INVENTORY,
  MOCK_OPERATION_RECORDS,
  MOCK_NURSING_TASKS,
  MOCK_PATIENT_VITALS,
  MOCK_LAB_TESTS,
  MOCK_USERS
} from '../mockData';

// --- UUID VALIDATION AND CLEANING HELPERS ---
function sanitizeUuid(val: any): any {
  if (typeof val !== 'string') return val;
  let valStr = val.trim();
  if (valStr.length === 36 && (valStr.match(/-/g) || []).length === 5) {
    valStr = valStr.replace(/(\-[0-9a-f]{3})\-([0-9a-f]{8})$/i, '$1$2');
  }
  return valStr;
}

function isUuid(val: any): boolean {
  if (typeof val !== 'string') return false;
  const sanitized = sanitizeUuid(val);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sanitized);
}

function toDeterministicUuid(val: any): string {
  if (!val) return val;
  let valStr = String(val).trim();
  valStr = sanitizeUuid(valStr);
  if (isUuid(valStr)) return valStr;

  // Custom mapping for mock/standard prefixes
  if (/^p\d+$/i.test(valStr)) {
    const num = valStr.substring(1);
    return `00000000-0000-4000-a000-${num.padStart(12, '0')}`;
  }
  if (/^u\d+$/i.test(valStr)) {
    const num = valStr.substring(1);
    return `00000000-0000-4000-b000-${num.padStart(12, '0')}`;
  }
  if (/^b\d+$/i.test(valStr)) {
    const num = valStr.substring(1);
    return `00000000-0000-4000-c000-${num.padStart(12, '0')}`;
  }
  if (/^bill\d+$/i.test(valStr)) {
    const num = valStr.substring(4);
    return `00000000-0000-4000-d000-${num.padStart(12, '0')}`;
  }
  if (/^rx\d+$/i.test(valStr)) {
    const num = valStr.substring(2);
    return `00000000-0000-4000-e000-${num.padStart(12, '0')}`;
  }

  // General fallback for UUID v4 style deterministic mapping of other random strings (e.g. 'off-pat-...')
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < valStr.length; i++) {
    const ch = valStr.charCodeAt(i);
    hash1 = (hash1 * 31 + ch) | 0;
    hash2 = (hash2 * 37 + ch) | 0;
  }
  const hex1 = (Math.abs(hash1) >>> 0).toString(16).padStart(8, '0');
  const hex2 = (Math.abs(hash2) >>> 0).toString(16).padStart(8, '0');
  const hex3 = ((Math.abs(hash1 ^ hash2) & 0xffff) >>> 0).toString(16).padStart(4, '0');
  const hex4 = ((Math.abs(hash1 + hash2) & 0xffff) >>> 0).toString(16).padStart(4, '0');
  const hex5 = ((Math.abs(hash1 * hash2) & 0xffffffff) >>> 0).toString(16).padStart(12, '0');

  return `${hex1.slice(0, 8)}-${hex2.slice(0, 4)}-4${hex3.slice(0, 3)}-8${hex4.slice(0, 3)}-${hex5.slice(0, 12)}`;
}

function cleanUuidFields(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;
  const cleaned = { ...payload };
  const fields = [
    'doctor_id', 'nurse_id', 'issued_by', 'recorded_by', 'author_id',
    'surgeon_id', 'anesthetist_id', 'user_id', 'requested_by', 'performed_by',
    'head_id', 'incoming_nurse_id', 'outgoing_nurse_id', 'patient_id',
    'id', 'invoice_id', 'item_id', 'bed_id', 'admission_id', 'test_id', 'group_id', 'mother_id',
    'attending_doctor_id', 'created_by'
  ];
  for (const field of fields) {
    if (field in cleaned) {
      const val = cleaned[field];
      if (val !== undefined && val !== null && val !== '') {
        const sanitized = sanitizeUuid(val);
        if (isUuid(sanitized)) {
          cleaned[field] = sanitized;
        } else {
          cleaned[field] = toDeterministicUuid(sanitized);
        }
      }
    }
  }
  return cleaned;
}

async function ensurePatientExistsInDb(patientId: string): Promise<boolean> {
  if (!patientId) return false;
  try {
    const cleanId = isUuid(patientId) ? patientId : toDeterministicUuid(patientId);
    
    // Check if the patient already exists in the database
    console.log("[Supabase Request] ensurePatientExistsInDb - Checking existence for cleanId:", cleanId);
    const { data, error } = await supabase
      .from('patients')
      .select('id')
      .eq('id', cleanId)
      .maybeSingle();
      
    console.log("[Supabase Response] ensurePatientExistsInDb - Check data:", data, "Check error:", error);
    if (data && data.id) {
      return true; // Already exists!
    }
    
    // If not, fetch details from local storage or mock data to insert a record
    const localPatients = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS) || [];
    const patientData = localPatients.find((p: any) => 
      p.id === patientId || 
      p.id === cleanId || 
      toDeterministicUuid(p.id) === cleanId
    );
    
    const dbPat = cleanPatientForPostgres(patientData || {
      id: cleanId,
      name: 'Amit Patel',
      gender: 'Male',
      age: 28,
      phone: '9876543210',
      address: 'B-42, Sector 15, Noida',
      blood_group: 'A+',
      bloodGroup: 'A+',
      status: 'Active'
    });
    
    // Ensure the ID matches the correct clean UUID
    dbPat.id = cleanId;
    if (!dbPat.mrn) {
      dbPat.mrn = 'MRN-' + Math.floor(100000 + Math.random() * 900000);
    }
    
    console.log("[Supabase Request] ensurePatientExistsInDb - Inserting new patient dynamically:", dbPat);
    const { error: insertError } = await supabase
      .from('patients')
      .insert([dbPat]);
      
    console.log("[Supabase Response] ensurePatientExistsInDb - Insert error:", insertError);
    if (insertError) {
      console.warn('Silent warning: failed to dynamically register referenced patient in DB:', insertError.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('Error inside ensurePatientExistsInDb:', err.message || err);
    return false;
  }
}

async function ensureProfileExistsInDb(profileId: string): Promise<string | null> {
  if (!profileId) return null;
  try {
    const cleanId = isUuid(profileId) ? profileId : toDeterministicUuid(profileId);
    
    // Check if the profile already exists in the database
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', cleanId)
      .maybeSingle();
      
    if (data && data.id) {
      return cleanId; // Already exists!
    }
    
    // If not, fetch details from local storage or mock data to insert a record
    const localUsers = (storage.get(STORAGE_KEYS.USERS, MOCK_USERS) || []) as any[];
    const userData = localUsers.find((u: any) => 
      u.id === profileId || 
      u.id === cleanId || 
      toDeterministicUuid(u.id) === cleanId
    ) as any;
    
    // Get default role or fallback role
    let role: string = userData?.role || 'ACCOUNTANT';
    const r = role.toUpperCase().trim();
    if (r === 'RECEPTION' || r === 'RECEPTION_STAFF') {
      role = 'RECEPTIONIST';
    } else if (r === 'LAB_STAFF' || r === 'LAB_STAFF_MEMBER') {
      role = 'LAB_TECHNICIAN';
    } else if (r === 'ACCOUNTS') {
      role = 'ACCOUNTANT';
    } else if (!['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'SURGEON', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECHNICIAN', 'PHARMACIST'].includes(r)) {
      role = 'ACCOUNTANT'; // default fallback
    } else {
      role = r;
    }

    const dbProfile = {
      id: cleanId,
      name: userData?.name || 'Accounts Manager',
      email: userData?.email || `${cleanId.slice(0, 8)}@globalhospital.com`,
      role: role,
      phone: userData?.phone || '+91 9999999999',
      department: userData?.department || 'Accounts',
      designation: userData?.designation || 'Accountant'
    };
    
    // Insert into profiles
    const { error: insertError } = await supabase
      .from('profiles')
      .insert([dbProfile]);
      
    if (insertError) {
      console.warn('Error inserting profile in ensureProfileExistsInDb:', insertError.message);
      
      // Fallback: fetch any existing profile from the database to avoid foreign key violations
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('id')
        .limit(1);
        
      if (existingProfiles && existingProfiles.length > 0) {
        console.log('Falling back to existing profile ID:', existingProfiles[0].id);
        return existingProfiles[0].id;
      }
      return null;
    }
    return cleanId;
  } catch (error: any) {
    console.error('Error in ensureProfileExistsInDb:', error.message);
    return null;
  }
}

async function ensureForeignKeysExist(payload: any) {
  if (!payload || typeof payload !== 'object') return;
  
  // 1. Ensure Patient exists
  if (payload.patient_id) {
    await ensurePatientExistsInDb(payload.patient_id);
  }
  
  // 2. Ensure Profile exists
  const profileFields = [
    'doctor_id', 'nurse_id', 'issued_by', 'recorded_by', 'author_id',
    'surgeon_id', 'anesthetist_id', 'user_id', 'requested_by', 'performed_by',
    'head_id', 'incoming_nurse_id', 'outgoing_nurse_id'
  ];
  
  for (const field of profileFields) {
    if (payload[field]) {
      const actualId = await ensureProfileExistsInDb(payload[field]);
      if (actualId && actualId !== payload[field]) {
        console.log(`Mapping payload field ${field} from ${payload[field]} to existing profile ${actualId}`);
        payload[field] = actualId;
      }
    }
  }
}

// --- SCHEMA NORMALIZATION HELPERS ---
function cleanAppointmentForPostgres(apt: any) {
  if (!apt) return apt;
  const cleaned = { ...apt };
  
  let urgencyVal = cleaned.urgency || 'Routine';
  
  // Encode 'type' inside 'urgency' if type is specified and not the standard OPD/General
  if (cleaned.type && cleaned.type !== 'OPD') {
    urgencyVal = `${urgencyVal} [${cleaned.type}]`;
  }

  // Encode doctor name inside 'urgency' to survive fallback/lack of UUID matches
  const docName = cleaned.doctor || cleaned.doctorName || cleaned.doctor_name;
  if (docName) {
    const safeDocName = String(docName).replace(/[\[\]]/g, '');
    urgencyVal = `${urgencyVal} [doc:${safeDocName}]`;
  }

  // Encode discount amount
  const discAmt = cleaned.discount_amount !== undefined ? cleaned.discount_amount : cleaned.discountAmount;
  if (discAmt !== undefined && discAmt !== null && Number(discAmt) > 0) {
    urgencyVal = `${urgencyVal} [disc:${Number(discAmt)}]`;
  }

  // Encode discount given by
  const discBy = cleaned.discount_given_by !== undefined ? cleaned.discount_given_by : cleaned.discountGivenBy;
  if (discBy) {
    const safeDiscBy = String(discBy).replace(/[\[\]]/g, '');
    urgencyVal = `${urgencyVal} [discby:${safeDiscBy}]`;
  }

  // Encode refund given by
  const refBy = cleaned.refund_given_by !== undefined ? cleaned.refund_given_by : cleaned.refundGivenBy;
  if (refBy) {
    const safeRefBy = String(refBy).replace(/[\[\]]/g, '');
    urgencyVal = `${urgencyVal} [refby:${safeRefBy}]`;
  }

  cleaned.urgency = urgencyVal;
  
  // list of actual columns in supabase_schema.sql
  const validColumns = [
    'id', 'patient_id', 'doctor_id', 'appointment_date', 'appointment_time',
    'token_number', 'urgency', 'status', 'fee', 'payment_status', 'created_at', 'updated_at'
  ];
  const result: any = {};
  for (const col of validColumns) {
    if (col in cleaned) {
      result[col] = cleaned[col];
    }
  }
  return cleanUuidFields(result);
}

function mapAppointmentFromPostgres(apt: any) {
  if (!apt) return apt;
  const mapped = { ...apt };
  let type = 'OPD';
  let urgency = apt.urgency || 'Routine';
  let doctorNameParsed = '';
  let discountAmountParsed = 0;
  let discountGivenByParsed = '';
  let refundGivenByParsed = '';

  // Parse [doc:...]
  if (urgency.includes('[doc:')) {
    const docParts = urgency.split('[doc:');
    if (docParts.length > 1) {
      const docSubParts = docParts[1].split(']');
      if (docSubParts.length > 0) {
        doctorNameParsed = docSubParts[0].trim();
      }
    }
    urgency = urgency.replace(/\[doc:.*?\]/g, '').trim();
  }

  // Parse [disc:...]
  if (urgency.includes('[disc:')) {
    const discParts = urgency.split('[disc:');
    if (discParts.length > 1) {
      const discSubParts = discParts[1].split(']');
      if (discSubParts.length > 0) {
        discountAmountParsed = Number(discSubParts[0].trim()) || 0;
      }
    }
    urgency = urgency.replace(/\[disc:.*?\]/g, '').trim();
  }

  // Parse [discby:...]
  if (urgency.includes('[discby:')) {
    const discbyParts = urgency.split('[discby:');
    if (discbyParts.length > 1) {
      const discbySubParts = discbyParts[1].split(']');
      if (discbySubParts.length > 0) {
        discountGivenByParsed = discbySubParts[0].trim();
      }
    }
    urgency = urgency.replace(/\[discby:.*?\]/g, '').trim();
  }

  // Parse [refby:...]
  if (urgency.includes('[refby:')) {
    const refbyParts = urgency.split('[refby:');
    if (refbyParts.length > 1) {
      const refbySubParts = refbyParts[1].split(']');
      if (refbySubParts.length > 0) {
        refundGivenByParsed = refbySubParts[0].trim();
      }
    }
    urgency = urgency.replace(/\[refby:.*?\]/g, '').trim();
  }

  // Parse [type]
  if (urgency.includes('[') && urgency.includes(']')) {
    const parts = urgency.split('[');
    urgency = parts[0].trim();
    type = parts[1].replace(']', '').trim();
  }
  mapped.type = type;
  mapped.urgency = urgency;

  mapped.discount_amount = discountAmountParsed;
  mapped.discountAmount = discountAmountParsed;
  
  if (discountGivenByParsed) {
    mapped.discount_given_by = discountGivenByParsed;
    mapped.discountGivenBy = discountGivenByParsed;
  }
  
  if (refundGivenByParsed) {
    mapped.refund_given_by = refundGivenByParsed;
    mapped.refundGivenBy = refundGivenByParsed;
  }

  if (doctorNameParsed) {
    mapped.doctor = doctorNameParsed;
    mapped.doctorName = doctorNameParsed;
  }

  const docId = mapped.doctor_id || mapped.doctorId;
  if (docId) {
    const usersList = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
    const doc = usersList.find((u: any) => u.id === docId);
    if (doc) {
      mapped.doctor = doc.name;
      mapped.doctorName = doc.name;
    }
  }

  if (!mapped.patients) {
    const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
    const pid = mapped.patient_id || mapped.patientId;
    const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === pid);
    if (p) {
      mapped.patients = { name: p.name, mrn: p.mrn, age: p.age, gender: p.gender };
    }
  }
  return mapped;
}

function cleanPatientForPostgres(p: any) {
  if (!p) return p;
  const cleaned = { ...p };
  
  if (cleaned.bloodGroup !== undefined) cleaned.blood_group = cleaned.bloodGroup;
  if (cleaned.guardianName !== undefined) cleaned.guardian_name = cleaned.guardianName;
  if (cleaned.fatherName !== undefined) cleaned.father_name = cleaned.fatherName;
  if (cleaned.fatherPhone !== undefined) cleaned.father_phone = cleaned.fatherPhone;
  if (cleaned.motherName !== undefined) cleaned.mother_name = cleaned.motherName;
  if (cleaned.motherPhone !== undefined) cleaned.mother_phone = cleaned.motherPhone;
  if (cleaned.husbandName !== undefined) cleaned.husband_name = cleaned.husbandName;
  if (cleaned.husbandPhone !== undefined) cleaned.husband_phone = cleaned.husbandPhone;
  if (cleaned.tpaId !== undefined) cleaned.tpa_id = cleaned.tpaId;
  if (cleaned.tpaValidity !== undefined) cleaned.tpa_validity = cleaned.tpaValidity;
  if (cleaned.needsAdmission !== undefined) cleaned.needs_admission = cleaned.needsAdmission;
  if (cleaned.registrationType !== undefined) cleaned.registration_type = cleaned.registrationType;
  if (cleaned.attendingDoctorId !== undefined) cleaned.attending_doctor_id = cleaned.attendingDoctorId;
  if (cleaned.attending_doctor_id !== undefined) cleaned.attending_doctor_id = cleaned.attending_doctor_id;

  const validColumns = [
    'id', 'mrn', 'name', 'phone', 'email', 'dob', 'age', 'gender', 'blood_group',
    'address', 'guardian_name', 'mother_name', 'mother_phone', 'father_name', 'father_phone',
    'husband_name', 'husband_phone', 'tpa_id', 'tpa_validity', 'status',
    'registration_type', 'needs_admission', 'attending_doctor_id', 'created_at', 'updated_at'
  ];
  
  const result: any = {};
  for (const col of validColumns) {
    if (cleaned[col] !== undefined) {
      result[col] = cleaned[col];
    }
  }
  return cleanUuidFields(result);
}

function cleanAdmissionForPostgres(ad: any) {
  if (!ad) return ad;
  const cleaned = { ...ad };
  
  if (cleaned.patientId !== undefined) cleaned.patient_id = cleaned.patientId;
  if (cleaned.bedId !== undefined) cleaned.bed_id = cleaned.bedId;
  if (cleaned.doctorId !== undefined) cleaned.doctor_id = cleaned.doctorId;
  if (cleaned.admissionDate !== undefined) cleaned.admission_date = cleaned.admissionDate;
  if (cleaned.dischargeDate !== undefined) cleaned.discharge_date = cleaned.dischargeDate;
  if (cleaned.initialDeposit !== undefined) cleaned.initial_deposit = cleaned.initialDeposit;

  const validColumns = [
    'id', 'patient_id', 'bed_id', 'doctor_id', 'admission_date', 'discharge_date',
    'reason', 'initial_deposit', 'status', 'created_at'
  ];
  const result: any = {};
  for (const col of validColumns) {
    if (cleaned[col] !== undefined) {
      result[col] = cleaned[col];
    }
  }
  return cleanUuidFields(result);
}

function cleanInvoiceForPostgres(inv: any) {
  if (!inv) return inv;
  const cleaned = { ...inv };
  
  // auto generate unique invoice number if missing
  if (!cleaned.invoice_number) {
    cleaned.invoice_number = `INV-POS-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  
  // map legacy / fallback names to supabase schema names
  if ('status' in cleaned && !('payment_status' in cleaned)) {
    cleaned.payment_status = cleaned.status;
  }
  if ('created_by' in cleaned && !('issued_by' in cleaned)) {
    cleaned.issued_by = cleaned.created_by;
  }
  
  // calculate payable_amount if missing
  if (!('payable_amount' in cleaned)) {
    const total = Number(cleaned.total_amount) || 0;
    const discount = Number(cleaned.discount_amount) || 0;
    const tax = Number(cleaned.tax_amount) || 0;
    cleaned.payable_amount = (total - discount) + tax;
  }
  
  // list of actual columns in supabase_schema.sql
  const validColumns = [
    'id', 'patient_id', 'invoice_number', 'total_amount', 'discount_amount',
    'tax_amount', 'payable_amount', 'paid_amount', 'payment_status', 'payment_method',
    'tpa_approval_status', 'issued_by', 'created_at', 'updated_at'
  ];
  
  const result: any = {};
  for (const col of validColumns) {
    if (col in cleaned) {
      result[col] = cleaned[col];
    }
  }
  return cleanUuidFields(result);
}

function mapInvoiceFromPostgres(inv: any) {
  if (!inv) return inv;
  
  // Normalize items/invoice_items
  let items = inv.invoice_items || inv.items || [];
  if (inv.invoice_items && Array.isArray(inv.invoice_items)) {
    items = inv.invoice_items.map(mapInvoiceItemFromPostgres);
  } else if (inv.items && Array.isArray(inv.items)) {
    items = inv.items.map(mapInvoiceItemFromPostgres);
  }

  const amt = Number(inv.total_amount ?? inv.totalAmount ?? inv.total ?? 0);
  const disc = Number(inv.discount_amount ?? inv.discountAmount ?? inv.discount ?? 0);
  const pay = Number(inv.payable_amount ?? inv.payableAmount ?? (amt - disc));
  const paid = Number(inv.paid_amount ?? inv.paidAmount ?? 0);
  const pStatus = inv.payment_status || inv.paymentStatus || inv.status || 'Unpaid';
  const pMethod = inv.payment_method || inv.paymentMethod || inv.paymentMode || 'Cash';
  const iNum = inv.invoice_number || inv.invoiceNumber || inv.id || '';
  const iType = inv.type || inv.invoice_type || 'Independent';

  const mapped = {
    ...inv,
    invoice_items: items,
    items: items,
    total_amount: amt,
    totalAmount: amt,
    discount_amount: disc,
    discountAmount: disc,
    payable_amount: pay,
    payableAmount: pay,
    paid_amount: paid,
    paidAmount: paid,
    payment_status: pStatus,
    paymentStatus: pStatus,
    status: pStatus,
    payment_method: pMethod,
    paymentMethod: pMethod,
    paymentMode: pMethod,
    invoice_number: iNum,
    invoiceNumber: iNum,
    type: iType,
    invoice_type: iType,
    created_by: inv.issued_by || inv.created_by || inv.createdBy,
    patient_id: inv.patient_id || inv.patientId,
    patientId: inv.patient_id || inv.patientId
  };

  if (!mapped.patients) {
    const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
    const pid = mapped.patient_id || mapped.patientId;
    const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === p_item.id || p_item.mrn === pid);
    if (p) {
      mapped.patients = { name: p.name, mrn: p.mrn, phone: p.phone, email: p.email };
    }
  }
  return mapped;
}

function cleanInvoiceItemForPostgres(item: any) {
  if (!item) return item;
  const cleaned = { ...item };
  
  // map legacy / fallback names to supabase schema names
  if ('item_name' in cleaned && !('description' in cleaned)) {
    cleaned.description = cleaned.item_name;
  }
  if ('item_type' in cleaned && !('category' in cleaned)) {
    cleaned.category = cleaned.item_type;
  }
  
  // list of actual columns in supabase_schema.sql
  const validColumns = [
    'id', 'invoice_id', 'description', 'quantity', 'unit_price', 'total_price',
    'tax_percentage', 'category', 'source_type', 'source_id'
  ];
  
  const result: any = {};
  for (const col of validColumns) {
    if (col in cleaned) {
      result[col] = cleaned[col];
    }
  }
  return cleanUuidFields(result);
}

function mapInvoiceItemFromPostgres(item: any) {
  if (!item) return item;
  const desc = item.description || item.item_name || '';
  const cat = item.category || item.item_type || '';
  const price = Number(item.amount || item.total_price || item.unit_price || 0);
  const qty = Number(item.quantity || 1);
  return {
    ...item,
    item_name: desc,
    description: desc,
    item_type: cat,
    category: cat,
    amount: price,
    total_price: price,
    totalPrice: price,
    unit_price: price / qty,
    unitPrice: price / qty,
    quantity: qty
  };
}

function cleanPharmacyItemForPostgres(item: any) {
  if (!item) return item;
  const cleaned = { ...item };

  if ('stock' in cleaned && !('stock_quantity' in cleaned)) {
    cleaned.stock_quantity = cleaned.stock;
  }
  if ('stock_quantity' in cleaned && !('stock' in cleaned)) {
    cleaned.stock = cleaned.stock_quantity;
  }

  if ('selling_price' in cleaned && !('sale_price' in cleaned)) {
    cleaned.sale_price = cleaned.selling_price;
  }
  if ('sale_price' in cleaned && !('selling_price' in cleaned)) {
    cleaned.selling_price = cleaned.sale_price;
  }

  if ('min_stock_level' in cleaned && !('reorder_level' in cleaned)) {
    cleaned.reorder_level = cleaned.min_stock_level;
  }
  if ('reorder_level' in cleaned && !('min_stock_level' in cleaned)) {
    cleaned.min_stock_level = cleaned.reorder_level;
  }

  return cleanUuidFields(cleaned);
}

function mapPharmacyItemFromPostgres(item: any) {
  if (!item) return item;
  
  // Try to enrich with locally saved loose sale properties if they exist
  let is_loose_sale_enabled = item.is_loose_sale_enabled !== undefined ? item.is_loose_sale_enabled : (item.isLooseSaleEnabled !== undefined ? item.isLooseSaleEnabled : undefined);
  let units_per_strip = item.units_per_strip !== undefined ? item.units_per_strip : (item.unitsPerStrip !== undefined ? item.unitsPerStrip : undefined);
  let loose_selling_price = item.loose_selling_price !== undefined ? item.loose_selling_price : (item.looseSellingPrice !== undefined ? item.looseSellingPrice : undefined);
  let loose_stock = item.loose_stock !== undefined ? item.loose_stock : (item.looseStock !== undefined ? item.looseStock : undefined);
  
  try {
    const key = `loose_config_${item.id || item.name}`;
    const localConfigStr = localStorage.getItem(key);
    if (localConfigStr) {
      const localConfig = JSON.parse(localConfigStr);
      if (is_loose_sale_enabled === undefined && localConfig.is_loose_sale_enabled !== undefined) {
        is_loose_sale_enabled = localConfig.is_loose_sale_enabled;
      }
      if (units_per_strip === undefined && localConfig.units_per_strip !== undefined) {
        units_per_strip = localConfig.units_per_strip;
      }
      if (loose_selling_price === undefined && localConfig.loose_selling_price !== undefined) {
        loose_selling_price = localConfig.loose_selling_price;
      }
      if (loose_stock === undefined && localConfig.loose_stock !== undefined) {
        loose_stock = localConfig.loose_stock;
      }
    }
  } catch (e) {
    console.warn("Error restoring local loose sale config", e);
  }

  const selling_price = item.selling_price !== undefined ? item.selling_price : (item.sellingPrice !== undefined ? item.sellingPrice : (item.sale_price !== undefined ? item.sale_price : 0));
  const purchase_price = item.purchase_price !== undefined ? item.purchase_price : (item.purchasePrice !== undefined ? item.purchasePrice : 0);
  const min_stock_level = item.min_stock_level !== undefined ? item.min_stock_level : (item.minStockLevel !== undefined ? item.minStockLevel : (item.reorder_level !== undefined ? item.reorder_level : 10));
  const reorder_level = item.reorder_level !== undefined ? item.reorder_level : (item.min_stock_level !== undefined ? item.min_stock_level : 10);
  const expiry_date = item.expiry_date !== undefined ? item.expiry_date : (item.expiryDate !== undefined ? item.expiryDate : '');
  const batch_number = item.batch_number !== undefined ? item.batch_number : (item.batchNumber !== undefined ? item.batchNumber : '');
  const tax_percentage = item.tax_percentage !== undefined ? item.tax_percentage : (item.taxPercentage !== undefined ? item.taxPercentage : 0);
  const hsn_code = item.hsn_code !== undefined ? item.hsn_code : (item.hsnCode !== undefined ? item.hsnCode : '');
  const rack_number = item.rack_number !== undefined ? item.rack_number : (item.rackNumber !== undefined ? item.rackNumber : '');

  return {
    ...item,
    stock: item.stock !== undefined ? item.stock : (item.stock_quantity !== undefined ? item.stock_quantity : 0),
    stock_quantity: item.stock_quantity !== undefined ? item.stock_quantity : (item.stock !== undefined ? item.stock : 0),
    selling_price,
    sellingPrice: selling_price,
    purchase_price,
    purchasePrice: purchase_price,
    min_stock_level,
    minStockLevel: min_stock_level,
    reorder_level,
    expiry_date,
    expiryDate: expiry_date,
    batch_number,
    batchNumber: batch_number,
    tax_percentage,
    taxPercentage: tax_percentage,
    hsn_code,
    hsnCode: hsn_code,
    rack_number,
    rackNumber: rack_number,
    is_loose_sale_enabled: is_loose_sale_enabled !== undefined ? is_loose_sale_enabled : false,
    isLooseSaleEnabled: is_loose_sale_enabled !== undefined ? is_loose_sale_enabled : false,
    units_per_strip: units_per_strip !== undefined ? units_per_strip : 10,
    unitsPerStrip: units_per_strip !== undefined ? units_per_strip : 10,
    loose_selling_price: loose_selling_price !== undefined ? loose_selling_price : 0,
    looseSellingPrice: loose_selling_price !== undefined ? loose_selling_price : 0,
    loose_stock: loose_stock !== undefined ? loose_stock : 0,
    looseStock: loose_stock !== undefined ? loose_stock : 0
  };
}

function mapOTScheduleFromPostgres(row: any) {
  if (!row) return row;
  const patientId = row.patientId || row.patient_id;
  const theatreId = row.theatreId || row.room_id || row.ot_rooms_id;
  const surgeonId = row.surgeonId || row.surgeon_id;
  const operationName = row.operationName || row.operation_name || row.procedure_name || '';
  const date = row.date || row.scheduled_date || row.surgery_date;
  const startTime = row.startTime || row.start_time || row.scheduled_time || row.surgery_time;
  
  return {
    ...row,
    patientId,
    patient_id: patientId,
    theatreId,
    room_id: theatreId,
    ot_rooms_id: theatreId,
    theatre_id: theatreId,
    surgeonId,
    surgeon_id: surgeonId,
    operationName,
    operation_name: operationName,
    procedure_name: operationName,
    date,
    scheduled_date: date,
    surgery_date: date,
    startTime,
    start_time: startTime,
    scheduled_time: startTime,
    surgery_time: startTime,
    status: row.status || 'Scheduled',
    notes: row.notes || '',
    documents: row.documents || []
  };
}

function cleanOTScheduleForPostgres(sch: any) {
  if (!sch) return sch;
  const dateVal = sch.date || sch.scheduled_date || sch.surgery_date || null;
  const timeVal = sch.time || sch.startTime || sch.scheduled_time || sch.surgery_time || null;
  const theatreVal = sch.theatreId || sch.room_id || sch.ot_rooms_id || null;
  const nameVal = sch.operationName || sch.operation_name || sch.procedure_name || null;
  return cleanUuidFields({
    patient_id: sch.patientId || sch.patient_id,
    room_id: theatreVal,
    ot_rooms_id: theatreVal,
    surgeon_id: sch.surgeonId || sch.surgeon_id || null,
    operation_name: nameVal,
    procedure_name: nameVal,
    scheduled_date: dateVal,
    surgery_date: dateVal,
    scheduled_time: timeVal,
    surgery_time: timeVal,
    status: sch.status || 'Scheduled',
    notes: sch.notes || null
  });
}

function cleanVitalsForPostgres(vitals: any) {
  if (!vitals) return vitals;
  const cleaned = { ...vitals };
  
  if ('patientId' in cleaned && !('patient_id' in cleaned)) {
    cleaned.patient_id = cleaned.patientId;
  }
  
  if ('bp' in cleaned && !('blood_pressure' in cleaned)) {
    cleaned.blood_pressure = cleaned.bp;
  }
  if ('blood_pressure' in cleaned && !('bp' in cleaned)) {
    cleaned.bp = cleaned.blood_pressure;
  }
  
  let tempVal = cleaned.temp !== undefined ? cleaned.temp : cleaned.temperature;
  if (tempVal !== undefined && tempVal !== '') {
    if (typeof tempVal === 'string') {
      const numericMatch = tempVal.match(/[\d.]+/);
      if (numericMatch) {
        tempVal = parseFloat(numericMatch[0]);
      } else {
        tempVal = parseFloat(tempVal) || null;
      }
    }
    cleaned.temperature = tempVal;
    cleaned.temp = tempVal;
  }

  if ('pulse' in cleaned && cleaned.pulse !== '' && cleaned.pulse !== null && cleaned.pulse !== undefined) {
    cleaned.pulse = parseInt(cleaned.pulse, 10);
  }

  let rrVal = cleaned.respiration !== undefined ? cleaned.respiration : cleaned.rr;
  if (rrVal !== undefined && rrVal !== '' && rrVal !== null) {
    rrVal = parseInt(rrVal, 10);
    cleaned.respiration = rrVal;
    cleaned.rr = rrVal;
  }

  if ('spo2' in cleaned && cleaned.spo2 !== '' && cleaned.spo2 !== null && cleaned.spo2 !== undefined) {
    cleaned.spo2 = parseInt(cleaned.spo2, 10);
  }
  if ('weight' in cleaned && cleaned.weight !== '' && cleaned.weight !== null && cleaned.weight !== undefined) {
    cleaned.weight = parseFloat(cleaned.weight);
  }

  if ('timestamp' in cleaned && !('recorded_at' in cleaned)) {
    cleaned.recorded_at = cleaned.timestamp;
  }
  if ('lastUpdated' in cleaned && !('recorded_at' in cleaned)) {
    cleaned.recorded_at = cleaned.lastUpdated;
  }

  const validColumns = [
    'id', 'patient_id', 'recorded_by', 'temperature', 'temp', 'blood_pressure', 'bp',
    'pulse', 'respiration', 'rr', 'spo2', 'weight', 'recorded_at', 'updated_at'
  ];

  const result: any = {};
  for (const col of validColumns) {
    if (col in cleaned && cleaned[col] !== undefined) {
      result[col] = cleaned[col];
    }
  }
  return cleanUuidFields(result);
}

function mapVitalsFromPostgres(vitals: any) {
  if (!vitals) return vitals;
  let tempString = '';
  const tempVal = vitals.temperature !== null && vitals.temperature !== undefined 
    ? vitals.temperature 
    : vitals.temp;
  if (tempVal !== null && tempVal !== undefined) {
    tempString = String(tempVal);
  }
  
  const mapped = {
    ...vitals,
    patientId: vitals.patient_id,
    bp: vitals.blood_pressure || vitals.bp || '',
    pulse: vitals.pulse || 0,
    temp: tempString,
    spo2: vitals.spo2 || 0,
    rr: vitals.respiration !== null && vitals.respiration !== undefined ? vitals.respiration : (vitals.rr || 0),
    respiration: vitals.respiration !== null && vitals.respiration !== undefined ? vitals.respiration : (vitals.rr || 0),
    lastUpdated: vitals.recorded_at,
    timestamp: vitals.recorded_at
  };
  return mapped;
}

async function selfHealingQuery(action: 'insert' | 'update', table: string, payload: any, id?: string) {
  let attempt = 0;
  const maxAttempts = 10;
  let currentPayload = Array.isArray(payload) ? { ...payload[0] } : { ...payload };

  // Make sure we ensure patient exists first if the table contains a patient_id or patientId
  if (currentPayload) {
    if (currentPayload.patient_id) {
      const cleanPatId = isUuid(currentPayload.patient_id) ? currentPayload.patient_id : toDeterministicUuid(currentPayload.patient_id);
      await ensurePatientExistsInDb(cleanPatId);
      currentPayload.patient_id = cleanPatId;
    } else if (currentPayload.patientId) {
      const cleanPatId = isUuid(currentPayload.patientId) ? currentPayload.patientId : toDeterministicUuid(currentPayload.patientId);
      await ensurePatientExistsInDb(cleanPatId);
      currentPayload.patient_id = cleanPatId;
      delete currentPayload.patientId;
    }
  }

  while (attempt < maxAttempts) {
    try {
      if (action === 'insert') {
        const { data, error } = await supabase
          .from(table)
          .insert([currentPayload])
          .select();
        
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from(table)
          .update(currentPayload)
          .eq('id', id!)
          .select();
        
        if (error) throw error;
        return data;
      }
    } catch (error: any) {
      console.warn(`Self-healing query attempt ${attempt + 1} failed for ${table}:`, error.message);
      
      const errMsg = error.message || '';
      const match = errMsg.match(/Could not find the '([^']+)'/) ||
                    errMsg.match(/column '([^']+)'/) ||
                    errMsg.match(/column "([^"]+)"/);
      
      if (match && match[1]) {
        const missingKey = match[1];
        console.log(`Detected missing database column '${missingKey}' inside ${table} table. Stripping it and retrying query...`);
        delete currentPayload[missingKey];
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Self-healing query exceeded max retries of ${maxAttempts} for ${table} table.`);
}

export function normalizePatient(p: any) {
  if (!p) return p;
  const isNeedsAdmission = p.needs_admission === true || p.needsAdmission === true || p.status?.toLowerCase() === 'admitting';
  const regType = p.registration_type || p.registrationType || 'OPD';
  
  const bG = p.blood_group || p.bloodGroup || null;
  const gN = p.guardian_name || p.guardianName || null;
  const fN = p.father_name || p.fatherName || null;
  const fP = p.father_phone || p.fatherPhone || null;
  const mN = p.mother_name || p.motherName || null;
  const mP = p.mother_phone || p.motherPhone || null;
  const hN = p.husband_name || p.husbandName || null;
  const hP = p.husband_phone || p.husbandPhone || null;
  const tI = p.tpa_id || p.tpaId || null;
  const tV = p.tpa_validity || p.tpaValidity || null;
  const aD = p.attending_doctor_id || p.attendingDoctorId || null;

  return {
    ...p,
    id: toDeterministicUuid(p.id),
    needsAdmission: isNeedsAdmission,
    needs_admission: isNeedsAdmission,
    registrationType: regType,
    registration_type: regType,
    bloodGroup: bG,
    blood_group: bG,
    guardianName: gN,
    guardian_name: gN,
    fatherName: fN,
    father_name: fN,
    fatherPhone: fP,
    father_phone: fP,
    motherName: mN,
    mother_name: mN,
    motherPhone: mP,
    mother_phone: mP,
    husbandName: hN,
    husband_name: hN,
    husbandPhone: hP,
    husband_phone: hP,
    tpaId: tI,
    tpa_id: tI,
    tpaValidity: tV,
    tpa_validity: tV,
    attendingDoctorId: aD,
    attending_doctor_id: aD
  };
}

export function isDummyPatient(p: any): boolean {
  if (!p) return false;
  const name = (p.name || '').toLowerCase();
  const id = String(p.id || '').toLowerCase();
  return (
    name.includes('dummy') ||
    name.includes('test') ||
    name.includes('mock') ||
    name.includes('trial') ||
    name.includes('temp') ||
    id.includes('dummy') ||
    id.includes('test')
  );
}


export function normalizeBed(b: any) {
  if (!b) return b;
  const num = b.bed_number || b.number || b.id || '';
  const bType = b.bed_type || b.type || 'General';
  const pId = b.patient_id || b.patientId || null;
  
  // Normalize status to 'Available', 'Occupied' etc.
  let bStatus = b.status || 'Available';
  if (bStatus.toLowerCase() === 'available') bStatus = 'Available';
  else if (bStatus.toLowerCase() === 'occupied') bStatus = 'Occupied';
  else {
    // Capitalize first letter
    bStatus = bStatus.charAt(0).toUpperCase() + bStatus.slice(1).toLowerCase();
  }

  return {
    ...b,
    bed_number: num,
    number: num,
    bed_type: bType,
    type: bType,
    patient_id: pId,
    patientId: pId,
    status: bStatus
  };
}

export function normalizeDischargeSummary(d: any) {
  if (!d) return d;
  return {
    ...d,
    id: d.id,
    admissionId: d.admission_id || d.admissionId,
    admission_id: d.admission_id || d.admissionId,
    patientId: d.patient_id || d.patientId,
    patient_id: d.patient_id || d.patientId,
    dischargeType: d.discharge_type || d.dischargeType || 'Routine / Improved',
    discharge_type: d.discharge_type || d.dischargeType || 'Routine / Improved',
    followUpDate: d.follow_up_date || d.followUpDate || '',
    follow_up_date: d.follow_up_date || d.followUpDate || '',
    medications: d.medications || '',
    clinicalSummary: d.clinical_summary || d.clinicalSummary || '',
    dischargeDate: d.discharge_date || d.dischargeDate || new Date().toISOString(),
    discharge_date: d.discharge_date || d.dischargeDate || new Date().toISOString(),
    dischargeBy: d.discharge_by || d.dischargeBy || 'Dr. Rajesh Sharma',
    discharge_by: d.discharge_by || d.dischargeBy || 'Dr. Rajesh Sharma',
    admissionDate: d.admission_date || d.admissionDate || '',
    admission_date: d.admission_date || d.admissionDate || ''
  };
}

const rawSupabaseService = {
  // Patients
  getPatients: async () => {
    try {
      console.log("[Supabase Request] getPatients - Fetching patients");
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });
      
      console.log("[Supabase Response] getPatients - Data length:", data?.length, "Error:", error);
      if (error) throw error;
      return (data || []).map(normalizePatient).filter((p: any) => !isDummyPatient(p));
    } catch (error: any) {
      console.warn('Error fetching patients, falling back to local storage:', error.message);
      return (storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS) || []).map(normalizePatient).filter((p: any) => !isDummyPatient(p));
    }
  },

  createPatient: async (patient: any) => {
    try {
      const dbPat = cleanPatientForPostgres(patient);
      console.log("[Supabase Request] createPatient - Sending payload:", dbPat);
      const { data, error } = await supabase
        .from('patients')
        .insert([dbPat])
        .select();
      
      console.log("[Supabase Response] createPatient - Data:", data, "Error:", error);
      if (error) throw error;
      return normalizePatient(data[0]);
    } catch (error: any) {
      console.error("[Supabase Error] createPatient failed, falling back to local storage:", error);
      console.warn('Handling local fallback for create patient:', error.message);
      const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      const newPatient = normalizePatient({
        ...patient,
        id: patient.id || 'off-pat-' + Date.now(),
        mrn: patient.mrn || 'MRN-' + Math.floor(100000 + Math.random() * 900000),
        status: patient.status || 'Active',
        created_at: patient.created_at || new Date().toISOString()
      });
      newPatient.isOffline = true;
      list.unshift(newPatient);
      storage.set(STORAGE_KEYS.PATIENTS, list);
      broadcastDataMutation('patients', 'insert');
      return newPatient;
    }
  },

  updatePatient: async (id: string, updates: any) => {
    try {
      const dbUpdates = cleanPatientForPostgres(updates);
      delete dbUpdates.id; // avoid key mutation error
      console.log("[Supabase Request] updatePatient - ID:", id, "Updates:", dbUpdates);
      const { data, error } = await supabase
        .from('patients')
        .update(dbUpdates)
        .eq('id', id)
        .select();
      
      console.log("[Supabase Response] updatePatient - Data:", data, "Error:", error);
      if (error) throw error;
      return normalizePatient(data[0]);
    } catch (error: any) {
      console.error("[Supabase Error] updatePatient failed, falling back to local storage:", error);
      console.warn('Handling local fallback for update patient:', error.message);
      const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      const target = list.find((p: any) => p.id === id);
      const updatedItem: any = normalizePatient({
        ...(target || {}),
        ...updates
      });
      const updated = list.map((p: any) => p.id === id ? updatedItem : p);
      storage.set(STORAGE_KEYS.PATIENTS, updated);
      broadcastDataMutation('patients', 'update');
      return updatedItem;
    }
  },

  deletePatient: async (id: string) => {
    try {
      console.log("[Supabase Request] deletePatient - ID:", id);
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', id);
      
      console.log("[Supabase Response] deletePatient - Error:", error);
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error("[Supabase Error] deletePatient failed:", error);
      console.error('Error deleting patient:', error.message);
      return false;
    }
  },

  // Appointments
  getAppointments: async () => {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, patients(name, mrn, age, gender)')
        .order('appointment_date', { ascending: true });
      
      if (error) throw error;
      return (data || []).map(mapAppointmentFromPostgres);
    } catch (error: any) {
      console.error('Error fetching appointments:', error.message);
      return null;
    }
  },

  createAppointment: async (appointment: any) => {
    try {
      const dbApt = cleanAppointmentForPostgres(appointment);
      await ensureForeignKeysExist(dbApt);
      const { data, error } = await supabase
        .from('appointments')
        .insert([dbApt])
        .select();
      
      if (error) throw error;
      const createdObj = mapAppointmentFromPostgres(data[0]);
      
      try {
        if (createdObj) {
          const aptType = (createdObj.type || '').toUpperCase();
          if (aptType === 'LAB' || aptType === 'LABORATORY') {
            await supabaseService.createLabTestRequest({
              patient_id: createdObj.patient_id || createdObj.patientId,
              test_name: 'Complete Blood Count (CBC) [From Appointment]',
              status: 'Ordered',
              reference_range: '12.0 - 17.0 g/dL',
              unit: 'g/dL',
              urgency: createdObj.urgency || 'routine'
            });
          } else if (aptType === 'RADIOLOGY') {
            await supabaseService.createRadiologyRecord({
              patient_id: createdObj.patient_id || createdObj.patientId,
              test_name: 'Chest X-Ray [From Appointment]',
              status: 'Ordered',
              urgency: createdObj.urgency || 'routine',
              result_notes: ''
            });
          }
        }
      } catch (e: any) {
        console.warn('Silent failure mapping appointment to diagnostic order:', e.message);
      }

      return createdObj;
    } catch (error: any) {
      console.error('Error creating appointment:', error.message);
      return null;
    }
  },

  updateAppointment: async (id: string, updates: any) => {
    try {
      const dbUpdates = cleanAppointmentForPostgres(updates);
      const { data, error } = await supabase
        .from('appointments')
        .update(dbUpdates)
        .eq('id', id)
        .select();
      
      if (error) throw error;
      return mapAppointmentFromPostgres(data[0]);
    } catch (error: any) {
      console.error('Error updating appointment:', error.message);
      return null;
    }
  },

  // Quick Registrations
  getQuickRegistrations: async () => {
    try {
      const { data, error } = await supabase
        .from('quick_registrations')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error fetching quick registrations:', error.message);
      return [];
    }
  },

  createQuickRegistration: async (req: any) => {
    try {
      const { data, error } = await supabase
        .from('quick_registrations')
        .insert([cleanUuidFields(req)])
        .select();
      if (error) throw error;
      return data ? data[0] : null;
    } catch (error: any) {
      console.error('Error creating quick registration:', error.message);
      return null;
    }
  },

  // Live Queue
  getLiveQueue: async () => {
    try {
      const { data, error } = await supabase
        .from('live_queue')
        .select('*, patients(name, mrn, age, gender)')
        .order('token_number', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error fetching live queue:', error.message);
      return [];
    }
  },

  createLiveQueueItem: async (queueItem: any) => {
    try {
      const { data, error } = await supabase
        .from('live_queue')
        .insert([cleanUuidFields(queueItem)])
        .select();
      if (error) throw error;
      return data ? data[0] : null;
    } catch (error: any) {
      console.error('Error creating live queue item:', error.message);
      return null;
    }
  },

  updateLiveQueueItem: async (id: string, updates: any) => {
    try {
      const { data, error } = await supabase
        .from('live_queue')
        .update(cleanUuidFields(updates))
        .eq('id', id)
        .select();
      if (error) throw error;
      return data ? data[0] : null;
    } catch (error: any) {
      console.error('Error updating live queue item:', error.message);
      return null;
    }
  },

  deleteLiveQueueItem: async (id: string) => {
    try {
      const { error } = await supabase
        .from('live_queue')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting live queue item:', error.message);
      return false;
    }
  },

  // Prescriptions
  getPrescriptions: async (patientId?: string) => {
    try {
      let query = supabase
        .from('prescriptions')
        .select('*, patients(name, mrn)');
      
      if (patientId) {
        const cleanId = isUuid(patientId) ? patientId : toDeterministicUuid(patientId);
        query = query.eq('patient_id', cleanId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for prescriptions:', error.message);
      let localData = storage.get(STORAGE_KEYS.PRESCRIPTIONS, MOCK_PRESCRIPTIONS);
      if (patientId) {
        localData = localData.filter((rx: any) => rx.patientId === patientId || rx.patient_id === patientId);
      }
      return localData;
    }
  },

  createPrescription: async (prescription: any) => {
    try {
      const dbPayload = cleanUuidFields(prescription);
      await ensureForeignKeysExist(dbPayload);
      const { data, error } = await supabase
        .from('prescriptions')
        .insert([dbPayload])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for create prescription:', error.message);
      const localData = storage.get(STORAGE_KEYS.PRESCRIPTIONS, MOCK_PRESCRIPTIONS);
      const newRx = { 
        ...prescription, 
        id: prescription.id || 'off-rx-' + Math.random().toString(36).substring(2, 9), 
        created_at: new Date().toISOString() 
      };
      localData.unshift(newRx);
      storage.set(STORAGE_KEYS.PRESCRIPTIONS, localData);
      return newRx;
    }
  },

  // Invoices / Billing
  getInvoices: async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, patients(name, mrn, phone, email), invoice_items(*)')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      if (data) {
        return data.map((inv: any) => {
          const mappedInv = mapInvoiceFromPostgres(inv);
          if (inv.invoice_items) {
            mappedInv.invoice_items = inv.invoice_items.map(mapInvoiceItemFromPostgres);
          }
          return mappedInv;
        });
      }
      return data;
    } catch (error: any) {
      console.error('Error fetching invoices:', error.message);
      return null;
    }
  },

  createInvoice: async (invoice: any, items: any[]) => {
    try {
      const dbInv = cleanInvoiceForPostgres(invoice);
      await ensureForeignKeysExist(dbInv);
      const { data: invData, error: invError } = await supabase
        .from('invoices')
        .insert([dbInv])
        .select();
      
      if (invError) throw invError;
      
      const invoiceId = invData[0].id;
      const itemsToInsert = items.map(item => {
        const dbItem = cleanInvoiceItemForPostgres(item);
        return { ...dbItem, invoice_id: invoiceId };
      });
      
      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(itemsToInsert);
      
      if (itemsError) throw itemsError;
      
      const syncedInv = mapInvoiceFromPostgres(invData[0]);
      // Fetch items back with their generated IDs and back-map to sync properly with frontend cache
      const { data: syncedItems } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);
      
      syncedInv.invoice_items = (syncedItems || []).map(mapInvoiceItemFromPostgres);
      return syncedInv;
    } catch (error: any) {
      console.error('Error creating invoice:', error.message);
      return null;
    }
  },

  updateInvoice: async (id: string, invoice: any, items?: any[]) => {
    try {
      const dbInv = cleanInvoiceForPostgres(invoice);
      delete dbInv.invoice_items;
      delete dbInv.patients;
      await ensureForeignKeysExist(dbInv);

      const { data: invData, error: invError } = await supabase
        .from('invoices')
        .update(dbInv)
        .eq('id', id)
        .select();
      
      if (invError) throw invError;
      
      if (items !== undefined) {
        const { error: deleteError } = await supabase
          .from('invoice_items')
          .delete()
          .eq('invoice_id', id);
          
        if (deleteError) throw deleteError;

        if (items && items.length > 0) {
          const itemsToInsert = items.map(item => {
            const dbItem = cleanInvoiceItemForPostgres(item);
            return { ...dbItem, invoice_id: id };
          });
          
          const { error: itemsError } = await supabase
            .from('invoice_items')
            .insert(itemsToInsert);
          
          if (itemsError) throw itemsError;
        }
      }
      
      if (!invData || invData.length === 0) {
        throw new Error("No invoice found with the given ID");
      }
      
      const syncedInv = mapInvoiceFromPostgres(invData[0]);
      const { data: syncedItems } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', id);
      
      syncedInv.invoice_items = (syncedItems || []).map(mapInvoiceItemFromPostgres);
      return syncedInv;
    } catch (error: any) {
      console.error('Error updating invoice:', error.message);
      return null;
    }
  },

  deleteInvoice: async (id: string) => {
    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting invoice:', error.message);
      return false;
    }
  },

  receivePayment: async (id: string, amountReceived: number, paymentMethod: string, reference?: string, remarks?: string, transactionDateTime?: string) => {
    try {
      const { data: inv, error: fetchErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', id)
        .single();
        
      if (fetchErr) throw fetchErr;
      
      const currentPaid = Number(inv.paid_amount || 0);
      const payableAmount = Number(inv.payable_amount || inv.total_amount || 0);
      const newPaid = Math.min(payableAmount, currentPaid + amountReceived);
      
      let status = 'Partial';
      if (newPaid >= payableAmount) {
        status = 'Paid';
      } else if (newPaid <= 0) {
        status = 'Unpaid';
      }
      
      const payload = {
        paid_amount: newPaid,
        payment_status: status,
        payment_method: paymentMethod,
        payment_reference: reference || '',
        payment_remarks: remarks || '',
        updated_at: transactionDateTime ? new Date(transactionDateTime).toISOString() : new Date().toISOString()
      };
      
      const { data: updated, error: updateErr } = await supabase
        .from('invoices')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
        
      if (updateErr) throw updateErr;
      
      const mappedUpdated = mapInvoiceFromPostgres(updated);

      // Also update local storage if fallback is active
      const bills = storage.get(STORAGE_KEYS.BILLING, []);
      const updatedBills = bills.map((b: any) => {
        if (b.id === id) {
          return {
            ...b,
            paid_amount: newPaid,
            paidAmount: newPaid,
            payment_status: status,
            paymentStatus: status,
            status: status === 'Paid' ? 'Settled' : status,
            payment_method: paymentMethod,
            paymentMethod: paymentMethod,
            paymentMode: paymentMethod,
            payment_reference: reference || '',
            payment_remarks: remarks || ''
          };
        }
        return b;
      });
      storage.set(STORAGE_KEYS.BILLING, updatedBills);
      
      window.dispatchEvent(new Event('storage'));
      return mappedUpdated;
    } catch (error: any) {
      console.error('Error recording payment in DB:', error.message);
      
      // Local fallback
      const bills = storage.get(STORAGE_KEYS.BILLING, []);
      const found = bills.find((b: any) => b.id === id);
      if (found) {
        const currentPaid = Number(found.paid_amount ?? found.paidAmount ?? 0);
        const payableAmount = Number(found.payable_amount ?? found.payableAmount ?? found.total_amount ?? found.totalAmount ?? 0);
        const newPaid = Math.min(payableAmount, currentPaid + amountReceived);
        
        let status = 'Partial';
        if (newPaid >= payableAmount) {
          status = 'Settled';
        }
        
        const updatedBills = bills.map((b: any) => {
          if (b.id === id) {
            return {
              ...b,
              paid_amount: newPaid,
              paidAmount: newPaid,
              payment_status: status === 'Settled' ? 'Paid' : 'Partial',
              paymentStatus: status === 'Settled' ? 'Paid' : 'Partial',
              status: status,
              payment_method: paymentMethod,
              paymentMethod: paymentMethod,
              paymentMode: paymentMethod,
              payment_reference: reference || '',
              payment_remarks: remarks || ''
            };
          }
          return b;
        });
        storage.set(STORAGE_KEYS.BILLING, updatedBills);
        window.dispatchEvent(new Event('storage'));
        
        const updatedMock = updatedBills.find((b: any) => b.id === id);
        return updatedMock;
      }
      return null;
    }
  },

  // Lab Tests & Orders
  getLabTests: async () => {
    try {
      const { data, error } = await supabase
        .from('lab_tests')
        .select('*')
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error fetching lab tests:', error.message);
      return null;
    }
  },

  getLabTestRequests: async () => {
    try {
      const { data, error } = await supabase
        .from('test_requests')
        .select('*, patients(name, mrn, age, gender, phone), profiles:requested_by(name)')
        .order('requested_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error fetching lab test requests:', error.message);
      return null;
    }
  },

  createLabTestRequest: async (request: any) => {
    try {
      const dbRequest: any = {};
      const validKeys = [
        'id', 'patient_id', 'test_id', 'requested_by', 'status', 'results',
        'report_url', 'requested_at', 'completed_at', 'test_name',
        'reference_range', 'unit', 'urgency', 'result_value', 'clinical_notes', 'findings'
      ];
      for (const key of validKeys) {
        if (request[key] !== undefined) {
          dbRequest[key] = request[key];
        }
      }

      const { data, error } = await supabase
        .from('test_requests')
        .insert([dbRequest])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for create lab test request:', error.message);
      const list = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
      const newRecord = {
        ...request,
        id: request.id || 'off-lab-' + Math.random().toString(36).substring(2, 9),
        requested_at: request.requested_at || new Date().toISOString()
      };
      list.unshift(newRecord);
      storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, list);
      return newRecord;
    }
  },

  updateLabTestRequest: async (id: string, updates: any) => {
    try {
      const cleanUpdates = { ...updates };
      delete cleanUpdates.updated_at;
      if (cleanUpdates.status === 'Completed' && !cleanUpdates.completed_at) {
        cleanUpdates.completed_at = new Date().toISOString();
      }

      const dbUpdates: any = {};
      const validKeys = [
        'patient_id', 'test_id', 'requested_by', 'status', 'results',
        'report_url', 'requested_at', 'completed_at', 'test_name',
        'reference_range', 'unit', 'urgency', 'result_value', 'clinical_notes', 'findings'
      ];
      for (const key of validKeys) {
        if (cleanUpdates[key] !== undefined) {
          dbUpdates[key] = cleanUpdates[key];
        }
      }

      const { data, error } = await supabase
        .from('test_requests')
        .update(dbUpdates)
        .eq('id', id)
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error updating lab test request:', error.message);
      return null;
    }
  },

  deleteLabTestRequest: async (id: string) => {
    try {
      const { error } = await supabase
        .from('test_requests')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting lab test request:', error.message);
      return false;
    }
  },

  // Radiology
  getRadiologyRecords: async () => {
    try {
      const { data, error } = await supabase
        .from('radiology_records')
        .select('*, patients(name, mrn), profiles:requested_by(name)')
        .order('requested_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for radiology records:', error.message);
      return storage.get('hms_radiology_records', []);
    }
  },

  createRadiologyRecord: async (record: any) => {
    try {
      const cleanRecord = { ...record };
      if ('result_value' in cleanRecord) {
        cleanRecord.result_notes = cleanRecord.result_value;
        delete cleanRecord.result_value;
      }
      delete cleanRecord.reference_range;
      delete cleanRecord.unit;

      const { data, error } = await supabase
        .from('radiology_records')
        .insert([cleanRecord])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for create radiology record:', error.message);
      const list = storage.get('hms_radiology_records', []);
      const newRecord = {
        ...record,
        id: record.id || 'off-rad-' + Math.random().toString(36).substring(2, 9),
        requested_at: record.requested_at || new Date().toISOString()
      };
      list.unshift(newRecord);
      storage.set('hms_radiology_records', list);
      return newRecord;
    }
  },

  updateRadiologyRecord: async (id: string, updates: any) => {
    try {
      const cleanUpdates = { ...updates };
      if ('result_value' in cleanUpdates) {
        cleanUpdates.result_notes = cleanUpdates.result_value;
        delete cleanUpdates.result_value;
      }
      delete cleanUpdates.reference_range;
      delete cleanUpdates.unit;

      const { data, error } = await supabase
        .from('radiology_records')
        .update(cleanUpdates)
        .eq('id', id)
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for update radiology record:', error.message);
      const list = storage.get('hms_radiology_records', []);
      const updatedList = list.map((item: any) => {
        if (item.id === id) {
          return { ...item, ...updates };
        }
        return item;
      });
      storage.set('hms_radiology_records', updatedList);
      return updatedList.find((item: any) => item.id === id) || null;
    }
  },

  // Hospital Info
  getHospitalInfo: async () => {
    try {
      const { data, error } = await supabase
        .from('hospital_info')
        .select('*')
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        return {
          ...data,
          gst: data.tax_id || data.gst || '',
          logo: data.logo_url || data.logo || null,
          template_image: data.registration_number || null
        };
      }
      return {
        name: 'Medicare Multispeciality Hospital',
        address: '123 Health Ave, Medical District, New Delhi, India 110001',
        phone: '+91 11 2345 6789',
        email: 'info@medicarehospital.com',
        website: 'www.medicarehospital.com',
        gst: '27AAAAA0000A1Z5',
        logo: null,
        template_image: null
      };
    } catch (error: any) {
      console.error('Error fetching hospital info:', error.message);
      return null;
    }
  },

  updateHospitalInfo: async (info: any) => {
    try {
      if (!info) return null;
      const { data: existing, error: fetchErr } = await supabase
        .from('hospital_info')
        .select('id')
        .limit(1);

      if (fetchErr) throw fetchErr;

      const payload = {
        name: info.name || 'Medicare Multispeciality Hospital',
        address: info.address || '',
        phone: info.phone || '',
        email: info.email || '',
        website: info.website || '',
        logo_url: info.logo || info.logo_url || null,
        tax_id: info.gst || info.tax_id || null,
        registration_number: info.template_image !== undefined ? info.template_image : null,
        updated_at: new Date().toISOString()
      };

      let result;
      if (existing && existing.length > 0) {
        const id = existing[0].id;
        const { data, error } = await supabase
          .from('hospital_info')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('hospital_info')
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      if (result) {
        return {
          ...result,
          gst: result.tax_id || result.gst || '',
          logo: result.logo_url || result.logo || null,
          template_image: result.registration_number || null
        };
      }
      return null;
    } catch (error: any) {
      console.error('Error updating hospital info:', error.message);
      return null;
    }
  },

  // Pharmacy Settings
  getPharmacySettings: async () => {
    try {
      const { data, error } = await supabase
        .from('pharmacy_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (error && error.code !== 'PGRST116') throw error;
      if (data && data.length > 0) {
        const row = data[0];
        return {
          logoUrl: row.logo_url || '',
          pharmacyName: row.pharmacy_name || '',
          address: row.address || '',
          phone: row.phone || '',
          tagline: row.tagline || '',
          gstin: row.gstin || '',
          bankName: row.bank_name || '',
          bankBranch: row.bank_branch || '',
          bankAccNo: row.bank_acc_no || '',
          bankIfsc: row.bank_ifsc || '',
          upiId: row.upi_id || '',
          termsAndConditions: row.terms_and_conditions || [],
          additionalFooter: row.additional_footer || ''
        };
      }
      
      // If table has empty rows, automatically populate and save default/cached settings to Supabase
      const localSettings = storage.get('hms_pharmacy_settings', DEFAULT_PHARMACY_SETTINGS);
      const dbPayload = {
        logo_url: localSettings.logoUrl,
        pharmacy_name: localSettings.pharmacyName,
        address: localSettings.address,
        phone: localSettings.phone,
        tagline: localSettings.tagline,
        gstin: localSettings.gstin,
        bank_name: localSettings.bankName,
        bank_branch: localSettings.bankBranch,
        bank_acc_no: localSettings.bankAccNo,
        bank_ifsc: localSettings.bankIfsc,
        upi_id: localSettings.upiId,
        terms_and_conditions: localSettings.termsAndConditions,
        additional_footer: localSettings.additionalFooter
      };
      
      const { data: inserted, error: insertError } = await supabase
        .from('pharmacy_settings')
        .insert([dbPayload])
        .select();
        
      if (insertError) {
        console.warn('Fallback silent insert default pharmacy settings error:', insertError.message);
        return localSettings;
      }
      
      if (inserted && inserted.length > 0) {
        const row = inserted[0];
        return {
          logoUrl: row.logo_url || '',
          pharmacyName: row.pharmacy_name || '',
          address: row.address || '',
          phone: row.phone || '',
          tagline: row.tagline || '',
          gstin: row.gstin || '',
          bankName: row.bank_name || '',
          bankBranch: row.bank_branch || '',
          bankAccNo: row.bank_acc_no || '',
          bankIfsc: row.bank_ifsc || '',
          upiId: row.upi_id || '',
          termsAndConditions: row.terms_and_conditions || [],
          additionalFooter: row.additional_footer || ''
        };
      }
      
      return localSettings;
    } catch (error: any) {
      console.error('Error fetching pharmacy settings:', error.message);
      return storage.get('hms_pharmacy_settings', DEFAULT_PHARMACY_SETTINGS);
    }
  },

  updatePharmacySettings: async (settings: any) => {
    try {
      const dbPayload = {
        logo_url: settings.logoUrl,
        pharmacy_name: settings.pharmacyName,
        address: settings.address,
        phone: settings.phone,
        tagline: settings.tagline,
        gstin: settings.gstin,
        bank_name: settings.bankName,
        bank_branch: settings.bankBranch,
        bank_acc_no: settings.bankAccNo,
        bank_ifsc: settings.bankIfsc,
        upi_id: settings.upiId,
        terms_and_conditions: settings.termsAndConditions,
        additional_footer: settings.additionalFooter
      };

      const { data: existing, error: checkError } = await supabase
        .from('pharmacy_settings')
        .select('id')
        .limit(1);
      
      if (checkError) throw checkError;

      let result;
      if (existing && existing.length > 0) {
        const id = existing[0].id;
        const { data, error } = await supabase
          .from('pharmacy_settings')
          .update(dbPayload)
          .eq('id', id)
          .select();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('pharmacy_settings')
          .insert([dbPayload])
          .select();
        if (error) throw error;
        result = data;
      }

      if (result && result[0]) {
        const row = result[0];
        return {
          id: row.id,
          logoUrl: row.logo_url || '',
          pharmacyName: row.pharmacy_name || '',
          address: row.address || '',
          phone: row.phone || '',
          tagline: row.tagline || '',
          gstin: row.gstin || '',
          bankName: row.bank_name || '',
          bankBranch: row.bank_branch || '',
          bankAccNo: row.bank_acc_no || '',
          bankIfsc: row.bank_ifsc || '',
          upiId: row.upi_id || '',
          termsAndConditions: row.terms_and_conditions || [],
          additionalFooter: row.additional_footer || ''
        };
      }
      return settings;
    } catch (error: any) {
      console.error('Error updating pharmacy settings:', error.message);
      return null;
    }
  },

  // Staff / Profiles
  decodeStaffPassword: (staffMember: any) => {
    if (!staffMember) return staffMember;
    const item = { ...staffMember };
    const match = item.degree?.match(/\[pwd:(.*?)\]/);
    if (match) {
      item.password = match[1];
      item.degree = item.degree.replace(/\[pwd:(.*?)\]/, '').trim();
    }
    const feeMatch = item.degree?.match(/\[fee:(.*?)\]/);
    if (feeMatch) {
      item.consultationFee = Number(feeMatch[1]) || 0;
      item.degree = item.degree.replace(/\[fee:(.*?)\]/, '').trim();
    } else if (item.consultation_fee !== undefined) {
      item.consultationFee = Number(item.consultation_fee) || 0;
    }
    return item;
  },

  encodeStaffPassword: (staffMember: any) => {
    if (!staffMember) return staffMember;
    const dbStaff = { ...staffMember };
    let cleanDegree = (dbStaff.degree || '').replace(/\[pwd:(.*?)\]/, '').replace(/\[fee:(.*?)\]/, '').trim();
    
    if (dbStaff.password) {
      cleanDegree = `${cleanDegree} [pwd:${dbStaff.password}]`.trim();
    }
    
    const feeValue = dbStaff.consultationFee !== undefined ? dbStaff.consultationFee : dbStaff.consultation_fee;
    if (feeValue !== undefined && feeValue !== null) {
      cleanDegree = `${cleanDegree} [fee:${feeValue}]`.trim();
    }
    
    dbStaff.degree = cleanDegree;
    delete dbStaff.password;
    delete dbStaff.consultationFee;
    delete dbStaff.consultation_fee;
    return dbStaff;
  },

  getStaff: async () => {
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .order('name', { ascending: true });
      
      const decodeHelper = (list: any[]) => {
        return list.map((p: any) => {
          const item = {
            ...p,
            avatar: p.avatar_url || p.avatar
          };
          // Decode password
          const match = item.degree?.match(/\[pwd:(.*?)\]/);
          if (match) {
            item.password = match[1];
            item.degree = item.degree.replace(/\[pwd:(.*?)\]/, '').trim();
          }
          // Decode consultation fee
          const feeMatch = item.degree?.match(/\[fee:(.*?)\]/);
          if (feeMatch) {
            item.consultationFee = Number(feeMatch[1]) || 0;
            item.degree = item.degree.replace(/\[fee:(.*?)\]/, '').trim();
          } else if (item.consultation_fee !== undefined) {
            item.consultationFee = Number(item.consultation_fee) || 0;
          }
          return item;
        });
      };

      if (error) {
        if (error.code === 'PGRST116' || error.message?.toLowerCase().includes('does not exist')) {
          // Fallback to profiles table
          const { data: pData, error: pError } = await supabase
            .from('profiles')
            .select('*')
            .order('name', { ascending: true });
          if (pError) throw pError;
          const mapped = decodeHelper(pData || []);
          storage.set(STORAGE_KEYS.USERS, mapped);
          return mapped;
        }
        throw error;
      }
      const mapped = decodeHelper(data || []);
      storage.set(STORAGE_KEYS.USERS, mapped);
      return mapped;
    } catch (error: any) {
      console.warn('Error fetching staff, falling back to local storage:', error.message);
      return storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
    }
  },

  createStaff: async (profile: any) => {
    try {
      const encodedProfile = rawSupabaseService.encodeStaffPassword(profile);
      const dbProfile = { ...encodedProfile };
      if ('avatar' in dbProfile) {
        dbProfile.avatar_url = dbProfile.avatar;
        delete dbProfile.avatar;
      }
      
      // Normalize roles to prevent CHECK constraint violations on profiles table
      if (dbProfile.role) {
        const r = dbProfile.role.toUpperCase().trim();
        if (r === 'RECEPTION' || r === 'RECEPTION_STAFF') {
          dbProfile.role = 'RECEPTIONIST';
        } else if (r === 'LAB_STAFF' || r === 'LAB_STAFF_MEMBER') {
          dbProfile.role = 'LAB_TECHNICIAN';
        } else {
          dbProfile.role = r;
        }
      }
      
      if (!dbProfile.id) {
        dbProfile.id = typeof crypto !== 'undefined' && crypto.randomUUID 
          ? crypto.randomUUID() 
          : '3f6c8d1a-4b9e-4e8c-8d1a-' + Math.random().toString(36).substring(2, 14).padEnd(12, '0');
      }

      let created: any = null;
      const { data, error } = await supabase
        .from('staff')
        .insert([dbProfile])
        .select();
      
      if (error) {
        if (error.message?.toLowerCase().includes('does not exist')) {
          // Fallback to inserting into profiles
          const { data: pData, error: pError } = await supabase
            .from('profiles')
            .insert([dbProfile])
            .select();
          if (pError) throw pError;
          created = pData[0];
        } else {
          throw error;
        }
      } else {
        created = data[0];
      }
      
      const rawResult = {
        ...created,
        avatar: created.avatar_url || created.avatar
      };
      
      const result = rawSupabaseService.decodeStaffPassword(rawResult);

      // Sync to local storage
      const existing = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
      storage.set(STORAGE_KEYS.USERS, [...existing, result]);

      return result;
    } catch (error: any) {
      console.error('Error creating staff:', error.message);
      // Even if database fails, write to local storage to enable local operations
      const dbProfile = { ...profile };
      const fallbackId = dbProfile.id || 'u-' + Date.now();
      const result = {
        ...dbProfile,
        id: fallbackId,
        avatar: dbProfile.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${dbProfile.name}`
      };
      const existing = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
      storage.set(STORAGE_KEYS.USERS, [...existing, result]);
      return result;
    }
  },

  updateStaff: async (id: string, updates: any) => {
    try {
      const encodedUpdates = rawSupabaseService.encodeStaffPassword(updates);
      const dbUpdates = { ...encodedUpdates };
      if ('avatar' in dbUpdates) {
        dbUpdates.avatar_url = dbUpdates.avatar;
        delete dbUpdates.avatar;
      }
      
      // Normalize roles to prevent CHECK constraint violations on profiles table
      if (dbUpdates.role) {
        const r = dbUpdates.role.toUpperCase().trim();
        if (r === 'RECEPTION' || r === 'RECEPTION_STAFF') {
          dbUpdates.role = 'RECEPTIONIST';
        } else if (r === 'LAB_STAFF' || r === 'LAB_STAFF_MEMBER') {
          dbUpdates.role = 'LAB_TECHNICIAN';
        } else {
          dbUpdates.role = r;
        }
      }

      let updated: any = null;
      const { data, error } = await supabase
        .from('staff')
        .update(dbUpdates)
        .eq('id', id)
        .select();
      
      if (error) {
        if (error.message?.toLowerCase().includes('does not exist')) {
          // Fallback to updating profiles
          const { data: pData, error: pError } = await supabase
            .from('profiles')
            .update(dbUpdates)
            .eq('id', id)
            .select();
          if (pError) throw pError;
          updated = pData[0];
        } else {
          throw error;
        }
      } else {
        updated = data[0];
      }
      
      const rawResult = {
        ...updated,
        avatar: updated.avatar_url || updated.avatar
      };
      
      const result = rawSupabaseService.decodeStaffPassword(rawResult);

      // Sync to local storage
      const existing = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
      const updatedList = existing.map((u: any) => u.id === id ? { ...u, ...result } : u);
      storage.set(STORAGE_KEYS.USERS, updatedList);

      return result;
    } catch (error: any) {
      console.error('Error updating staff:', error.message);
      // Fallback
      const existing = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
      const updatedList = existing.map((u: any) => u.id === id ? { ...u, ...updates } : u);
      storage.set(STORAGE_KEYS.USERS, updatedList);
      return { id, ...updates };
    }
  },

  deleteStaff: async (id: string) => {
    try {
      const { error } = await supabase
        .from('staff')
        .delete()
        .eq('id', id);
      
      if (error) {
        if (error.message?.toLowerCase().includes('does not exist')) {
          // Fallback to deleting from profiles
          const { error: pError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', id);
          if (pError) throw pError;
        } else {
          throw error;
        }
      }

      // Sync to local storage
      const existing = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
      const filtered = existing.filter((u: any) => u.id !== id);
      storage.set(STORAGE_KEYS.USERS, filtered);

      return true;
    } catch (error: any) {
      console.error('Error deleting staff:', error.message);
      // Fallback
      const existing = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
      const filtered = existing.filter((u: any) => u.id !== id);
      storage.set(STORAGE_KEYS.USERS, filtered);
      return true;
    }
  },

  // Departments
  getDepartments: async () => {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Error fetching departments, falling back to local storage:', error.message);
      return storage.get('hms_settings_departments', ['General Medicine', 'Orthopedics', 'Pediatrics', 'Gynaecology', 'Cardiology', 'Pathology', 'Radiology', 'Accounts']).map((name: string, index: number) => ({
        id: `dept-${index}`,
        name,
        description: ''
      }));
    }
  },

  createDepartment: async (name: string, description: string = '') => {
    try {
      const { data, error } = await supabase
        .from('departments')
        .insert([{ name, description }])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error creating department:', error.message);
      // Fallback for local storage
      const depts = storage.get('hms_settings_departments', ['General Medicine', 'Orthopedics', 'Pediatrics', 'Gynaecology', 'Cardiology', 'Pathology', 'Radiology', 'Accounts']);
      if (!depts.includes(name)) {
        depts.push(name);
        storage.set('hms_settings_departments', depts);
      }
      return { id: `dept-${Date.now()}`, name, description };
    }
  },

  deleteDepartment: async (name: string) => {
    try {
      const { error } = await supabase
        .from('departments')
        .delete()
        .eq('name', name);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting department:', error.message);
      const depts = storage.get('hms_settings_departments', ['General Medicine', 'Orthopedics', 'Pediatrics', 'Gynaecology', 'Cardiology', 'Pathology', 'Radiology', 'Accounts']);
      const filtered = depts.filter((d: string) => d !== name);
      storage.set('hms_settings_departments', filtered);
      return true;
    }
  },

  // Specialties
  getSpecialties: async () => {
    try {
      const { data, error } = await supabase
        .from('specialties')
        .select('*')
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Error fetching specialties, falling back to local storage:', error.message);
      return storage.get('hms_settings_specialties', ['Surgery', 'Consultation', 'Emergency', 'Diagnostics']).map((name: string, index: number) => ({
        id: `spec-${index}`,
        name,
        description: ''
      }));
    }
  },

  createSpecialty: async (name: string, description: string = '') => {
    try {
      const { data, error } = await supabase
        .from('specialties')
        .insert([{ name, description }])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error creating specialty:', error.message);
      const specs = storage.get('hms_settings_specialties', ['Surgery', 'Consultation', 'Emergency', 'Diagnostics']);
      if (!specs.includes(name)) {
        specs.push(name);
        storage.set('hms_settings_specialties', specs);
      }
      return { id: `spec-${Date.now()}`, name, description };
    }
  },

  deleteSpecialty: async (name: string) => {
    try {
      const { error } = await supabase
        .from('specialties')
        .delete()
        .eq('name', name);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting specialty:', error.message);
      const specs = storage.get('hms_settings_specialties', ['Surgery', 'Consultation', 'Emergency', 'Diagnostics']);
      const filtered = specs.filter((s: string) => s !== name);
      storage.set('hms_settings_specialties', filtered);
      return true;
    }
  },

  // Maternity
  getDeliveries: async () => {
    try {
      const { data, error } = await supabase
        .from('maternity_deliveries')
        .select('*, patients(name, mrn), profiles:surgeon_id(name)')
        .order('delivery_date', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for deliveries:', error.message);
      const list = storage.get('hms_maternity_deliveries', []);
      const patients = storage.get('hms_patients', []);
      const enriched = list.map((item: any) => {
        const pt = patients.find((p: any) => p.id === item.patient_id);
        return {
          ...item,
          patients: pt ? { name: pt.name, mrn: pt.mrn } : { name: 'Unknown Mother', mrn: 'MRN-???' }
        };
      });
      return enriched;
    }
  },

  createDelivery: async (delivery: any) => {
    try {
      const { data, error } = await supabase
        .from('maternity_deliveries')
        .insert([delivery])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for create delivery:', error.message);
      const list = storage.get('hms_maternity_deliveries', []);
      const newD = {
        ...delivery,
        id: 'off-del-' + Math.random().toString(36).substring(2, 9),
        created_at: new Date().toISOString()
      };
      list.unshift(newD);
      storage.set('hms_maternity_deliveries', list);

      let weight = 3.2;
      let gender = 'male';
      const notes = delivery.notes || '';
      const weightMatch = notes.match(/weight:\s*([0-9.]+)/i);
      const genderMatch = notes.match(/gender:\s*(\w+)/i);
      if (weightMatch) weight = parseFloat(weightMatch[1]);
      if (genderMatch) gender = genderMatch[1].toLowerCase();

      const newborns = storage.get('hms_maternity_newborns', []);
      const newBaby = {
        id: 'off-newborn-' + Math.random().toString(36).substring(2, 9),
        mother_id: delivery.patient_id,
        birth_weight: weight,
        gender: gender.charAt(0).toUpperCase() + gender.slice(1),
        birth_date_time: (delivery.delivery_date && delivery.delivery_time) 
          ? `${delivery.delivery_date}T${delivery.delivery_time}` 
          : new Date().toISOString(),
        created_at: new Date().toISOString()
      };
      newborns.unshift(newBaby);
      storage.set('hms_maternity_newborns', newborns);

      return newD;
    }
  },

  getNewborns: async () => {
    try {
      const { data, error } = await supabase
        .from('maternity_newborns')
        .select('*, patients:mother_id(name, mrn)')
        .order('birth_date_time', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for newborns:', error.message);
      const list = storage.get('hms_maternity_newborns', []);
      const patients = storage.get('hms_patients', []);
      const enriched = list.map((item: any) => {
        const pt = patients.find((p: any) => p.id === item.mother_id);
        return {
          ...item,
          patients: pt ? { name: pt.name, mrn: pt.mrn } : { name: 'Unknown', mrn: '' }
        };
      });
      return enriched;
    }
  },

  deleteDelivery: async (id: string) => {
    try {
      const { error } = await supabase
        .from('maternity_deliveries')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.warn('Handling local fallback for delete delivery:', error.message);
      const list = storage.get('hms_maternity_deliveries', []);
      const filtered = list.filter((item: any) => item.id !== id);
      storage.set('hms_maternity_deliveries', filtered);
      return true;
    }
  },

  updateDelivery: async (id: string, updates: any) => {
    try {
      const { data, error } = await supabase
        .from('maternity_deliveries')
        .update(updates)
        .eq('id', id)
        .select();
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for update delivery:', error.message);
      const list = storage.get('hms_maternity_deliveries', []);
      const updated = list.map((item: any) => item.id === id ? { ...item, ...updates } : item);
      storage.set('hms_maternity_deliveries', updated);
      return { id, ...updates };
    }
  },

  deleteNewborn: async (id: string) => {
    try {
      const { error } = await supabase
        .from('maternity_newborns')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.warn('Handling local fallback for delete newborn:', error.message);
      const list = storage.get('hms_maternity_newborns', []);
      const filtered = list.filter((item: any) => item.id !== id);
      storage.set('hms_maternity_newborns', filtered);
      return true;
    }
  },

  // OT (Operation Theatre)
  getOTRooms: async () => {
    try {
      const { data, error } = await supabase
        .from('ot_rooms')
        .select('*')
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for OT rooms:', error.message);
      return storage.get('hms_ot_rooms', MOCK_THEATRES);
    }
  },

  getOTSchedules: async () => {
    try {
      const response = await supabase
        .from('ot_schedules')
        .select('*');
      
      if (response.error) throw response.error;
      
      // Sort in memory safely to handle database schema variations (e.g. scheduled_date vs surgery_date)
      const sortedData = (response.data || []).sort((a: any, b: any) => {
        const dateA = a.scheduled_date || a.surgery_date || a.date || '';
        const dateB = b.scheduled_date || b.surgery_date || b.date || '';
        return String(dateA).localeCompare(String(dateB));
      });
      
      return sortedData.map(mapOTScheduleFromPostgres);
    } catch (error: any) {
      console.warn('Handling local fallback for OT schedules:', error.message);
      const fallbackList = storage.get('hms_ot_schedules', []);
      return fallbackList.map(mapOTScheduleFromPostgres);
    }
  },

  createOTSchedule: async (schedule: any) => {
    try {
      const dbSchedule = cleanOTScheduleForPostgres(schedule);
      const { data, error } = await supabase
        .from('ot_schedules')
        .insert([dbSchedule])
        .select();
      
      if (error) {
        if (error.message && (error.message.includes('operation_name') || error.message.includes('schema cache'))) {
          console.warn('Retrying OT schedule insert without operation_name column:', error.message);
          const fallbackDbSchedule = { ...dbSchedule };
          if (fallbackDbSchedule.operation_name && !fallbackDbSchedule.procedure_name) {
            fallbackDbSchedule.procedure_name = fallbackDbSchedule.operation_name;
          }
          delete fallbackDbSchedule.operation_name;
          
          const retryRes = await supabase
            .from('ot_schedules')
            .insert([fallbackDbSchedule])
            .select();
            
          if (!retryRes.error && retryRes.data && retryRes.data[0]) {
            return mapOTScheduleFromPostgres(retryRes.data[0]);
          }
          if (retryRes.error) throw retryRes.error;
        }
        throw error;
      }
      return mapOTScheduleFromPostgres(data[0]);
    } catch (error: any) {
      console.warn('Handling local fallback for create OT schedule:', error.message);
      const list = storage.get('hms_ot_schedules', []);
      const newSchedule = {
        ...schedule,
        id: schedule.id || 'off-ot-sch-' + Math.random().toString(36).substring(2, 9),
        created_at: new Date().toISOString()
      };
      list.push(newSchedule);
      storage.set('hms_ot_schedules', list);
      return mapOTScheduleFromPostgres(newSchedule);
    }
  },

  deleteOTRecord: async (id: string) => {
    try {
      const { error } = await supabase
        .from('ot_schedules')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.warn('Handling local fallback for delete OT record:', error.message);
      const list = storage.get('hms_ot_schedules', []);
      const filtered = list.filter((item: any) => item.id !== id);
      storage.set('hms_ot_schedules', filtered);
      return true;
    }
  },

  // Insurance
  getInsuranceClaims: async () => {
    try {
      const { data, error } = await supabase
        .from('insurance_claims')
        .select('*, patients(name, mrn)')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for insurance claims:', error.message);
      return storage.get(STORAGE_KEYS.INSURANCE, []);
    }
  },

  createInsuranceClaim: async (claim: any) => {
    try {
      const { data, error } = await supabase
        .from('insurance_claims')
        .insert([claim])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for create insurance claim:', error.message);
      const claims = storage.get(STORAGE_KEYS.INSURANCE, []);
      const newClaim = { 
        ...claim, 
        id: claim.id || 'off-claim-' + Math.random().toString(36).substring(2, 9),
        created_at: new Date().toISOString()
      };
      claims.unshift(newClaim);
      storage.set(STORAGE_KEYS.INSURANCE, claims);
      return newClaim;
    }
  },

  deleteInsuranceClaim: async (id: string) => {
    try {
      const { error } = await supabase
        .from('insurance_claims')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.warn('Handling local fallback for delete insurance claim:', error.message);
      const claims = storage.get(STORAGE_KEYS.INSURANCE, []);
      const filtered = claims.filter((c: any) => c.id !== id);
      storage.set(STORAGE_KEYS.INSURANCE, filtered);
      return true;
    }
  },

  // Nursing Station
  getNursingTasks: async (ward?: string) => {
    try {
      let query = supabase
        .from('nursing_notes')
        .select('*, patients(name, mrn, age, gender)');
      
      if (ward) {
        // Since there's no ward column in nursing_notes usually, 
        // we might need to join with admissions or beds if we want to filter by ward
        // For now, let's just return all notes
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error fetching nursing tasks:', error.message);
      return null;
    }
  },

  getNurseShifts: async () => {
    try {
      const { data, error } = await supabase
        .from('nurse_shifts')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('Handling local fallback for nurse shifts:', error.message);
      return storage.get('hms_nurse_shifts', MOCK_NURSE_SHIFTS);
    }
  },

  updateNursingTask: async (id: string, updates: any) => {
    try {
      const { data, error } = await supabase
        .from('nursing_notes')
        .update(updates)
        .eq('id', id)
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error updating nursing task:', error.message);
      return null;
    }
  },

  deleteNursingTask: async (id: string) => {
    try {
      const { error } = await supabase
        .from('nursing_notes')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting nursing task:', error.message);
      return false;
    }
  },

  createNursingTask: async (task: any) => {
    try {
      const { data, error } = await supabase
        .from('nursing_notes')
        .insert([task])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error creating nursing task:', error.message);
      return null;
    }
  },

  getNursingHandovers: async (ward?: string) => {
    try {
      let query = supabase
        .from('nursing_handovers')
        .select('*, outgoing_nurse:outgoing_nurse_id(name), incoming_nurse:incoming_nurse_id(name)');
      
      if (ward) {
        query = query.eq('ward', ward);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error fetching handovers:', error.message);
      return null;
    }
  },

  createNursingHandover: async (handover: any) => {
    try {
      const { data, error } = await supabase
        .from('nursing_handovers')
        .insert([handover])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error creating handover:', error.message);
      return null;
    }
  },

  // Expenses
  getExpenses: async () => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('expense_date', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error fetching expenses:', error.message);
      return null;
    }
  },

  createExpense: async (expense: any) => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .insert([expense])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error creating expense:', error.message);
      return null;
    }
  },

  deleteExpense: async (id: string) => {
    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting expense:', error.message);
      return false;
    }
  },

  updateExpense: async (id: string, updates: any) => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .update(updates)
        .eq('id', id)
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error updating expense:', error.message);
      return null;
    }
  },

  // Beds
  getBeds: async () => {
    try {
      const { data, error } = await supabase
        .from('beds')
        .select('*')
        .order('bed_number', { ascending: true });
      
      if (error) throw error;
      return (data || []).map(normalizeBed);
    } catch (error: any) {
      console.warn('Error fetching beds, falling back to local storage:', error.message);
      return (storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS) || []).map(normalizeBed);
    }
  },

  createBed: async (bed: any) => {
    try {
      const { data, error } = await supabase
        .from('beds')
        .insert([bed])
        .select();
      
      if (error) throw error;
      return normalizeBed(data[0]);
    } catch (error: any) {
      console.warn('Handling local fallback for create bed:', error.message);
      const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
      const newBedItem = normalizeBed({
        id: 'off-bed-' + Date.now(),
        bed_number: bed.bed_number || bed.number,
        number: bed.bed_number || bed.number,
        ward: bed.ward,
        bed_type: bed.bed_type || bed.type || 'General',
        type: bed.bed_type || bed.type || 'General',
        status: bed.status || 'Available'
      });
      list.push(newBedItem);
      storage.set(STORAGE_KEYS.BEDS, list);
      return newBedItem;
    }
  },

  updateBedStatus: async (id: string, status: string, patientId?: string | null) => {
    try {
      const { data, error } = await supabase
        .from('beds')
        .update({ status, patient_id: patientId })
        .eq('id', id)
        .select();
      
      if (error) throw error;
      return normalizeBed(data[0]);
    } catch (error: any) {
      console.warn('Handling local fallback for update bed status:', error.message);
      const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
      const target = list.find((b: any) => b.id === id);
      const updatedItem: any = normalizeBed({
        ...(target || {}),
        id,
        status,
        patient_id: patientId || null,
        patientId: patientId || null
      });
      const updated = list.map((b: any) => b.id === id ? updatedItem : b);
      if (!target && id) {
        updated.push(updatedItem);
      }
      storage.set(STORAGE_KEYS.BEDS, updated);
      return updatedItem;
    }
  },

  deleteBed: async (id: string) => {
    try {
      const { error } = await supabase
        .from('beds')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting bed:', error.message);
      return false;
    }
  },

  // Admissions
  getAdmissions: async () => {
    try {
      const { data, error } = await supabase
        .from('admissions')
        .select('*')
        .order('admission_date', { ascending: false });
      
      if (error) throw error;
      return data?.map((a: any) => ({
        ...a,
        urgency: a.urgency || a.reason || 'Routine',
        reason: a.reason || '',
        diagnosis: a.diagnosis || a.reason || ''
      })) || [];
    } catch (error: any) {
      console.warn('Handling local fallback for admissions:', error.message);
      return storage.get('hms_admissions', []);
    }
  },

  createAdmission: async (admission: any) => {
    try {
      const dbAdmission = cleanAdmissionForPostgres({
        ...admission,
        reason: admission.reason || admission.diagnosis || admission.urgency || 'Routine'
      });
      
      const data = await selfHealingQuery('insert', 'admissions', dbAdmission);
      if (data && data[0]) {
        const a = data[0];
        return {
          ...a,
          urgency: a.urgency || a.reason || 'Routine',
          reason: a.reason || '',
          diagnosis: a.diagnosis || a.reason || ''
        };
      }
      return null;
    } catch (error: any) {
      console.warn('Database admission creation error, falling back to local cache:', error.message);
      const list = storage.get('hms_admissions', []);
      const newD = {
        ...admission,
        id: admission.id || 'off-adm-' + Math.random().toString(36).substring(2, 9),
        admission_date: admission.admission_date || new Date().toISOString(),
        created_at: new Date().toISOString(),
        status: admission.status || 'Admitted'
      };
      list.unshift(newD);
      storage.set('hms_admissions', list);
      return newD;
    }
  },

  dischargePatient: async (admissionId: string, dischargeDate: string) => {
    try {
      const { data, error } = await supabase
        .from('admissions')
        .update({ status: 'Discharged', discharge_date: dischargeDate })
        .eq('id', admissionId)
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for discharge patient:', error.message);
      const list = storage.get('hms_admissions', []);
      const updated = list.map((item: any) => {
        if (item.id === admissionId) {
          return { ...item, status: 'Discharged', discharge_date: dischargeDate };
        }
        return item;
      });
      storage.set('hms_admissions', updated);
      return updated.find((item: any) => item.id === admissionId) || null;
    }
  },

  getDischargeSummaries: async () => {
    try {
      const { data, error } = await supabase
        .from('discharge_summaries')
        .select('*')
        .order('discharge_date', { ascending: false });
      
      if (error) throw error;
      return data?.map(normalizeDischargeSummary) || [];
    } catch (error: any) {
      console.warn('Handling local fallback for discharge summaries:', error.message);
      return (storage.get('hms_discharge_summaries', []) || []).map(normalizeDischargeSummary);
    }
  },

  createDischargeSummary: async (summary: any) => {
    try {
      const dbSummary: any = {
        admission_id: summary.admissionId || summary.admission_id || null,
        patient_id: summary.patientId || summary.patient_id,
        discharge_type: summary.dischargeType || summary.discharge_type || 'Routine / Improved',
        follow_up_date: summary.followUpDate || summary.follow_up_date || null,
        medications: summary.medications || '',
        clinical_summary: summary.clinicalSummary || summary.clinical_summary || '',
        discharge_date: summary.dischargeDate || summary.discharge_date || new Date().toISOString(),
        discharge_by: summary.dischargeBy || summary.discharge_by || 'Dr. Rajesh Sharma'
      };
      
      if (summary.admissionDate || summary.admission_date) {
        dbSummary.admission_date = summary.admissionDate || summary.admission_date;
      }
      
      const data = await selfHealingQuery('insert', 'discharge_summaries', dbSummary);
      if (data && data[0]) {
        return normalizeDischargeSummary({
          ...summary,
          ...data[0]
        });
      }
      return null;
    } catch (error: any) {
      console.warn('Database discharge summary creation error, falling back to local cache:', error.message);
      const list = storage.get('hms_discharge_summaries', []);
      const newD = normalizeDischargeSummary({
        ...summary,
        id: summary.id || 'off-sum-' + Date.now(),
        dischargeDate: summary.dischargeDate || new Date().toISOString(),
        created_at: new Date().toISOString()
      });
      list.unshift(newD);
      storage.set('hms_discharge_summaries', list);
      return newD;
    }
  },

  // Vitals
  getPatientVitals: async (patientId?: string) => {
    try {
      let query = supabase
        .from('patient_vitals')
        .select('*');
      
      if (patientId) {
        const cleanId = isUuid(patientId) ? patientId : toDeterministicUuid(patientId);
        query = query.eq('patient_id', cleanId);
      }

      const { data, error } = await query.order('recorded_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(mapVitalsFromPostgres);
    } catch (error: any) {
      console.error('Error fetching vitals:', error.message);
      return null;
    }
  },

  updateVitals: async (vitals: any) => {
    try {
      const dbVitals = cleanVitalsForPostgres(vitals);
      const data = await selfHealingQuery('insert', 'patient_vitals', dbVitals);
      return mapVitalsFromPostgres(data[0]);
    } catch (error: any) {
      console.error('Error updating vitals:', error.message);
      return null;
    }
  },

  // Clinical Notes
  getClinicalNotes: async (patientId: string) => {
    try {
      const cleanId = isUuid(patientId) ? patientId : toDeterministicUuid(patientId);
      const { data, error } = await supabase
        .from('clinical_notes')
        .select('*, profiles(name)')
        .eq('patient_id', cleanId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error fetching clinical notes:', error.message);
      return null;
    }
  },

  createClinicalNote: async (note: any) => {
    try {
      const { data, error } = await supabase
        .from('clinical_notes')
        .insert([cleanUuidFields(note)])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.warn('Handling local fallback for create clinical note:', error.message);
      const list = storage.get('hms_clinical_notes', []);
      const newNote = {
        ...note,
        id: 'off-note-' + Math.random().toString(36).substring(2, 9),
        created_at: new Date().toISOString()
      };
      list.unshift(newNote);
      storage.set('hms_clinical_notes', list);
      return newNote;
    }
  },

  deleteClinicalNote: async (id: string) => {
    try {
      const { error } = await supabase
        .from('clinical_notes')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting clinical note:', error.message);
      const list = storage.get('hms_clinical_notes', []);
      const filtered = list.filter((n: any) => n.id !== id);
      storage.set('hms_clinical_notes', filtered);
      return true;
    }
  },

  // Pharmacy
  logInventoryTransaction: async (transaction: any) => {
    try {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .insert([cleanUuidFields(transaction)])
        .select();
      
      if (error) throw error;
      return data[0];
    } catch (error: any) {
      console.error('Error logging inventory transaction:', error.message);
      return null;
    }
  },

  getPharmacyItems: async () => {
    try {
      const { data, error } = await supabase
        .from('pharmacy_items')
        .select('*')
        .order('name', { ascending: true });
      
      if (error) throw error;
      return (data || []).map(mapPharmacyItemFromPostgres);
    } catch (error: any) {
      console.error('Error fetching pharmacy items:', error.message);
      return null;
    }
  },

  createPharmacyItem: async (item: any) => {
    try {
      const dbItem = cleanPharmacyItemForPostgres(item);
      const data = await selfHealingQuery('insert', 'pharmacy_items', dbItem);
      
      const created = data && data[0] ? data[0] : item;
      if (created) {
        try {
          const config = {
            is_loose_sale_enabled: item.is_loose_sale_enabled,
            units_per_strip: item.units_per_strip === undefined ? 10 : item.units_per_strip,
            loose_selling_price: item.loose_selling_price === undefined ? 0 : item.loose_selling_price,
            loose_stock: item.loose_stock === undefined ? 0 : item.loose_stock
          };
          localStorage.setItem(`loose_config_${created.id || created.name}`, JSON.stringify(config));
        } catch (e) {}
      }
      
      return mapPharmacyItemFromPostgres(created);
    } catch (error: any) {
      console.error('Error creating pharmacy item:', error.message);
      return null;
    }
  },

  updatePharmacyItem: async (id: string, updates: any) => {
    try {
      // Save updates locally before database query in case database strips them
      try {
        const key = `loose_config_${id}`;
        const existingStr = localStorage.getItem(key);
        const existing = existingStr ? JSON.parse(existingStr) : {};
        const newConfig = {
          ...existing,
          ...(updates.is_loose_sale_enabled !== undefined ? { is_loose_sale_enabled: updates.is_loose_sale_enabled } : {}),
          ...(updates.units_per_strip !== undefined ? { units_per_strip: updates.units_per_strip } : {}),
          ...(updates.loose_selling_price !== undefined ? { loose_selling_price: updates.loose_selling_price } : {}),
          ...(updates.loose_stock !== undefined ? { loose_stock: updates.loose_stock } : {})
        };
        localStorage.setItem(key, JSON.stringify(newConfig));
      } catch (e) {}

      const dbUpdates = cleanPharmacyItemForPostgres(updates);
      const data = await selfHealingQuery('update', 'pharmacy_items', dbUpdates, id);
      return mapPharmacyItemFromPostgres(data && data[0] ? data[0] : { id, ...updates });
    } catch (error: any) {
      console.error('Error updating pharmacy item:', error.message);
      return null;
    }
  },

  deletePharmacyItem: async (id: string) => {
    try {
      const { error } = await supabase
        .from('pharmacy_items')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error deleting pharmacy item:', error.message);
      return false;
    }
  },

  // Dashboard Stats
  getDashboardStats: async () => {
    try {
      // Get counts and revenue concurrently to speed up execution and avoid timeouts
      const [patientsRes, appointmentsRes, admissionsRes, revenueRes] = await Promise.all([
        supabase.from('patients').select('*', { count: 'exact', head: true }).then(r => r, e => ({ count: null, error: e })),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).then(r => r, e => ({ count: null, error: e })),
        supabase.from('admissions').select('*', { count: 'exact', head: true }).then(r => r, e => ({ count: null, error: e })),
        supabase.from('invoices').select('paid_amount').then(r => r, e => ({ data: null, error: e }))
      ]);

      const patientCount = patientsRes?.count || 0;
      const appointmentCount = appointmentsRes?.count || 0;
      const admissionCount = admissionsRes?.count || 0;
      const totalRevenue = revenueRes?.data?.reduce((sum: number, inv: any) => sum + (Number(inv.paid_amount) || 0), 0) || 0;

      return {
        patientCount,
        appointmentCount,
        admissionCount,
        totalRevenue
      };
    } catch (error: any) {
      console.error('Error fetching dashboard stats:', error.message);
      return null;
    }
  }
};

// Intercept and wrap for automatic real-time sync broadcast, connection timeout safety, and robust offline fallback!
let lastToastTime = 0;
const toastSlowConnection = () => {
  const now = Date.now();
  if (now - lastToastTime > 15000) {
    lastToastTime = now;
    toast.info('Live server response delayed. Switched to high-speed local database.', {
      description: 'The app remains fully functional. Your updates will sync locally.',
      duration: 5000,
    });
  }
};

const cacheConfig: Record<string, { storageKey: string; defaultVal: any }> = {
  getPatients: { storageKey: STORAGE_KEYS.PATIENTS, defaultVal: MOCK_PATIENTS },
  getAppointments: { storageKey: STORAGE_KEYS.APPOINTMENTS, defaultVal: MOCK_APPOINTMENTS },
  getPrescriptions: { storageKey: STORAGE_KEYS.PRESCRIPTIONS, defaultVal: MOCK_PRESCRIPTIONS },
  getInvoices: { storageKey: STORAGE_KEYS.BILLING, defaultVal: MOCK_BILLING },
  getLabTests: { storageKey: STORAGE_KEYS.LAB_RATES, defaultVal: MOCK_LAB_TESTS },
  getLabTestRequests: { storageKey: STORAGE_KEYS.LAB_TEST_ORDERS, defaultVal: [] },
  getRadiologyRecords: { storageKey: STORAGE_KEYS.RADIOLOGY_FILES, defaultVal: [] },
  getHospitalInfo: { storageKey: STORAGE_KEYS.HOSPITAL_INFO, defaultVal: { name: 'CureLine Medical Center', address: '456 Healthcare Blvd, Central City', phone: '+1 (555) 987-6543', email: 'contact@cureline.com', tax_no: 'TX-99887766', registration_no: 'REG-55443322' } },
  getStaff: { storageKey: STORAGE_KEYS.USERS, defaultVal: MOCK_USERS },
  getDeliveries: { storageKey: 'hms_maternity_deliveries', defaultVal: [] },
  getNewborns: { storageKey: 'hms_maternity_newborns', defaultVal: [] },
  getOTRooms: { storageKey: 'hms_ot_rooms', defaultVal: MOCK_THEATRES },
  getOTSchedules: { storageKey: 'hms_ot_schedules', defaultVal: MOCK_OPERATION_RECORDS },
  getInsuranceClaims: { storageKey: STORAGE_KEYS.INSURANCE, defaultVal: [] },
  getNursingTasks: { storageKey: STORAGE_KEYS.NURSING_TASKS, defaultVal: MOCK_NURSING_TASKS },
  getNurseShifts: { storageKey: 'hms_nurse_shifts', defaultVal: MOCK_NURSE_SHIFTS },
  getNursingHandovers: { storageKey: 'hms_nursing_handovers', defaultVal: [] },
  getExpenses: { storageKey: STORAGE_KEYS.EXPENSES, defaultVal: [] },
  getBeds: { storageKey: STORAGE_KEYS.BEDS, defaultVal: MOCK_BEDS },
  getAdmissions: { storageKey: 'hms_admissions', defaultVal: [] },
  getDischargeSummaries: { storageKey: 'hms_discharge_summaries', defaultVal: [] },
  getPatientVitals: { storageKey: STORAGE_KEYS.PATIENT_VITALS, defaultVal: MOCK_PATIENT_VITALS },
  getClinicalNotes: { storageKey: 'hms_clinical_notes', defaultVal: [] },
  getPharmacyItems: { storageKey: STORAGE_KEYS.INVENTORY, defaultVal: MOCK_INVENTORY },
  getPharmacySettings: { storageKey: 'hms_pharmacy_settings', defaultVal: DEFAULT_PHARMACY_SETTINGS },
  getQuickRegistrations: { storageKey: 'hms_quick_registrations', defaultVal: [] },
  getLiveQueue: { storageKey: 'hms_live_queue', defaultVal: [] },
  getDashboardStats: { storageKey: 'hms_dashboard_stats', defaultVal: { patientCount: 0, appointmentCount: 0, admissionCount: 0, totalRevenue: 0 } },
};

function updateLocalCacheOnMutation(key: string, args: any[], result: any) {
  if (!result) return;
  const k = key.toLowerCase();
  
  try {
    if (key.startsWith('create') || key.startsWith('add') || key.startsWith('record') || key === 'updateVitals') {
      if (k.includes('patient')) {
        const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
        const filtered = list.filter((p: any) => p.id !== result.id && p.mrn !== result.mrn);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.PATIENTS, filtered);
      } else if (k.includes('staff') || k.includes('profile')) {
        const list = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
        const filtered = list.filter((u: any) => u.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.USERS, filtered);
      } else if (k.includes('appointment')) {
        const list = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
        const filtered = list.filter((a: any) => a.id !== result.id);
        filtered.push(result);
        storage.set(STORAGE_KEYS.APPOINTMENTS, filtered);
      } else if (k.includes('prescription')) {
        const list = storage.get(STORAGE_KEYS.PRESCRIPTIONS, MOCK_PRESCRIPTIONS);
        const filtered = list.filter((p: any) => p.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.PRESCRIPTIONS, filtered);
      } else if (k.includes('invoice')) {
        const list = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
        const filtered = list.filter((i: any) => i.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.BILLING, filtered);
      } else if (k.includes('admission')) {
        const list = storage.get('hms_admissions', []);
        const filtered = list.filter((a: any) => a.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_admissions', filtered);
      } else if (k.includes('discharge')) {
        const list = storage.get('hms_discharge_summaries', []);
        const filtered = list.filter((d: any) => d.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_discharge_summaries', filtered);
      } else if (k.includes('vital')) {
        const list = storage.get(STORAGE_KEYS.PATIENT_VITALS, MOCK_PATIENT_VITALS);
        const filtered = list.filter((v: any) => v.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.PATIENT_VITALS, filtered);
      } else if (k.includes('note')) {
        const list = storage.get('hms_clinical_notes', []);
        const filtered = list.filter((n: any) => n.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_clinical_notes', filtered);
      } else if (k.includes('bed')) {
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        const filtered = list.filter((b: any) => b.id !== result.id);
        filtered.push(result);
        storage.set(STORAGE_KEYS.BEDS, filtered);
      } else if (k.includes('ot_room') || k.includes('otroom')) {
        const list = storage.get('hms_ot_rooms', MOCK_THEATRES);
        const filtered = list.filter((r: any) => r.id !== result.id);
        filtered.push(result);
        storage.set('hms_ot_rooms', filtered);
      } else if (k.includes('otschedule') || k.includes('schedule')) {
        const list = storage.get('hms_ot_schedules', MOCK_OPERATION_RECORDS);
        const filtered = list.filter((s: any) => s.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_ot_schedules', filtered);
      } else if (k.includes('shift')) {
        const list = storage.get('hms_nurse_shifts', MOCK_NURSE_SHIFTS);
        const filtered = list.filter((s: any) => s.id !== result.id);
        filtered.push(result);
        storage.set('hms_nurse_shifts', filtered);
      } else if (k.includes('handover')) {
        const list = storage.get('hms_nursing_handovers', []);
        const filtered = list.filter((h: any) => h.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_nursing_handovers', filtered);
      } else if (k.includes('delivery')) {
        const list = storage.get('hms_maternity_deliveries', []);
        const filtered = list.filter((d: any) => d.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_maternity_deliveries', filtered);
      } else if (k.includes('newborn')) {
        const list = storage.get('hms_maternity_newborns', []);
        const filtered = list.filter((n: any) => n.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_maternity_newborns', filtered);
      } else if (k.includes('expense')) {
        const list = storage.get(STORAGE_KEYS.EXPENSES, []);
        const filtered = list.filter((e: any) => e.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.EXPENSES, filtered);
      } else if (k.includes('claim')) {
        const list = storage.get(STORAGE_KEYS.INSURANCE, []);
        const filtered = list.filter((c: any) => c.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.INSURANCE, filtered);
      } else if (k.includes('test') || k.includes('request')) {
        const list = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
        const filtered = list.filter((t: any) => t.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, filtered);
      } else if (k.includes('pharmacy') || k.includes('inventory')) {
        const list = storage.get(STORAGE_KEYS.INVENTORY, MOCK_INVENTORY);
        const filtered = list.filter((p: any) => p.id !== result.id);
        filtered.unshift(result);
        storage.set(STORAGE_KEYS.INVENTORY, filtered);
      } else if (k.includes('quickregistration') || k.includes('quick_registration')) {
        const list = storage.get('hms_quick_registrations', []);
        const filtered = list.filter((q: any) => q.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_quick_registrations', filtered);
      } else if (k.includes('livequeue') || k.includes('live_queue')) {
        const list = storage.get('hms_live_queue', []);
        const filtered = list.filter((q: any) => q.id !== result.id);
        filtered.unshift(result);
        storage.set('hms_live_queue', filtered);
      }
    } else if (key.startsWith('update')) {
      const id = args[0];
      if (k.includes('pharmacysettings')) {
        storage.set('hms_pharmacy_settings', result);
      } else if (k.includes('hospitalinfo')) {
        storage.set(STORAGE_KEYS.HOSPITAL_INFO, result);
      } else if (k.includes('invoice')) {
        const list = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
        const updated = list.map((i: any) => i.id === id ? { ...i, ...result } : i);
        storage.set(STORAGE_KEYS.BILLING, updated);

        if (result && result.invoice_items) {
          const itemsList = storage.get('hms_invoice_items', []);
          const filteredItems = itemsList.filter((it: any) => it.invoice_id !== id);
          const formattedItems = result.invoice_items.map((it: any) => ({
            ...it,
            invoice_id: id
          }));
          storage.set('hms_invoice_items', [...formattedItems, ...filteredItems]);
        }
      } else if (k.includes('staff') || k.includes('profile')) {
        const list = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
        const updated = list.map((u: any) => u.id === id ? { ...u, ...result } : u);
        storage.set(STORAGE_KEYS.USERS, updated);
      } else if (k.includes('bed')) {
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        const updated = list.map((b: any) => b.id === result.id ? result : b);
        storage.set(STORAGE_KEYS.BEDS, updated);
      } else if (k.includes('patient')) {
        const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
        const updated = list.map((p: any) => p.id === result.id ? result : p);
        storage.set(STORAGE_KEYS.PATIENTS, updated);
      } else if (k.includes('appointment')) {
        const list = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
        const updated = list.map((p: any) => p.id === result.id ? result : p);
        storage.set(STORAGE_KEYS.APPOINTMENTS, updated);
      } else if (k.includes('admission')) {
        const list = storage.get('hms_admissions', []);
        const updated = list.map((p: any) => p.id === result.id ? result : p);
        storage.set('hms_admissions', updated);
      } else if (k.includes('pharmacy') || k.includes('inventory')) {
        const list = storage.get(STORAGE_KEYS.INVENTORY, MOCK_INVENTORY);
        const updated = list.map((p: any) => p.id === result.id ? result : p);
        storage.set(STORAGE_KEYS.INVENTORY, updated);
      } else if (k.includes('test') || k.includes('request')) {
        const list = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
        const updated = list.map((t: any) => t.id === id ? { ...t, ...result } : t);
        storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, updated);
      } else if (k.includes('radiology')) {
        const list = storage.get(STORAGE_KEYS.RADIOLOGY_FILES, []);
        const updated = list.map((r: any) => r.id === id ? { ...r, ...result } : r);
        storage.set(STORAGE_KEYS.RADIOLOGY_FILES, updated);
      } else if (k.includes('quickregistration') || k.includes('quick_registration')) {
        const list = storage.get('hms_quick_registrations', []);
        const updated = list.map((q: any) => q.id === id ? { ...q, ...result } : q);
        storage.set('hms_quick_registrations', updated);
      } else if (k.includes('livequeue') || k.includes('live_queue')) {
        const list = storage.get('hms_live_queue', []);
        const updated = list.map((q: any) => q.id === id ? { ...q, ...result } : q);
        storage.set('hms_live_queue', updated);
      }
    } else if (key.startsWith('delete')) {
      const id = args[0];
      if (k.includes('invoice')) {
        const list = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
        const filtered = list.filter((i: any) => i.id !== id);
        storage.set(STORAGE_KEYS.BILLING, filtered);
        
        const itemsList = storage.get('hms_invoice_items', []);
        const filteredItems = itemsList.filter((it: any) => it.invoice_id !== id);
        storage.set('hms_invoice_items', filteredItems);
      } else if (k.includes('patient')) {
        const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
        const filtered = list.filter((p: any) => p.id !== id);
        storage.set(STORAGE_KEYS.PATIENTS, filtered);
      } else if (k.includes('appointment')) {
        const list = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
        const filtered = list.filter((a: any) => a.id !== id);
        storage.set(STORAGE_KEYS.APPOINTMENTS, filtered);
      } else if (k.includes('bed')) {
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        const filtered = list.filter((b: any) => b.id !== id);
        storage.set(STORAGE_KEYS.BEDS, filtered);
      } else if (k.includes('admission')) {
        const list = storage.get('hms_admissions', []);
        const filtered = list.filter((a: any) => a.id !== id);
        storage.set('hms_admissions', filtered);
      } else if (k.includes('prescription')) {
        const list = storage.get(STORAGE_KEYS.PRESCRIPTIONS, MOCK_PRESCRIPTIONS);
        const filtered = list.filter((p: any) => p.id !== id);
        storage.set(STORAGE_KEYS.PRESCRIPTIONS, filtered);
      } else if (k.includes('vital')) {
        const list = storage.get(STORAGE_KEYS.PATIENT_VITALS, MOCK_PATIENT_VITALS);
        const filtered = list.filter((v: any) => v.id !== id);
        storage.set(STORAGE_KEYS.PATIENT_VITALS, filtered);
      } else if (k.includes('note')) {
        const list = storage.get('hms_clinical_notes', []);
        const filtered = list.filter((n: any) => n.id !== id);
        storage.set('hms_clinical_notes', filtered);
      } else if (k.includes('expense')) {
        const list = storage.get(STORAGE_KEYS.EXPENSES, []);
        const filtered = list.filter((e: any) => e.id !== id);
        storage.set(STORAGE_KEYS.EXPENSES, filtered);
      } else if (k.includes('claim')) {
        const list = storage.get(STORAGE_KEYS.INSURANCE, []);
        const filtered = list.filter((c: any) => c.id !== id);
        storage.set(STORAGE_KEYS.INSURANCE, filtered);
      } else if (k.includes('schedule') || k.includes('ot_schedule')) {
        const list = storage.get('hms_ot_schedules', MOCK_OPERATION_RECORDS);
        const filtered = list.filter((s: any) => s.id !== id);
        storage.set('hms_ot_schedules', filtered);
      } else if (k.includes('delivery')) {
        const list = storage.get('hms_maternity_deliveries', []);
        const filtered = list.filter((d: any) => d.id !== id);
        storage.set('hms_maternity_deliveries', filtered);
      } else if (k.includes('newborn')) {
        const list = storage.get('hms_maternity_newborns', []);
        const filtered = list.filter((n: any) => n.id !== id);
        storage.set('hms_maternity_newborns', filtered);
      } else if (k.includes('shift')) {
        const list = storage.get('hms_nurse_shifts', MOCK_NURSE_SHIFTS);
        const filtered = list.filter((s: any) => s.id !== id);
        storage.set('hms_nurse_shifts', filtered);
      } else if (k.includes('pharmacy') || k.includes('inventory')) {
        const list = storage.get(STORAGE_KEYS.INVENTORY, MOCK_INVENTORY);
        const filtered = list.filter((p: any) => p.id !== id);
        storage.set(STORAGE_KEYS.INVENTORY, filtered);
      } else if (k.includes('livequeue') || k.includes('live_queue')) {
        const list = storage.get('hms_live_queue', []);
        const filtered = list.filter((item: any) => item.id !== id);
        storage.set('hms_live_queue', filtered);
      }
    }
  } catch (err) {
    console.warn('Error updating local cache on mutation:', err);
  }
}

function executeOfflineMutation(key: string, args: any[]): any {
  const k = key.toLowerCase();
  
  try {
    if (key.startsWith('create') || key.startsWith('add') || key.startsWith('record') || key === 'updateVitals') {
      const item = args[0] || {};
      if (!item.id) {
        item.id = 'off-' + Math.random().toString(36).substring(2, 9);
      }
      item.isOffline = true;
      if (!item.created_at) {
        item.created_at = new Date().toISOString();
      }

      if (k.includes('patient')) {
        const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
        list.unshift(item);
        storage.set(STORAGE_KEYS.PATIENTS, list);
      } else if (k.includes('appointment')) {
        const list = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
        list.push(item);
        storage.set(STORAGE_KEYS.APPOINTMENTS, list);
        
        try {
          const aptType = (item.type || '').toUpperCase();
          if (aptType === 'LAB' || aptType === 'LABORATORY') {
            const labList = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
            labList.unshift({
              id: 'off-req-' + Math.random().toString(36).substring(2, 9),
              patient_id: item.patient_id || item.patientId,
              test_name: 'Complete Blood Count (CBC) [From Appointment]',
              status: 'Ordered',
              reference_range: '12.0 - 17.0 g/dL',
              unit: 'g/dL',
              urgency: item.urgency || 'routine',
              requested_at: new Date().toISOString()
            });
            storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, labList);
            broadcastDataMutation('test_requests', 'insert');
          } else if (aptType === 'RADIOLOGY') {
            const radList = storage.get(STORAGE_KEYS.RADIOLOGY_FILES, []);
            radList.unshift({
              id: 'off-rad-' + Math.random().toString(36).substring(2, 9),
              patient_id: item.patient_id || item.patientId,
              test_name: 'Chest X-Ray [From Appointment]',
              status: 'Ordered',
              urgency: item.urgency || 'routine',
              requested_at: new Date().toISOString()
            });
            storage.set(STORAGE_KEYS.RADIOLOGY_FILES, radList);
            broadcastDataMutation('radiology_records', 'insert');
          }
        } catch (e: any) {
          console.warn('Silent local fallback appointment mapping failure:', e.message);
        }
      } else if (k.includes('prescription')) {
        const list = storage.get(STORAGE_KEYS.PRESCRIPTIONS, MOCK_PRESCRIPTIONS);
        list.unshift(item);
        storage.set(STORAGE_KEYS.PRESCRIPTIONS, list);
      } else if (k.includes('invoice')) {
        const list = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
        list.unshift(item);
        storage.set(STORAGE_KEYS.BILLING, list);
        if (args[1]) {
          const itemsList = storage.get('hms_invoice_items', []);
          const formattedItems = args[1].map((it: any) => ({ ...it, id: 'item-' + Math.random(), invoice_id: item.id }));
          storage.set('hms_invoice_items', [...formattedItems, ...itemsList]);
        }
      } else if (k.includes('admission')) {
        const list = storage.get('hms_admissions', []);
        list.unshift(item);
        storage.set('hms_admissions', list);
      } else if (k.includes('vital')) {
        const list = storage.get(STORAGE_KEYS.PATIENT_VITALS, MOCK_PATIENT_VITALS);
        list.unshift(item);
        storage.set(STORAGE_KEYS.PATIENT_VITALS, list);
      } else if (k.includes('note')) {
        const list = storage.get('hms_clinical_notes', []);
        list.unshift(item);
        storage.set('hms_clinical_notes', list);
      } else if (k.includes('otschedule') || k.includes('schedule')) {
        const list = storage.get('hms_ot_schedules', MOCK_OPERATION_RECORDS);
        list.unshift(item);
        storage.set('hms_ot_schedules', list);
      } else if (k.includes('claim')) {
        const list = storage.get(STORAGE_KEYS.INSURANCE, []);
        list.unshift(item);
        storage.set(STORAGE_KEYS.INSURANCE, list);
      } else if (k.includes('expense')) {
        const list = storage.get(STORAGE_KEYS.EXPENSES, []);
        list.unshift(item);
        storage.set(STORAGE_KEYS.EXPENSES, list);
      } else if (k.includes('test') || k.includes('request')) {
        const list = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
        list.unshift(item);
        storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, list);
      } else if (k.includes('delivery')) {
        const list = storage.get('hms_maternity_deliveries', []);
        list.unshift(item);
        storage.set('hms_maternity_deliveries', list);
      } else if (k.includes('newborn')) {
        const list = storage.get('hms_maternity_newborns', []);
        list.unshift(item);
        storage.set('hms_maternity_newborns', list);
      } else if (k.includes('bed')) {
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        list.push(item);
        storage.set(STORAGE_KEYS.BEDS, list);
      } else if (k.includes('ot_room') || k.includes('otroom')) {
        const list = storage.get('hms_ot_rooms', MOCK_THEATRES);
        list.push(item);
        storage.set('hms_ot_rooms', list);
      } else if (k.includes('shift')) {
        const list = storage.get('hms_nurse_shifts', MOCK_NURSE_SHIFTS);
        list.push(item);
        storage.set('hms_nurse_shifts', list);
      } else if (k.includes('handover')) {
        const list = storage.get('hms_nursing_handovers', []);
        list.unshift(item);
        storage.set('hms_nursing_handovers', list);
      } else if (k.includes('staff') || k.includes('profile')) {
        const list = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
        list.unshift(item);
        storage.set(STORAGE_KEYS.USERS, list);
      } else if (k === 'loginventorytransaction') {
        const list = storage.get('hms_inventory_transactions', []);
        list.unshift(item);
        storage.set('hms_inventory_transactions', list);
      } else if (k.includes('pharmacy') || k.includes('inventory')) {
        const list = storage.get(STORAGE_KEYS.INVENTORY, MOCK_INVENTORY);
        list.unshift(item);
        storage.set(STORAGE_KEYS.INVENTORY, list);
      } else if (k.includes('quickregistration') || k.includes('quick_registration')) {
        const list = storage.get('hms_quick_registrations', []);
        list.unshift(item);
        storage.set('hms_quick_registrations', list);
      } else if (k.includes('livequeue') || k.includes('live_queue')) {
        const list = storage.get('hms_live_queue', []);
        list.push(item);
        storage.set('hms_live_queue', list);
      }
      
      let concept = 'general';
      if (k.includes('patient')) concept = 'patients';
      else if (k.includes('appointment')) concept = 'appointments';
      else if (k.includes('bed')) concept = 'beds';
      else if (k.includes('staff') || k.includes('profile')) concept = 'profiles';
      broadcastDataMutation(concept, 'insert');
      return item;
    }

    if (key.startsWith('update')) {
      if (k.includes('hospitalinfo')) {
        const info = args[0] || {};
        storage.set(STORAGE_KEYS.HOSPITAL_INFO, info);
        broadcastDataMutation('hospital_info', 'update');
        return info;
      }

      const id = args[0];
      const updates = args[1] || {};

      let concept = 'general';
      if (k.includes('patient')) concept = 'patients';
      else if (k.includes('appointment')) concept = 'appointments';
      else if (k.includes('invoice')) concept = 'billing';
      else if (k.includes('bed')) concept = 'beds';
      else if (k.includes('admission')) concept = 'admissions';
      else if (k.includes('staff') || k.includes('profile')) concept = 'profiles';
      else if (k.includes('pharmacy') || k.includes('inventory')) concept = 'pharmacy_items';

      if (k.includes('invoice')) {
        const list = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
        const index = list.findIndex((i: any) => i.id === id);
        let updatedBill = null;
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          if (args[2]) {
            const itemsList = storage.get('hms_invoice_items', []);
            const filteredItems = itemsList.filter((it: any) => it.invoice_id !== id);
            const formattedItems = args[2].map((it: any) => ({
              ...it,
              id: it.id || 'item-' + Math.random(),
              invoice_id: id
            }));
            storage.set('hms_invoice_items', [...formattedItems, ...filteredItems]);
            (list[index] as any).invoice_items = formattedItems;
          }
          storage.set(STORAGE_KEYS.BILLING, list);
          broadcastDataMutation('billing', 'update');
          updatedBill = list[index];
        } else {
          updatedBill = { id, ...updates };
        }
        return updatedBill;
      }

      if (k === 'updatebedstatus') {
        const status = args[1];
        const patientId = args[2];
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        const updated = list.map((b: any) => {
          if (b.id === id) {
            return { 
              ...b, 
              status, 
              patient_id: patientId, 
              patientId: patientId 
            };
          }
          return b;
        });
        storage.set(STORAGE_KEYS.BEDS, updated);
        broadcastDataMutation('beds', 'update');
        return updated.find((b: any) => b.id === id);
      }

      if (k.includes('bed')) {
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        const updated = list.map((b: any) => {
          if (b.id === id) {
            return { ...b, ...updates };
          }
          return b;
        });
        storage.set(STORAGE_KEYS.BEDS, updated);
        broadcastDataMutation('beds', 'update');
        return updated.find((b: any) => b.id === id) || { id, ...updates };
      }

      if (k.includes('patient')) {
        const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
        const index = list.findIndex((p: any) => p.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set(STORAGE_KEYS.PATIENTS, list);
          broadcastDataMutation('patients', 'update');
          return list[index];
        }
      }

      if (k.includes('appointment')) {
        const list = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
        const index = list.findIndex((a: any) => a.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set(STORAGE_KEYS.APPOINTMENTS, list);
          broadcastDataMutation('appointments', 'update');
          return list[index];
        }
      }

      if (k.includes('admission')) {
        const list = storage.get('hms_admissions', []);
        const index = list.findIndex((a: any) => a.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set('hms_admissions', list);
          broadcastDataMutation('admissions', 'update');
          return list[index];
        }
      }

      if (k.includes('staff') || k.includes('profile')) {
        const list = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
        const index = list.findIndex((u: any) => u.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set(STORAGE_KEYS.USERS, list);
          broadcastDataMutation('profiles', 'update');
          return list[index];
        }
      }

      if (k.includes('pharmacy') || k.includes('inventory')) {
        const list = storage.get(STORAGE_KEYS.INVENTORY, MOCK_INVENTORY);
        const index = list.findIndex((p: any) => p.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set(STORAGE_KEYS.INVENTORY, list);
          broadcastDataMutation('pharmacy_items', 'update');
          return list[index];
        }
      }

      if (k.includes('test') || k.includes('request')) {
        const list = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
        const index = list.findIndex((r: any) => r.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, list);
          broadcastDataMutation('test_requests', 'update');
          return list[index];
        }
      }

      if (k.includes('expense')) {
        const list = storage.get(STORAGE_KEYS.EXPENSES, []);
        const index = list.findIndex((e: any) => e.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set(STORAGE_KEYS.EXPENSES, list);
          broadcastDataMutation('expenses', 'update');
          return list[index];
        }
      }

      if (k.includes('quickregistration') || k.includes('quick_registration')) {
        const list = storage.get('hms_quick_registrations', []);
        const index = list.findIndex((q: any) => q.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set('hms_quick_registrations', list);
          broadcastDataMutation('quick_registrations', 'update');
          return list[index];
        }
      }

      if (k.includes('livequeue') || k.includes('live_queue')) {
        const list = storage.get('hms_live_queue', []);
        const index = list.findIndex((q: any) => q.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], ...updates };
          storage.set('hms_live_queue', list);
          broadcastDataMutation('live_queue', 'update');
          return list[index];
        }
      }
      
      broadcastDataMutation(concept, 'update');
      return { id, ...updates };
    }

    if (key.startsWith('delete')) {
      const id = args[0];
      if (k.includes('invoice')) {
        const list = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
        const filtered = list.filter((i: any) => i.id !== id);
        storage.set(STORAGE_KEYS.BILLING, filtered);
        
        const itemsList = storage.get('hms_invoice_items', []);
        const filteredItems = itemsList.filter((it: any) => it.invoice_id !== id);
        storage.set('hms_invoice_items', filteredItems);
        broadcastDataMutation('billing', 'delete');
      } else if (k.includes('patient')) {
        const list = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
        const filtered = list.filter((p: any) => p.id !== id);
        storage.set(STORAGE_KEYS.PATIENTS, filtered);
        broadcastDataMutation('patients', 'delete');
      } else if (k.includes('appointment')) {
        const list = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
        const filtered = list.filter((a: any) => a.id !== id);
        storage.set(STORAGE_KEYS.APPOINTMENTS, filtered);
        broadcastDataMutation('appointments', 'delete');
      } else if (k.includes('bed')) {
        const list = storage.get(STORAGE_KEYS.BEDS, MOCK_BEDS);
        const filtered = list.filter((b: any) => b.id !== id);
        storage.set(STORAGE_KEYS.BEDS, filtered);
        broadcastDataMutation('beds', 'delete');
      } else if (k.includes('admission')) {
        const list = storage.get('hms_admissions', []);
        const filtered = list.filter((a: any) => a.id !== id);
        storage.set('hms_admissions', filtered);
        broadcastDataMutation('admissions', 'delete');
      } else if (k.includes('prescription')) {
        const list = storage.get(STORAGE_KEYS.PRESCRIPTIONS, MOCK_PRESCRIPTIONS);
        const filtered = list.filter((p: any) => p.id !== id);
        storage.set(STORAGE_KEYS.PRESCRIPTIONS, filtered);
        broadcastDataMutation('prescriptions', 'delete');
      } else if (k.includes('vital')) {
        const list = storage.get(STORAGE_KEYS.PATIENT_VITALS, MOCK_PATIENT_VITALS);
        const filtered = list.filter((v: any) => v.id !== id);
        storage.set(STORAGE_KEYS.PATIENT_VITALS, filtered);
        broadcastDataMutation('patient_vitals', 'delete');
      } else if (k.includes('note')) {
        const list = storage.get('hms_clinical_notes', []);
        const filtered = list.filter((n: any) => n.id !== id);
        storage.set('hms_clinical_notes', filtered);
        broadcastDataMutation('nursing_notes', 'delete');
      } else if (k.includes('expense')) {
        const list = storage.get(STORAGE_KEYS.EXPENSES, []);
        const filtered = list.filter((e: any) => e.id !== id);
        storage.set(STORAGE_KEYS.EXPENSES, filtered);
        broadcastDataMutation('expenses', 'delete');
      } else if (k.includes('claim')) {
        const list = storage.get(STORAGE_KEYS.INSURANCE, []);
        const filtered = list.filter((c: any) => c.id !== id);
        storage.set(STORAGE_KEYS.INSURANCE, filtered);
        broadcastDataMutation('insurance_claims', 'delete');
      } else if (k.includes('schedule') || k.includes('ot_schedule')) {
        const list = storage.get('hms_ot_schedules', MOCK_OPERATION_RECORDS);
        const filtered = list.filter((s: any) => s.id !== id);
        storage.set('hms_ot_schedules', filtered);
        broadcastDataMutation('ot_schedules', 'delete');
      } else if (k.includes('delivery')) {
        const list = storage.get('hms_maternity_deliveries', []);
        const filtered = list.filter((d: any) => d.id !== id);
        storage.set('hms_maternity_deliveries', filtered);
        broadcastDataMutation('deliveries', 'delete');
      } else if (k.includes('newborn')) {
        const list = storage.get('hms_maternity_newborns', []);
        const filtered = list.filter((n: any) => n.id !== id);
        storage.set('hms_maternity_newborns', filtered);
        broadcastDataMutation('newborns', 'delete');
      } else if (k.includes('shift')) {
        const list = storage.get('hms_nurse_shifts', MOCK_NURSE_SHIFTS);
        const filtered = list.filter((s: any) => s.id !== id);
        storage.set('hms_nurse_shifts', filtered);
        broadcastDataMutation('nurse_shifts', 'delete');
      } else if (k.includes('staff') || k.includes('profile')) {
        const list = storage.get(STORAGE_KEYS.USERS, MOCK_USERS);
        const filtered = list.filter((u: any) => u.id !== id);
        storage.set(STORAGE_KEYS.USERS, filtered);
        broadcastDataMutation('profiles', 'delete');
      } else if (k.includes('pharmacy') || k.includes('inventory')) {
        const list = storage.get(STORAGE_KEYS.INVENTORY, MOCK_INVENTORY);
        const filtered = list.filter((p: any) => p.id !== id);
        storage.set(STORAGE_KEYS.INVENTORY, filtered);
        broadcastDataMutation('pharmacy_items', 'delete');
      } else if (k.includes('quickregistration') || k.includes('quick_registration')) {
        const list = storage.get('hms_quick_registrations', []);
        const filtered = list.filter((q: any) => q.id !== id);
        storage.set('hms_quick_registrations', filtered);
        broadcastDataMutation('quick_registrations', 'delete');
      } else if (k.includes('livequeue') || k.includes('live_queue')) {
        const list = storage.get('hms_live_queue', []);
        const filtered = list.filter((q: any) => q.id !== id);
        storage.set('hms_live_queue', filtered);
        broadcastDataMutation('live_queue', 'delete');
      } else if (k.includes('test') || k.includes('request')) {
        const list = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
        const filtered = list.filter((r: any) => r.id !== id);
        storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, filtered);
        broadcastDataMutation('test_requests', 'delete');
      }
      return true;
    }
  } catch (err) {
    console.warn('Error in offline mutation:', err);
  }

  return true;
}

function executeOfflineQuery(key: string, args: any[]): any {
  const config = cacheConfig[key];
  if (config) {
    let cached = storage.get(config.storageKey, config.defaultVal);
    
    if (key === 'getPrescriptions' && args[0]) {
      const patientId = args[0];
      cached = cached.filter((rx: any) => rx.patientId === patientId || rx.patient_id === patientId);
    } else if (key === 'getPatientVitals' && args[0]) {
      const patientId = args[0];
      cached = cached.filter((v: any) => v.patientId === patientId || v.patient_id === patientId);
    } else if (key === 'getClinicalNotes' && args[0]) {
      const patientId = args[0];
      cached = cached.filter((n: any) => n.patientId === patientId || n.patient_id === patientId);
    } else if (key === 'getNursingTasks' && args[0]) {
      const ward = args[0];
      cached = cached.filter((t: any) => !ward || t.ward === ward);
    } else if (key === 'getNursingHandovers' && args[0]) {
      const ward = args[0];
      cached = cached.filter((h: any) => !ward || h.ward === ward);
    } else if (key === 'getAppointments') {
      const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      cached = cached.map((apt: any) => {
        const pid = apt.patient_id || apt.patientId;
        const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === pid);
        return {
          ...apt,
          patients: p ? { name: p.name, mrn: p.mrn, age: p.age, gender: p.gender } : null,
          appointment_date: apt.appointment_date || apt.date || new Date().toISOString().split('T')[0],
          appointment_time: apt.appointment_time || apt.time || '10:00 AM',
          patient_id: pid,
          doctor_id: apt.doctor_id || apt.doctorId,
          urgency: apt.urgency || 'Routine',
          status: apt.status || 'Scheduled'
        };
      });
    } else if (key === 'getLabTestRequests') {
      const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      cached = cached.map((req: any) => {
        const pid = req.patient_id || req.patientId;
        const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === pid);
        return {
          ...req,
          patients: p ? { name: p.name, mrn: p.mrn, age: p.age, gender: p.gender, phone: p.phone } : (req.patients || null),
          patient_id: pid
        };
      });
    } else if (key === 'getRadiologyRecords') {
      const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      cached = cached.map((rec: any) => {
        const pid = rec.patient_id || rec.patientId;
        const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === pid);
        return {
          ...rec,
          patients: p ? { name: p.name, mrn: p.mrn, age: p.age, gender: p.gender } : (rec.patients || null),
          patient_id: pid
        };
      });
    } else if (key === 'getPatients') {
      cached = cached.map(normalizePatient).filter((p: any) => !isDummyPatient(p));
    } else if (key === 'getLiveQueue') {
      const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      cached = cached.map((item: any) => {
        const pid = item.patient_id || item.patientId;
        const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === pid);
        return {
          ...item,
          patients: p ? { name: p.name, mrn: p.mrn, age: p.age, gender: p.gender } : null,
          patient_id: pid
        };
      });
    } else if (key === 'getBeds') {
      cached = cached.map(normalizeBed);
    } else if (key === 'getDischargeSummaries') {
      cached = cached.map(normalizeDischargeSummary);
    } else if (key === 'getInvoices') {
      const patientsList = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
      const itemsList = storage.get('hms_invoice_items', []);
      cached = cached.map((inv: any) => {
        const pid = inv.patient_id || inv.patientId;
        const p = patientsList.find((p_item: any) => p_item.id === pid || p_item.mrn === pid);
        const relatedItems = itemsList.filter((item: any) => item.invoice_id === inv.id);
        
        const finalItems = relatedItems.length > 0 
          ? relatedItems 
          : (inv.invoice_items || inv.items || []);
          
        const normalizedItems = finalItems.map((item: any) => ({
          id: item.id || 'item-' + Math.random(),
          item_name: item.item_name || item.name || item.description || 'Service/Medicine',
          unit_price: Number(item.unit_price || item.price || item.amount || 0),
          quantity: Number(item.quantity || 1),
          total_price: Number(item.total_price || item.total || item.amount || 0),
          category: item.category || 'OPD'
        }));

        return mapInvoiceFromPostgres({
          ...inv,
          patients: p ? { name: p.name, mrn: p.mrn, phone: p.phone, email: p.email } : (inv.patients || null),
          invoice_items: normalizedItems,
          patient_id: pid,
          created_at: inv.created_at || inv.date || new Date().toISOString()
        });
      });
    } else if (key === 'getPharmacyItems') {
      cached = cached.map(mapPharmacyItemFromPostgres);
    }
    return cached;
  }
  
  if (key === 'getDashboardStats') {
    const patients = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
    const appointments = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
    const bills = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
    const admissions = storage.get('hms_admissions', []);
    const activeAdmissions = admissions.filter((a: any) => a.status === 'Admitted');
    
    const totalRevenue = bills.reduce((sum: number, b: any) => sum + (Number(b.paid_amount) || Number(b.total_amount) || Number(b.total) || 0), 0);
    return {
      patientCount: patients.length,
      appointmentCount: appointments.length,
      admissionCount: activeAdmissions.length || 4,
      totalRevenue
    };
  }
  
  return null;
}

let supabaseUnreachable = false;
let connectionCheckPromise: Promise<boolean> | null = null;
let lastCheckTime = 0;
const CHECK_COOLDOWN_MS = 6000; // Cooldown of 6 seconds between connection checks if offline

function isNetworkFailure(err: any): boolean {
  if (!err) return false;
  // If we have a PostgreSQL specific error code, it means we reached the server and it rejected the query
  if (err.code) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('unreachable') ||
    msg.includes('failed to connect') ||
    msg.includes('connection refused') ||
    msg.includes('abort')
  );
}

export async function checkConnection(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  
  // Fast fail check using browser standard navigator.onLine API
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    supabaseUnreachable = true;
    return false;
  }
  
  const now = Date.now();
  if (supabaseUnreachable && (now - lastCheckTime < CHECK_COOLDOWN_MS)) {
    return false;
  }
  
  if (connectionCheckPromise) {
    return connectionCheckPromise;
  }
  
  lastCheckTime = now;
  connectionCheckPromise = (async () => {
    try {
      const rawPromise = supabase.from('hospital_info').select('id').limit(1);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Network check timed out")), 5000);
      });
      await Promise.race([rawPromise, timeoutPromise]);
      supabaseUnreachable = false;
      return true;
    } catch (err: any) {
      if (isNetworkFailure(err)) {
        supabaseUnreachable = true;
        return false;
      }
      // If it is a SQL/permission error but not network, it is still reachable!
      supabaseUnreachable = false;
      return true;
    } finally {
      connectionCheckPromise = null;
    }
  })();
  
  return connectionCheckPromise;
}

if (typeof window !== 'undefined') {
  const resetUnreachable = () => {
    supabaseUnreachable = false;
    connectionCheckPromise = null;
  };
  window.addEventListener('storage', resetUnreachable);
  window.addEventListener('supabase-config-change', resetUnreachable);
}

const syncWrappedService = {} as any;
for (const [key, value] of Object.entries(rawSupabaseService)) {
  if (typeof value === 'function') {
    const isMutation = 
      key.startsWith('create') || 
      key.startsWith('update') || 
      key.startsWith('delete') || 
      key.startsWith('add') || 
      key.startsWith('record') ||
      key.includes('Insert') ||
      key.includes('Update') ||
      key.includes('Delete');
    
    if (isMutation) {
      syncWrappedService[key] = async function(...args: any[]) {
        const firstArg = args[0];
        let isOfflineId = typeof firstArg === 'string' && !isUuid(firstArg);
        if (!isOfflineId && firstArg && typeof firstArg === 'object') {
          const checkId = firstArg.id || firstArg.patient_id || firstArg.patientId;
          if (typeof checkId === 'string' && checkId !== '' && !isUuid(checkId)) {
            isOfflineId = true;
          }
        }
        const isOnline = !isOfflineId && (await checkConnection());
        if (!isOnline) {
          return executeOfflineMutation(key, args);
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Mutation timed out")), 20000);
        });

        try {
          const result = await Promise.race([
            value.apply(this, args),
            timeoutPromise
          ]);
          
          if (result) {
            let concept = 'general';
            const k = key.toLowerCase();
            if (k.includes('patient')) concept = 'patients';
            else if (k.includes('appointment')) concept = 'appointments';
            else if (k.includes('prescription')) concept = 'prescriptions';
            else if (k.includes('invoice')) concept = 'invoices';
            else if (k.includes('expense')) concept = 'expenses';
            else if (k.includes('staff') || k.includes('profile')) concept = 'profiles';
            else if (k.includes('bed')) concept = 'beds';
            else if (k.includes('admission')) concept = 'admissions';
            else if (k.includes('vital')) concept = 'patient_vitals';
            else if (k.includes('note')) concept = 'nursing_notes';
            else if (k.includes('pharmacy')) concept = 'pharmacy_items';
            else if (k.includes('ot') || k.includes('schedule')) concept = 'ot_schedules';
            else if (k.includes('claim')) concept = 'insurance_claims';
            else if (k.includes('test') || k.includes('request')) concept = 'test_requests';

            updateLocalCacheOnMutation(key, args, result);
            
            const action = 
              key.startsWith('create') || key.startsWith('add') ? 'insert' : 
              (key.startsWith('delete') ? 'delete' : 'update');
            
            broadcastDataMutation(concept, action as any);
            return result;
          } else {
            console.warn(`Mutation ${key} returned falsy value (${result}). Executing offline fallback to maintain UI state.`);
            return executeOfflineMutation(key, args);
          }
        } catch (err: any) {
          const msg = (err.message || '').toLowerCase();
          const isNetworkIssue = isNetworkFailure(err) || msg.includes('timeout') || msg.includes('fetch');
          
          if (isNetworkIssue) {
            console.warn(`[Supabase Mutation Warning] Mutation ${key} timed out or network failed. Executing offline fallback to maintain UI state.`);
            supabaseUnreachable = true;
            toastSlowConnection();
            return executeOfflineMutation(key, args);
          } else {
            console.error(`[Supabase Error] Mutation ${key} failed:`, err);
          }
          
          // Real database schema or format issue. Do not mask.
          toast.error(`Database Error: ${err.message || err}`);
          return null;
        }
      };
    } else if (key.startsWith('get')) {
      // It's a query method (getPatients, etc.)
      syncWrappedService[key] = async function(...args: any[]) {
        const isOnline = await checkConnection();
        if (!isOnline) {
          return executeOfflineQuery(key, args);
        }

        const config = cacheConfig[key];
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Database connection timed out"));
          }, 20000);
        });

        try {
          const result = await Promise.race([
            value.apply(this, args),
            timeoutPromise
          ]);

          let finalResult = result;
          if (finalResult) {
            if (config) {
              const cached = storage.get(config.storageKey, []);
              if (Array.isArray(cached) && Array.isArray(finalResult)) {
                const offlineItems = cached.filter((item: any) => {
                  if (!item || !item.id) return false;
                  const idStr = String(item.id);
                  // Any non-UUID is generated locally (temporary, mock, or offline fallback) and must be preserved
                  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
                  const isOfflineItem = !isUuid || idStr.includes('off-') || item.isOffline === true || item.is_offline === true;
                  return isOfflineItem;
                });
                if (offlineItems.length > 0) {
                  const existingIds = new Set(finalResult.map((item: any) => item && item.id));
                  const offlineToKeep = offlineItems.filter((item: any) => item && item.id && !existingIds.has(item.id));
                  finalResult = [...offlineToKeep, ...finalResult];
                }
              }
              storage.set(config.storageKey, finalResult);
            }
            return finalResult;
          } else {
            console.warn(`Query ${key} returned falsy value. Falling back to cached local storage defaults representation.`);
            if (config) {
              return executeOfflineQuery(key, args);
            }
            return null;
          }
        } catch (err: any) {
          const msg = (err.message || '').toLowerCase();
          const isNetworkIssue = isNetworkFailure(err) || msg.includes('timeout') || msg.includes('fetch');
          
          if (isNetworkIssue) {
            console.warn(`[Supabase Query Warning] Query ${key} timed out or network failed. Falling back to offline cached storage representation.`);
            if (config) {
              toastSlowConnection();
              return executeOfflineQuery(key, args);
            }
          } else {
            console.error(`[Supabase Error] Query ${key} failed:`, err);
          }
          
          // Real database schema or query format issue. Do not mask.
          toast.error(`Database Query Error in ${key}: ${err.message || err}`);
          
          if (key === 'getDashboardStats') {
            const patients = storage.get(STORAGE_KEYS.PATIENTS, MOCK_PATIENTS);
            const appointments = storage.get(STORAGE_KEYS.APPOINTMENTS, MOCK_APPOINTMENTS);
            const bills = storage.get(STORAGE_KEYS.BILLING, MOCK_BILLING);
            const admissions = storage.get('hms_admissions', []);
            const activeAdmissions = admissions.filter((a: any) => a.status === 'Admitted');
            
            const totalRevenue = bills.reduce((sum: number, b: any) => sum + (Number(b.paid_amount) || Number(b.total_amount) || Number(b.total) || 0), 0);
            return {
              patientCount: patients.length,
              appointmentCount: appointments.length,
              admissionCount: activeAdmissions.length || 4,
              totalRevenue
            };
          }
          
          return null;
        }
      };
    } else {
      syncWrappedService[key] = value;
    }
  } else {
    syncWrappedService[key] = value;
  }
}

export const supabaseService = syncWrappedService as typeof rawSupabaseService;

// EXPORTS FOR OFFLINE-TO-ONLINE INTERACTION AND RECONCILIATION
export function getSupabaseUnreachable() {
  return supabaseUnreachable;
}

export function setSupabaseUnreachable(val: boolean) {
  supabaseUnreachable = val;
  if (!val) {
    connectionCheckPromise = null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('supabase-config-change'));
    }
  }
}

export async function syncOfflineDataWithSupabase() {
  if (!isSupabaseConfigured) {
    return { success: false, syncCount: 0, errors: ['Supabase is not configured yet.'] };
  }

  // Force connection attempt by resetting the unreachable state
  supabaseUnreachable = false;
  connectionCheckPromise = null;
  let syncCount = 0;
  const errors: string[] = [];

  try {
    // ID mapping to preserve foreign key constraints of offline records (e.g. old temporary IDs linked to patients)
    const idMap: Record<string, string> = {};

    // 1. Sync Patients (Base table)
    const patients = storage.get(STORAGE_KEYS.PATIENTS, []);
    const offlinePatients = patients.filter((p: any) => p.id && String(p.id).startsWith('off-'));
    
    for (const p of offlinePatients) {
      try {
        const patientData = { ...p };
        delete patientData.id; // Let database auto-assign UUID/MRN or keep custom MRN
        
        // Remove virtual fields
        delete patientData.patients;
        
        const { data, error } = await supabase
          .from('patients')
          .insert([patientData])
          .select();
        
        if (error) throw error;
        if (data && data[0]) {
          idMap[p.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Patient "${p.name || p.mrn}": ${err.message || JSON.stringify(err)}`);
      }
    }

    // Update patients list locally in-place with database-provided UUIDs so we don't have duplicates
    const updatedPatients = patients.map((p: any) => {
      if (idMap[p.id]) {
        return { ...p, id: idMap[p.id] };
      }
      return p;
    });
    storage.set(STORAGE_KEYS.PATIENTS, updatedPatients);

    // 2. Sync Appointments (Depends on patients)
    const appointments = storage.get(STORAGE_KEYS.APPOINTMENTS, []);
    const offlineAppointments = appointments.filter((a: any) => a.id && String(a.id).startsWith('off-'));
    for (const a of offlineAppointments) {
      try {
        const aptData = { ...a };
        delete aptData.id;
        delete aptData.patients; // Virt/JOIN field
        
        if (idMap[aptData.patient_id]) {
          aptData.patient_id = idMap[aptData.patient_id];
        }

        const dbAptData = cleanAppointmentForPostgres(aptData);
        const { data, error } = await supabase
          .from('appointments')
          .insert([dbAptData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[a.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Appointment: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedAppointments = appointments.map((a: any) => {
      if (idMap[a.id]) return { ...a, id: idMap[a.id] };
      return a;
    });
    storage.set(STORAGE_KEYS.APPOINTMENTS, updatedAppointments);

    // 3. Sync Admissions (Depends on patients)
    const admissions = storage.get('hms_admissions', []);
    const offlineAdmissions = admissions.filter((ad: any) => ad.id && String(ad.id).startsWith('off-'));
    for (const ad of offlineAdmissions) {
      try {
        const adData = { ...ad };
        delete adData.id;
        delete adData.patients;
        
        if (idMap[adData.patient_id]) {
          adData.patient_id = idMap[adData.patient_id];
        }

        const { data, error } = await supabase
          .from('admissions')
          .insert([adData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[ad.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Admission: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedAdmissions = admissions.map((ad: any) => {
      if (idMap[ad.id]) return { ...ad, id: idMap[ad.id] };
      return ad;
    });
    storage.set('hms_admissions', updatedAdmissions);

    // 4. Sync Prescriptions (Depends on patients)
    const prescriptions = storage.get(STORAGE_KEYS.PRESCRIPTIONS, []);
    const offlinePrescriptions = prescriptions.filter((rx: any) => rx.id && String(rx.id).startsWith('off-'));
    for (const rx of offlinePrescriptions) {
      try {
        const rxData = { ...rx };
        delete rxData.id;
        delete rxData.patients;
        
        if (idMap[rxData.patient_id]) {
          rxData.patient_id = idMap[rxData.patient_id];
        }

        const { data, error } = await supabase
          .from('prescriptions')
          .insert([rxData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[rx.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Prescription: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedPrescriptions = prescriptions.map((rx: any) => {
      if (idMap[rx.id]) return { ...rx, id: idMap[rx.id] };
      return rx;
    });
    storage.set(STORAGE_KEYS.PRESCRIPTIONS, updatedPrescriptions);

    // 5. Sync Patient Vitals (Depends on patients)
    const vitals = storage.get(STORAGE_KEYS.PATIENT_VITALS, []);
    const offlineVitals = vitals.filter((v: any) => v.id && String(v.id).startsWith('off-'));
    for (const v of offlineVitals) {
      try {
        const vData = { ...v };
        delete vData.id;
        
        if (idMap[vData.patient_id]) {
          vData.patient_id = idMap[vData.patient_id];
        }

        const dbVData = cleanVitalsForPostgres(vData);
        const { data, error } = await supabase
          .from('patient_vitals')
          .insert([dbVData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[v.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Patient Vital: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedVitals = vitals.map((v: any) => {
      if (idMap[v.id]) return { ...v, id: idMap[v.id] };
      return v;
    });
    storage.set(STORAGE_KEYS.PATIENT_VITALS, updatedVitals);

    // 6. Sync Clinical Notes (Depends on patients)
    const notes = storage.get('hms_clinical_notes', []);
    const offlineNotes = notes.filter((n: any) => n.id && String(n.id).startsWith('off-'));
    for (const n of offlineNotes) {
      try {
        const nData = { ...n };
        delete nData.id;
        
        if (idMap[nData.patient_id]) {
          nData.patient_id = idMap[nData.patient_id];
        }

        const { data, error } = await supabase
          .from('clinical_notes')
          .insert([nData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[n.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Clinical Note: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedNotes = notes.map((n: any) => {
      if (idMap[n.id]) return { ...n, id: idMap[n.id] };
      return n;
    });
    storage.set('hms_clinical_notes', updatedNotes);

    // 7. Sync OT schedules (Depends on patients)
    const otSchedules = storage.get('hms_ot_schedules', []);
    const offlineOtSchedules = otSchedules.filter((s: any) => s.id && String(s.id).startsWith('off-'));
    for (const s of offlineOtSchedules) {
      try {
        const sData = { ...s };
        if (idMap[sData.patient_id]) {
          sData.patient_id = idMap[sData.patient_id];
        } else if (idMap[sData.patientId]) {
          sData.patientId = idMap[sData.patientId];
        }
        
        const cleaned = cleanOTScheduleForPostgres(sData);
        let resData: any[] | null = null;
        let resError: any = null;

        const firstTry = await supabase
          .from('ot_schedules')
          .insert([cleaned])
          .select();

        resData = firstTry.data;
        resError = firstTry.error;

        if (resError) {
          if (resError.message && (resError.message.includes('operation_name') || resError.message.includes('schema cache'))) {
            const fallbackCleaned = { ...cleaned };
            if (fallbackCleaned.operation_name && !fallbackCleaned.procedure_name) {
              fallbackCleaned.procedure_name = fallbackCleaned.operation_name;
            }
            delete fallbackCleaned.operation_name;
            
            const retryRes = await supabase
              .from('ot_schedules')
              .insert([fallbackCleaned])
              .select();
              
            resData = retryRes.data;
            resError = retryRes.error;
          }
        }

        if (resError) throw resError;
        if (resData && resData[0]) {
          idMap[s.id] = resData[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`OT Schedule: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedOtSchedules = otSchedules.map((s: any) => {
      if (idMap[s.id]) return { ...s, id: idMap[s.id] };
      return s;
    });
    storage.set('hms_ot_schedules', updatedOtSchedules);

    // 8. Sync Invoices / Billing (Depends on patients)
    const invoices = storage.get(STORAGE_KEYS.BILLING, []);
    const offlineInvoices = invoices.filter((inv: any) => inv.id && String(inv.id).startsWith('off-'));
    const invoiceItemsList = storage.get('hms_invoice_items', []);

    for (const inv of offlineInvoices) {
      try {
        const invData = { ...inv };
        delete invData.id;
        delete invData.patients;
        delete invData.invoice_items;
        
        if (idMap[invData.patient_id]) {
          invData.patient_id = idMap[invData.patient_id];
        }

        const dbInvData = cleanInvoiceForPostgres(invData);
        await ensureForeignKeysExist(dbInvData);
        const { data, error } = await supabase
          .from('invoices')
          .insert([dbInvData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          const newInvoiceId = data[0].id;
          idMap[inv.id] = newInvoiceId;
          syncCount++;

          // Upload any associated items for this invoice
          const relatedItems = invoiceItemsList.filter((it: any) => it.invoice_id === inv.id);
          for (const item of relatedItems) {
            try {
              const itemData = { ...item, invoice_id: newInvoiceId };
              delete itemData.id;
              const dbItemData = cleanInvoiceItemForPostgres(itemData);
              await supabase.from('invoice_items').insert([dbItemData]);
            } catch (itErr) {
              console.warn('Silent item sync failure:', itErr);
            }
          }
        }
      } catch (err: any) {
        errors.push(`Invoice: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedInvoices = invoices.map((inv: any) => {
      if (idMap[inv.id]) return { ...inv, id: idMap[inv.id] };
      return inv;
    });
    storage.set(STORAGE_KEYS.BILLING, updatedInvoices);

    // 9. Sync Expenses
    const expenses = storage.get(STORAGE_KEYS.EXPENSES, []);
    const offlineExpenses = expenses.filter((ex: any) => ex.id && String(ex.id).startsWith('off-'));
    for (const ex of offlineExpenses) {
      try {
        const exData = { ...ex };
        delete exData.id;
        
        const { data, error } = await supabase
          .from('expenses')
          .insert([exData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[ex.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Expense: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedExpenses = expenses.map((ex: any) => {
      if (idMap[ex.id]) return { ...ex, id: idMap[ex.id] };
      return ex;
    });
    storage.set(STORAGE_KEYS.EXPENSES, updatedExpenses);

    // 10. Sync Insurance Claims (Depends on patients)
    const claims = storage.get(STORAGE_KEYS.INSURANCE, []);
    const offlineClaims = claims.filter((cl: any) => cl.id && String(cl.id).startsWith('off-'));
    for (const cl of offlineClaims) {
      try {
        const clData = { ...cl };
        delete clData.id;
        delete clData.patients;
        
        if (idMap[clData.patient_id]) {
          clData.patient_id = idMap[clData.patient_id];
        }

        const { data, error } = await supabase
          .from('insurance_claims')
          .insert([clData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[cl.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Insurance Claim: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedClaims = claims.map((cl: any) => {
      if (idMap[cl.id]) return { ...cl, id: idMap[cl.id] };
      return cl;
    });
    storage.set(STORAGE_KEYS.INSURANCE, updatedClaims);

    // 11. Sync Lab requests (Depends on patients)
    const labRequests = storage.get(STORAGE_KEYS.LAB_TEST_ORDERS, []);
    const offlineLabRequests = labRequests.filter((lr: any) => lr.id && String(lr.id).startsWith('off-'));
    for (const lr of offlineLabRequests) {
      try {
        const lrData = { ...lr };
        delete lrData.id;
        delete lrData.patients;
        delete lrData.lab_tests;
        
        if (idMap[lrData.patient_id]) {
          lrData.patient_id = idMap[lrData.patient_id];
        }

        const validKeys = [
          'patient_id', 'test_id', 'requested_by', 'status', 'results',
          'report_url', 'requested_at', 'completed_at', 'test_name',
          'reference_range', 'unit', 'urgency', 'result_value', 'clinical_notes', 'findings'
        ];
        const dbLrData: any = {};
        for (const k of validKeys) {
          if (lrData[k] !== undefined) {
            dbLrData[k] = lrData[k];
          }
        }

        const { data, error } = await supabase
          .from('test_requests')
          .insert([dbLrData])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          idMap[lr.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Lab Request: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedLabRequests = labRequests.map((lr: any) => {
      if (idMap[lr.id]) return { ...lr, id: idMap[lr.id] };
      return lr;
    });
    storage.set(STORAGE_KEYS.LAB_TEST_ORDERS, updatedLabRequests);

    // 12. Sync Pharmacy Items / Inventory
    const pharmacyItems = storage.get(STORAGE_KEYS.INVENTORY, []);
    const offlinePharmacyItems = pharmacyItems.filter((item: any) => item.id && String(item.id).startsWith('off-'));
    for (const item of offlinePharmacyItems) {
      try {
        const itemData = { ...item };
        delete itemData.id;

        const dbItemData = cleanPharmacyItemForPostgres(itemData);
        const data = await selfHealingQuery('insert', 'pharmacy_items', dbItemData);
        if (data && data[0]) {
          idMap[item.id] = data[0].id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Pharmacy Item: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedPharmacyItems = pharmacyItems.map((item: any) => {
      if (idMap[item.id]) {
        return mapPharmacyItemFromPostgres({ ...item, id: idMap[item.id] });
      }
      return item;
    });
    storage.set(STORAGE_KEYS.INVENTORY, updatedPharmacyItems);

    // 13. Sync Staff
    const staffList = storage.get(STORAGE_KEYS.USERS, []);
    const offlineStaffList = staffList.filter((s: any) => s.id && String(s.id).startsWith('off-'));
    for (const s of offlineStaffList) {
      try {
        const staffData = { ...s };
        delete staffData.id;

        const dbResult = await rawSupabaseService.createStaff(staffData);
        if (dbResult && dbResult.id) {
          idMap[s.id] = dbResult.id;
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Staff: ${err.message || JSON.stringify(err)}`);
      }
    }
    const updatedStaffList = staffList.map((s: any) => {
      if (idMap[s.id]) {
        return {
          ...s,
          id: idMap[s.id],
          avatar: s.avatar_url || s.avatar
        };
      }
      return s;
    });
    storage.set(STORAGE_KEYS.USERS, updatedStaffList);

    // 14. Sync Inventory Transactions
    const txList = storage.get('hms_inventory_transactions', []);
    const offlineTxList = txList.filter((tx: any) => tx.id && String(tx.id).startsWith('off-'));
    for (const tx of offlineTxList) {
      try {
        const txData = { ...tx };
        delete txData.id;
        if (txData.item_id && idMap[txData.item_id]) {
          txData.item_id = idMap[txData.item_id];
        }
        if (txData.performed_by && idMap[txData.performed_by]) {
          txData.performed_by = idMap[txData.performed_by];
        }

        const { error } = await supabase.from('inventory_transactions').insert([txData]);
        if (!error) {
          syncCount++;
        }
      } catch (err: any) {
        errors.push(`Inventory Transaction: ${err.message || JSON.stringify(err)}`);
      }
    }

    // Broadcast synchronization updates to any other connected devices
    broadcastDataMutation('all', 'sync');

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('supabase-data-sync', { detail: { table: 'all', action: 'sync' } }));
    }

    return {
      success: errors.length === 0,
      syncCount,
      errors
    };

  } catch (err: any) {
    console.error('Offline synchronization failed:', err);
    return { success: false, syncCount, errors: [err.message || JSON.stringify(err)] };
  }
}
