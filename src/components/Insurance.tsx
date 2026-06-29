import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, 
  Search, 
  Filter, 
  Download, 
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  FileCheck,
  UserCheck,
  User,
  Printer,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabaseService } from '@/services/supabaseService';
import { useDataSync } from '@/hooks/useDataSync';

export default function Insurance() {
  const navigate = useNavigate();
  const [insuranceRecords, setInsuranceRecords] = useState<any[]>([]);
  const [dischargeRecords, setDischargeRecords] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [hospitalInfo, setHospitalInfo] = useState<any>({
    name: 'GLOBAL HOSPITAL',
    address: '123 Healthcare Way, Medical City',
    phone: '+91 98765 43210',
    email: 'accounts@dcglobal.com',
    logo: null
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewClaimOpen, setIsNewClaimOpen] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [showPatientResults, setShowPatientResults] = useState(false);
  const [newClaim, setNewClaim] = useState({
    patientId: '',
    policyNo: '',
    insuranceCompany: '',
    tpaName: '',
    insuranceLimit: '',
    date: new Date().toISOString().split('T')[0]
  });

  const fetchData = async () => {
    setLoading(true);
    const [insuranceData, patientsData, hospitalData] = await Promise.all([
      supabaseService.getInsuranceClaims(),
      supabaseService.getPatients(),
      supabaseService.getHospitalInfo()
    ]);
    if (insuranceData) setInsuranceRecords(insuranceData);
    if (patientsData) setPatients(patientsData);
    if (hospitalData) setHospitalInfo(hospitalData);
    
    // Mocking discharge from patient status
    if (patientsData) {
      setDischargeRecords(patientsData.filter(p => (p.status || '').toLowerCase() === 'discharge' || (p.status || '').toLowerCase() === 'waiting').map(p => ({
        id: p.id,
        patientId: p.id,
        name: p.name,
        nurseVerification: 'Verified',
        accountantVerification: p.billing_status === 'Paid' ? 'Verified' : 'Pending'
      })));
    }
    setLoading(false);
  };

  useDataSync(fetchData);

  const handleCreateClaim = async () => {
    if (!newClaim.patientId || !newClaim.policyNo) {
      toast.error('Please fill in required fields');
      return;
    }
    const claimData = {
      patient_id: newClaim.patientId,
      policy_no: newClaim.policyNo,
      insurance_company: newClaim.insuranceCompany,
      tpa_name: newClaim.tpaName,
      insurance_limit: parseFloat(newClaim.insuranceLimit || '0'),
      status: 'Pending',
      claim_date: newClaim.date,
      approved_amount: 0
    };

    const result = await supabaseService.createInsuranceClaim(claimData);
    if (result) {
      toast.success('Insurance claim initiated');
      setIsNewClaimOpen(false);
      fetchData();
    } else {
      toast.error('Failed to create claim');
    }
  };

  const handleDeleteClaim = async (id: string) => {
    if (confirm('Are you sure you want to delete this insurance claim?')) {
      const result = await supabaseService.deleteInsuranceClaim(id);
      if (result) {
        toast.success('Claim removed');
        fetchData();
      } else {
        toast.error('Failed to delete claim');
      }
    }
  };

  const printDischargeSummary = (record: any) => {
    const patient = patients.find(p => p.id === record.patientId);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Discharge Summary - ${record.name}</title>
          <style>
            @page { margin: 0; }
            body { font-family: sans-serif; margin: 0; padding: 40px; color: #333; }
            .hospital-info { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2563eb; padding-bottom: 15px; }
            .title { text-align: center; font-size: 22px; font-weight: bold; text-decoration: underline; margin-bottom: 30px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 30px; border: 1px solid #eee; padding: 15px; border-radius: 8px; font-size: 14px; }
            .section { margin-bottom: 25px; }
            .section-title { font-weight: bold; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; color: #1E6FA8; }
            .text { font-size: 14px; line-height: 1.6; }
            .footer { margin-top: 80px; display: flex; justify-content: space-between; border-top: 1px solid #eee; padding-top: 20px; }
            .signature { text-align: center; width: 220px; font-size: 12px; }
            .sig-line { border-top: 1px solid #333; margin-top: 50px; padding-top: 5px; }
          </style>
        </head>
        <body>
          <div class="content">
            <div class="hospital-info">
              ${hospitalInfo.logo_url ? `<img src="${hospitalInfo.logo_url}" style="height: 60px; margin-bottom: 10px;" /><br/>` : ''}
              <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${hospitalInfo.name}</div>
              <div>${hospitalInfo.address}</div>
              <div>Contact: ${hospitalInfo.phone} | Email: ${hospitalInfo.email}</div>
            </div>
            <div class="title">DISCHARGE SUMMARY</div>
            <div class="grid">
              <div><strong>Patient Name:</strong> ${record.name}</div>
              <div><strong>MRN:</strong> ${patient?.mrn || 'N/A'}</div>
              <div><strong>Age / Gender:</strong> ${patient?.age || '--'} / ${patient?.gender || '--'}</div>
              <div><strong>Patient ID:</strong> ${record.patientId?.substring(0, 8).toUpperCase()}</div>
              <div><strong>Discharge Date:</strong> ${new Date().toLocaleDateString()}</div>
            </div>
            <div class="section">
              <div class="section-title">Condition at Discharge</div>
              <div class="text">Patient is hemodynamically stable, afebrile, and tolerating oral diet.</div>
            </div>
            <div class="footer">
              <div class="signature"><div class="sig-line">Patient / Relative Signature</div></div>
              <div class="signature"><div class="sig-line">Authorized Signatory / RMO</div></div>
              <div class="signature"><div class="sig-line">Consultant Signature</div></div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Approved': return 'bg-emerald-50 text-emerald-600';
      case 'Pending': return 'bg-amber-50 text-amber-600';
      case 'Rejected': return 'bg-rose-50 text-rose-600';
      default: return 'bg-slate-50 text-slate-600';
    }
  };

  const filteredInsurance = insuranceRecords.filter(record => {
    const patient = patients.find(p => p.id === record.patientId);
    return (
      (patient?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (record.policyNo || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (patient?.mrn || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-medical-blue" />
        <span className="ml-2 font-medium">Loading Insurance Records...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Insurance & TPA Management</h1>
          <p className="text-muted-foreground">Manage insurance claims, TPA approvals, and discharge clearances.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export List
          </Button>
          <Dialog open={isNewClaimOpen} onOpenChange={(open) => {
            setIsNewClaimOpen(open);
            if (!open) {
              setPatientSearchTerm('');
              setShowPatientResults(false);
              setNewClaim({
                patientId: '',
                policyNo: '',
                insuranceCompany: '',
                tpaName: '',
                insuranceLimit: '',
                date: new Date().toISOString().split('T')[0]
              });
            }
          }}>
            <DialogTrigger asChild>
              <Button className="bg-medical-blue gap-2" onClick={() => setIsNewClaimOpen(true)}>
                <Plus className="w-4 h-4" />
                New Insurance Claim
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>New Insurance Claim</DialogTitle>
                <DialogDescription>Initiate a new TPA/Insurance claim for a patient.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2 relative">
                  <Label>Patient (Search by Name or Phone)</Label>
                  <div className="relative">
                    <Input 
                      placeholder="Start typing name or phone..." 
                      value={patientSearchTerm}
                      onChange={(e) => {
                        setPatientSearchTerm(e.target.value);
                        setShowPatientResults(true);
                        if (e.target.value === '') {
                          setNewClaim({...newClaim, patientId: ''});
                        }
                      }}
                      onFocus={() => setShowPatientResults(true)}
                    />
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                  
                  {showPatientResults && patientSearchTerm.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar">
                      {patients.filter(p => 
                        p.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) || 
                        (p.phone || '').includes(patientSearchTerm)
                      ).length > 0 ? (
                        patients.filter(p => 
                          p.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) || 
                          (p.phone || '').includes(patientSearchTerm)
                        ).map(p => (
                          <div 
                            key={p.id} 
                            className="px-4 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center border-b border-slate-100 last:border-0"
                            onClick={() => {
                              setNewClaim({...newClaim, patientId: p.id});
                              setPatientSearchTerm(p.name);
                              setShowPatientResults(false);
                            }}
                          >
                            <div>
                              <p className="text-sm font-medium">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground">{p.phone} • MRN: {p.mrn}</p>
                            </div>
                            {newClaim.patientId === p.id && <CheckCircle2 className="w-4 h-4 text-medical-blue" />}
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-center text-sm text-muted-foreground">
                          No patients found.
                        </div>
                      )}
                    </div>
                  )}

                  {newClaim.patientId && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded-md flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                        <User className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-blue-700 truncate">
                          {patients.find(pat => pat.id === newClaim.patientId)?.name}
                        </p>
                        <p className="text-[10px] text-blue-600 truncate">
                          Ph: {patients.find(pat => pat.id === newClaim.patientId)?.phone} • MRN: {patients.find(pat => pat.id === newClaim.patientId)?.mrn}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Policy Number</Label>
                    <Input 
                      placeholder="Enter policy no." 
                      value={newClaim.policyNo}
                      onChange={(e) => setNewClaim({...newClaim, policyNo: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Claim Date</Label>
                    <Input 
                      type="date" 
                      value={newClaim.date}
                      onChange={(e) => setNewClaim({...newClaim, date: e.target.value})}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Insurance Company</Label>
                    <Input 
                      placeholder="e.g. Star Health" 
                      value={newClaim.insuranceCompany}
                      onChange={(e) => setNewClaim({...newClaim, insuranceCompany: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>TPA Name</Label>
                    <Input 
                      placeholder="e.g. MediAssist" 
                      value={newClaim.tpaName}
                      onChange={(e) => setNewClaim({...newClaim, tpaName: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Insurance Limit (₹)</Label>
                  <Input 
                    type="number" 
                    placeholder="0.00" 
                    value={newClaim.insuranceLimit}
                    onChange={(e) => setNewClaim({...newClaim, insuranceLimit: e.target.value})}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsNewClaimOpen(false)}>Cancel</Button>
                <Button className="bg-medical-blue" onClick={handleCreateClaim}>Submit Claim</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-medical-blue/5 border-b border-medical-blue/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-medical-blue" />
              <CardTitle className="text-lg text-medical-blue">Insurance Claims</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="Search by Patient or Policy..." 
                  className="pl-10 bg-white border-slate-200 h-9" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent bg-slate-900">
                  <TableHead className="text-white font-bold whitespace-nowrap">Patient</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">Policy No</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">Insurance Company</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">TPA Name</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">Limit</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">Approved</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">Status</TableHead>
                  <TableHead className="text-white font-bold whitespace-nowrap">Date</TableHead>
                  <TableHead className="text-white font-bold text-right whitespace-nowrap">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInsurance.map((record) => {
                  const patient = patients.find(p => p.id === record.patientId);
                  return (
                    <TableRow key={record.id} className="border-slate-50">
                      <TableCell className="font-medium text-xs">
                        <div className="flex flex-col">
                          <span className="font-bold">{patient?.name || 'Unknown'}</span>
                          <span className="text-[10px] text-muted-foreground">{patient?.mrn || 'N/A'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{record.policyNo}</TableCell>
                      <TableCell className="text-xs">{record.insuranceCompany}</TableCell>
                      <TableCell className="text-xs">{record.tpaName}</TableCell>
                      <TableCell className="text-xs font-semibold">{formatCurrency(record.insuranceLimit)}</TableCell>
                      <TableCell className="text-xs font-bold text-emerald-600">{formatCurrency(record.approvedAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="secondary" className={`text-[10px] border-none ${getStatusColor(record.status)}`}>
                          {record.status === 'Approved' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : 
                           record.status === 'Pending' ? <Clock className="w-3 h-3 mr-1" /> : 
                           <AlertCircle className="w-3 h-3 mr-1" />}
                          {record.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(record.date || record.claim_date)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-medical-blue" title="Patient 360 Overview" onClick={() => navigate(`/patient-overview?id=${record.patientId}`)}>
                            <UserCheck className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => handleDeleteClaim(record.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredInsurance.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No insurance claims found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Initiates Discharge List</CardTitle>
          <CardDescription>Patients waiting for final clearance from nursing and accounts.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-slate-100">
                  <TableHead className="whitespace-nowrap">Name</TableHead>
                  <TableHead className="whitespace-nowrap">ID / MRN</TableHead>
                  <TableHead className="whitespace-nowrap">Nurse Verification</TableHead>
                  <TableHead className="whitespace-nowrap">Accountant Verification</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dischargeRecords.map((record) => {
                   const patient = patients.find(p => p.id === record.patientId);
                   return (
                  <TableRow key={record.id} className="border-slate-50">
                    <TableCell className="font-medium text-sm whitespace-nowrap">{record.name}</TableCell>
                    <TableCell className="font-bold text-medical-blue text-xs whitespace-nowrap">
                       {patient?.mrn || record.patientId.substring(0, 8).toUpperCase()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className={`gap-1.5 ${record.nurseVerification === 'Verified' ? 'text-emerald-600 border-emerald-100 bg-emerald-50' : 'text-amber-600 border-amber-100 bg-amber-50'}`}>
                        <UserCheck className="w-3 h-3" />
                        {record.nurseVerification}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className={`gap-1.5 ${record.accountantVerification === 'Verified' ? 'text-emerald-600 border-emerald-100 bg-emerald-50' : 'text-amber-600 border-amber-100 bg-amber-50'}`}>
                        <FileCheck className="w-3 h-3" />
                        {record.accountantVerification}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" className="text-medical-blue h-8" onClick={() => printDischargeSummary(record)}>
                          <Printer className="w-3.5 h-3.5 mr-1.5" />
                          Summary
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
                {dischargeRecords.length === 0 && (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No patients initiated for discharge</TableCell>
                   </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
