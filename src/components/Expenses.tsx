import { useState, useEffect } from 'react';
import { 
  TrendingDown, 
  Search, 
  Plus, 
  Filter, 
  MoreVertical, 
  Calendar,
  ArrowDownRight,
  PieChart as PieChartIcon,
  Wallet,
  Receipt,
  Download,
  Edit,
  Trash2,
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
import { supabaseService } from '@/services/supabaseService';
import { useDataSync } from '@/hooks/useDataSync';
import { storage, STORAGE_KEYS } from '@/lib/storage';
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
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { toast } from 'sonner';

export default function Expenses() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [newExpense, setNewExpense] = useState({ 
    expense_date: new Date().toISOString().split('T')[0], 
    category: 'Utilities', 
    description: '', 
    amount: 0,
    status: 'Paid'
  });
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [isEditExpenseOpen, setIsEditExpenseOpen] = useState(false);

  const currentUser = storage.get(STORAGE_KEYS.SESSION_USER, null);
  const [users, setUsers] = useState<any[]>(() => {
    return storage.get(STORAGE_KEYS.USERS, []);
  });

  useEffect(() => {
    supabaseService.getStaff().then(data => {
      if (data && data.length > 0) {
        setUsers(data);
      }
    });
  }, []);

  const isAddedByAdmin = (record: any) => {
    if (!record) return false;
    const creatorId = record.created_by || record.issued_by || record.createdBy;
    if (!creatorId) {
      // Legacy seeded expense with no creator are treated as admin-seeded
      return true;
    }
    if (creatorId === 'u2' || creatorId === 'u-admin' || creatorId === 'u-admingh') return true;
    const creatorUser = users?.find((u: any) => u.id === creatorId || u.email === creatorId);
    if (creatorUser && (creatorUser.role === 'SUPER_ADMIN' || creatorUser.role === 'ADMIN')) return true;
    return false;
  };

  const canModify = (record: any) => {
    if (currentUser?.role === 'SUPER_ADMIN') return true;
    return !isAddedByAdmin(record);
  };

  const fetchExpenses = async () => {
    setIsLoading(true);
    const data = await supabaseService.getExpenses();
    if (data) {
      setExpenses(data);
    }
    setIsLoading(false);
  };

  useDataSync(fetchExpenses);

  const handleAddExpense = async () => {
    if (!newExpense.description || !newExpense.amount) {
      toast.error('Please fill in required fields');
      return;
    }

    const expenseData = {
      ...newExpense,
      created_by: currentUser?.id || 'u-accounts'
    };

    const result = await supabaseService.createExpense(expenseData);
    if (result) {
      toast.success('Expense recorded');
      fetchExpenses();
      setNewExpense({ 
        expense_date: new Date().toISOString().split('T')[0], 
        category: 'Utilities', 
        description: '', 
        amount: 0,
        status: 'Paid'
      });
      setIsAddExpenseOpen(false);
    } else {
      toast.error('Failed to record expense');
    }
  };

  const handleUpdateExpense = async () => {
    if (!editingExpense || !editingExpense.description || !editingExpense.amount) {
      toast.error('Please fill in required fields');
      return;
    }

    if (!canModify(editingExpense)) {
      toast.error('This expense record was created by administration and cannot be modified by non-admin roles.');
      return;
    }

    const { id, created_at, ...updates } = editingExpense;
    const result = await supabaseService.updateExpense(id, {
      expense_date: updates.expense_date,
      category: updates.category,
      description: updates.description,
      amount: Number(updates.amount),
      status: updates.status,
      created_by: editingExpense.created_by || editingExpense.issued_by
    });

    if (result) {
      toast.success('Expense record updated');
      fetchExpenses();
      setEditingExpense(null);
      setIsEditExpenseOpen(false);
    } else {
      toast.error('Failed to update expense record');
    }
  };

  const handleDeleteExpense = async (id: string) => {
    const roleUpper = (currentUser?.role || '').toUpperCase();
    if (roleUpper === 'RECEPTIONIST' || roleUpper === 'RECEPTION' || roleUpper === 'FRONT_DESK' || roleUpper === 'DOCTOR' || roleUpper === 'SURGEON' || roleUpper === 'ACCOUNTANT' || roleUpper === 'ACCOUNTS') {
      toast.error('Deletion of expense records is restricted for Front Office, Doctor, and Accountant roles.');
      return;
    }
    const expenseToDelete = expenses.find(e => e.id === id);
    if (expenseToDelete && !canModify(expenseToDelete)) {
      toast.error('This expense record was created by administration and cannot be deleted by non-admin roles.');
      return;
    }

    const success = await supabaseService.deleteExpense(id);
    if (success) {
      toast.success('Expense record removed');
      fetchExpenses();
    } else {
      toast.error('Failed to remove expense record');
    }
  };

  const handleExportExpenses = () => {
    const headers = ['Date', 'Category', 'Description', 'Amount', 'Status'];
    const rows = expenses.map(e => [
      e.expense_date,
      e.category,
      e.description,
      e.amount,
      e.status
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'hospital_expenses.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Expenses exported as CSV');
  };

  const filteredExpenses = expenses.filter(e => 
    (e.description?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (e.category?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const totalMonthly = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const utilityBills = expenses
    .filter(e => e.category === 'Utilities')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const pendingVouchers = expenses.filter(e => e.status === 'Pending').length;

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-medical-blue" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expense Management</h1>
          <p className="text-muted-foreground">Track daily hospital expenses and operational costs.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleExportExpenses}>
            <Download className="w-4 h-4" />
            Export Expenses
          </Button>
          <Dialog open={isAddExpenseOpen} onOpenChange={setIsAddExpenseOpen}>
            <DialogTrigger asChild>
              <Button className="bg-medical-blue gap-2" onClick={() => setIsAddExpenseOpen(true)}>
                <Plus className="w-4 h-4" />
                Add New Expense
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Record New Expense</DialogTitle>
                <DialogDescription>Enter details for a new hospital expense.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Expense Category</Label>
                  <Select 
                    value={newExpense.category}
                    onValueChange={(v) => setNewExpense({...newExpense, category: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Utilities">Utilities (Electricity, Water)</SelectItem>
                      <SelectItem value="Medical Supplies">Medical Supplies</SelectItem>
                      <SelectItem value="Maintenance">Maintenance & Repairs</SelectItem>
                      <SelectItem value="Salary">Staff Salaries</SelectItem>
                      <SelectItem value="Other">Other Operational Costs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input 
                    placeholder="e.g. Generator Fuel" 
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({...newExpense, description: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Amount (₹)</Label>
                    <Input 
                      type="number" 
                      placeholder="0.00" 
                      value={newExpense.amount || ""}
                      onChange={(e) => setNewExpense({...newExpense, amount: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input 
                      type="date" 
                      value={newExpense.expense_date}
                      onChange={(e) => setNewExpense({...newExpense, expense_date: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Payment Status</Label>
                  <Select 
                    value={newExpense.status}
                    onValueChange={(v) => setNewExpense({...newExpense, status: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Paid">Paid</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddExpenseOpen(false)}>Cancel</Button>
                <Button className="bg-medical-blue" onClick={handleAddExpense}>Add Expense</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isEditExpenseOpen} onOpenChange={setIsEditExpenseOpen}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Edit Expense Record</DialogTitle>
                <DialogDescription>Modify the details of this hospital expense.</DialogDescription>
              </DialogHeader>
              {editingExpense && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Expense Category</Label>
                    <Select 
                      value={editingExpense.category}
                      onValueChange={(v) => setEditingExpense({...editingExpense, category: v})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Utilities">Utilities (Electricity, Water)</SelectItem>
                        <SelectItem value="Medical Supplies">Medical Supplies</SelectItem>
                        <SelectItem value="Maintenance">Maintenance & Repairs</SelectItem>
                        <SelectItem value="Salary">Staff Salaries</SelectItem>
                        <SelectItem value="Other">Other Operational Costs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input 
                      placeholder="e.g. Generator Fuel" 
                      value={editingExpense.description || ""}
                      onChange={(e) => setEditingExpense({...editingExpense, description: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Amount (₹)</Label>
                      <Input 
                        type="number" 
                        placeholder="0.00" 
                        value={editingExpense.amount || ""}
                        onChange={(e) => setEditingExpense({...editingExpense, amount: Number(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input 
                        type="date" 
                        value={editingExpense.expense_date}
                        onChange={(e) => setEditingExpense({...editingExpense, expense_date: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Status</Label>
                    <Select 
                      value={editingExpense.status}
                      onValueChange={(v) => setEditingExpense({...editingExpense, status: v})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Paid">Paid</SelectItem>
                        <SelectItem value="Pending">Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setEditingExpense(null);
                  setIsEditExpenseOpen(false);
                }}>Cancel</Button>
                <Button className="bg-medical-blue" onClick={handleUpdateExpense}>Save Changes</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Total Expenses (Month)</p>
              <h3 className="text-3xl font-bold text-rose-600">{formatCurrency(totalMonthly)}</h3>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 text-rose-600">
              <TrendingDown className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Utility Bills</p>
              <h3 className="text-3xl font-bold text-blue-600">{formatCurrency(utilityBills)}</h3>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
              <Wallet className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Pending Vouchers</p>
              <h3 className="text-3xl font-bold text-amber-600">{pendingVouchers}</h3>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600">
              <Receipt className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">Expense Log</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search expense..." 
                className="pl-10 bg-slate-50 border-none h-9" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="h-9">
              <Filter className="w-4 h-4 mr-2" />
              Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-slate-100">
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">Category</TableHead>
                  <TableHead className="whitespace-nowrap">Description</TableHead>
                  <TableHead className="whitespace-nowrap">Amount</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id} className="border-slate-50">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(expense.expense_date)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px] font-bold uppercase">{expense.category}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium whitespace-nowrap">{expense.description}</TableCell>
                    <TableCell className="font-bold whitespace-nowrap">{formatCurrency(expense.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="secondary" className={`border-none ${
                        expense.status === 'Paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {expense.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2 items-center">
                        {canModify(expense) ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-medical-blue" onClick={() => {
                              setEditingExpense({...expense});
                              setIsEditExpenseOpen(true);
                            }}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            {(() => {
                              const r = (currentUser?.role || '').toUpperCase();
                              return !(r === 'RECEPTIONIST' || r === 'RECEPTION' || r === 'FRONT_DESK' || r === 'DOCTOR' || r === 'SURGEON' || r === 'ACCOUNTANT' || r === 'ACCOUNTS');
                            })() && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => handleDeleteExpense(expense.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] text-slate-400 bg-slate-100 font-bold hover:bg-slate-100 select-none px-2 py-0.5">Admin Locked</Badge>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
