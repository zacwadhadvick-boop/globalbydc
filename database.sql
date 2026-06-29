-- FULL DATABASE SCHEMA FOR HOSPITAL MANAGEMENT SYSTEM
-- Compatible with PostgreSQL / Supabase

-- Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    department TEXT,
    specialized_in TEXT,
    avatar_url TEXT,
    consultation_fee DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Patients Table
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    mrn TEXT UNIQUE NOT NULL,
    age INTEGER,
    gender TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    attending_doctor_id UUID REFERENCES profiles(id),
    blood_group TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    appointment_date TIMESTAMP WITH TIME ZONE NOT NULL,
    doctor_id UUID REFERENCES profiles(id),
    department TEXT,
    type TEXT DEFAULT 'General',
    status TEXT DEFAULT 'Scheduled',
    fee DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    invoice_number TEXT UNIQUE,
    total_amount DECIMAL(10,2) DEFAULT 0.00,
    discount_amount DECIMAL(10,2) DEFAULT 0.00,
    paid_amount DECIMAL(10,2) DEFAULT 0.00,
    payment_status TEXT DEFAULT 'Unpaid',
    payment_method TEXT,
    type TEXT, -- e.g., 'OPD', 'IPD', 'Pharmacy', 'Lab'
    status TEXT DEFAULT 'Pending',
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invoice Items Table
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2) DEFAULT 0.00,
    total_price DECIMAL(10,2) DEFAULT 0.00,
    category TEXT, -- e.g., 'Consultation', 'Medicine', 'Lab Test'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pharmacy Inventory Table
CREATE TABLE IF NOT EXISTS pharmacy_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    category TEXT DEFAULT 'Medicine', -- Medicine, Surgical, Consumable
    unit TEXT DEFAULT 'Tablets',
    hsn_code TEXT,
    rack_number TEXT,
    batch_number TEXT,
    expiry_date DATE,
    stock INTEGER DEFAULT 0,
    mrp DECIMAL(10,2) DEFAULT 0.00,
    selling_price DECIMAL(10,2) DEFAULT 0.00,
    purchase_price DECIMAL(10,2) DEFAULT 0.00,
    tax_percentage DECIMAL(5,2) DEFAULT 12.00,
    min_stock_level INTEGER DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lab Tests Master Table
CREATE TABLE IF NOT EXISTS lab_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    category TEXT, -- Pathology, Radiology
    price DECIMAL(10,2) DEFAULT 0.00,
    reference_range TEXT,
    unit TEXT,
    sample_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pathology Test Requests Table
CREATE TABLE IF NOT EXISTS test_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    test_name TEXT NOT NULL,
    status TEXT DEFAULT 'Ordered', -- Ordered, Processing, Completed
    result_value TEXT,
    reference_range TEXT,
    unit TEXT,
    urgency TEXT DEFAULT 'Routine',
    requested_by UUID REFERENCES profiles(id),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Radiology Records Table
CREATE TABLE IF NOT EXISTS radiology_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    test_name TEXT NOT NULL,
    status TEXT DEFAULT 'Ordered', -- Ordered, Completed
    result_notes TEXT,
    image_url TEXT,
    urgency TEXT DEFAULT 'Routine',
    requested_by UUID REFERENCES profiles(id),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Beds Table
CREATE TABLE IF NOT EXISTS beds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bed_number TEXT NOT NULL,
    ward TEXT NOT NULL,
    category TEXT, -- General, Semi-Private, Private, ICU
    status TEXT DEFAULT 'Available',
    patient_id UUID REFERENCES patients(id) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admissions Table
CREATE TABLE IF NOT EXISTS admissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    bed_id UUID REFERENCES beds(id),
    admission_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    discharge_date TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'Admitted', -- Admitted, Discharged
    diagnosis TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vitals Table
CREATE TABLE IF NOT EXISTS patient_vitals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    temp DECIMAL(4,2),
    pulse INTEGER,
    bp TEXT,
    spo2 INTEGER,
    rr INTEGER,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Clinical & Nursing Notes Table
CREATE TABLE IF NOT EXISTS clinical_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    note_type TEXT, -- Doctor's Note, Nursing Note, Progress Note
    content TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Operation Theatre Schedules
CREATE TABLE IF NOT EXISTS ot_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    operation_name TEXT,
    procedure_name TEXT,
    operation_date DATE,
    scheduled_date DATE,
    surgery_date DATE,
    start_time TIME,
    end_time TIME,
    scheduled_time TIME,
    surgery_time TIME,
    surgeon_id UUID REFERENCES profiles(id),
    anesthetist_id UUID REFERENCES profiles(id),
    room_id UUID, -- References ot_rooms
    ot_rooms_id UUID,
    ot_number TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Scheduled',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Maternity Delivery Records
CREATE TABLE IF NOT EXISTS maternity_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    delivery_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivery_type TEXT, -- Normal, LSCS, Forceps
    outcome TEXT, -- Healthy, Stillbirth
    gender TEXT,
    birth_weight DECIMAL(4,2),
    surgeon_id UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insurance Claims Table
CREATE TABLE IF NOT EXISTS insurance_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    insurance_provider TEXT NOT NULL,
    policy_number TEXT NOT NULL,
    claim_amount DECIMAL(12,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(12,2) DEFAULT 0.00,
    expense_date DATE DEFAULT CURRENT_DATE,
    payment_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
