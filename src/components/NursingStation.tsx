import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  Plus, 
  Search,
  MoreVertical,
  Thermometer,
  Heart,
  Wind,
  Droplets,
  ClipboardList,
  Calendar,
  Download,
  Edit,
  Trash2,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabaseService } from '@/services/supabaseService';
import { useDataSync } from '@/hooks/useDataSync';

export default function NursingStation() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [vitals, setVitals] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isVitalsDialogOpen, setIsVitalsDialogOpen] = useState(false);
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [isNurseNoteOpen, setIsNurseNoteOpen] = useState(false);
  const [newTask, setNewTask] = useState({ description: '', priority: 'Low', dueTime: '', patientId: '' });
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [newVitals, setNewVitals] = useState({ bp: '', pulse: '', temp: '', spo2: '' });

  const [isAdmitDialogOpen, setIsAdmitDialogOpen] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [showPatientResults, setShowPatientResults] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [tasksData, patientsData, vitalsData, shiftsData, staffData] = await Promise.all([
      supabaseService.getNursingTasks(),
      supabaseService.getPatients(),
      supabaseService.getPatientVitals(),
      supabaseService.getNurseShifts(),
      supabaseService.getStaff()
    ]);
    if (tasksData) setTasks(tasksData);
    if (patientsData) setPatients(patientsData);
    if (vitalsData) setVitals(vitalsData);
    if (shiftsData) setShifts(shiftsData);
    if (staffData) setStaff(staffData);
    setLoading(false);
  };

  useDataSync(fetchData);

  const handleAdmitPatient = async (patientId: string) => {
    const result = await supabaseService.updatePatient(patientId, { status: 'Stable' });
    if (result) {
      toast.success('Patient admitted to ward');
      setIsAdmitDialogOpen(false);
      setPatientSearchTerm('');
      fetchData();
    } else {
      toast.error('Failed to admit patient');
    }
  };

  const toggleTaskStatus = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Pending' ? 'Completed' : 'Pending';
    const result = await supabaseService.updateNursingTask(taskId, { status: newStatus });
    if (result) {
      toast.success('Task status updated');
      fetchData();
    } else {
      toast.error('Failed to update task');
    }
  };

  const handleDeleteTask = async (id: string) => {
    const result = await supabaseService.deleteNursingTask(id);
    if (result) {
      toast.success('Task removed');
      fetchData();
    } else {
      toast.error('Failed to delete task');
    }
  };

  const handleUpdateVitals = async () => {
    if (!selectedPatientId) return;
    const result = await supabaseService.updateVitals({ ...newVitals, patient_id: selectedPatientId, recorded_at: new Date().toISOString() });
    if (result) {
      toast.success('Vitals updated successfully');
      setIsVitalsDialogOpen(false);
      setNewVitals({ bp: '', pulse: '', temp: '', spo2: '' });
      fetchData();
    } else {
      toast.error('Failed to update vitals');
    }
  };

  const handleUpdateCondition = async (patientId: string, status: string) => {
    const result = await supabaseService.updatePatient(patientId, { status });
    if (result) {
      toast.success(`Patient status updated to ${status}`);
      fetchData();
    } else {
      toast.error('Failed to update status');
    }
  };

  const handleAddTask = async () => {
    if (!newTask.description || !newTask.dueTime) {
      toast.error('Please fill in task details');
      return;
    }
    const taskData = {
      description: newTask.description,
      priority: newTask.priority,
      due_time: newTask.dueTime,
      patient_id: newTask.patientId || null,
      status: 'Pending'
    };
    const result = await supabaseService.createNursingTask(taskData);
    if (result) {
      toast.success('New task added to board');
      setIsAddTaskOpen(false);
      setNewTask({ description: '', priority: 'Low', dueTime: '', patientId: '' });
      fetchData();
    } else {
      toast.error('Failed to add task');
    }
  };

  const getStatusAnimation = (status: string) => {
    switch (status) {
      case 'High Risk': return 'animate-blink-red';
      case 'Moderate Risk': return 'animate-blink-amber';
      case 'Stable': return 'animate-glow-green';
      default: return '';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'High Risk': return 'bg-rose-500';
      case 'Moderate Risk': return 'bg-amber-500';
      case 'Stable': return 'bg-emerald-500';
      default: return 'bg-slate-300';
    }
  };

  const handleExportNursing = () => {
    const headers = ['Task', 'Due Time', 'Priority', 'Status'];
    const rows = tasks.map(t => [t.description, t.dueTime || t.due_time, t.priority, t.status]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'nursing_tasks.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Nursing tasks exported');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-medical-blue" />
        <span className="ml-2 font-medium">Loading Ward Data...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-slate-50/50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Smart Nursing Station</h1>
          <p className="text-muted-foreground">Real-time Ward Monitoring & Workflow</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleExportNursing}>
            <Download className="w-4 h-4" />
            Export Tasks
          </Button>
          
          <Dialog open={isAdmitDialogOpen} onOpenChange={setIsAdmitDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-medical-blue gap-2">
                <Plus className="w-4 h-4" />
                Admit Patient
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Admit Patient to Ward</DialogTitle>
                <DialogDescription>Search for an existing patient to admit them to a bed.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2 relative">
                  <Label>Search Patient (Name / Phone / MRN)</Label>
                  <div className="relative">
                    <Input 
                      placeholder="Start typing..." 
                      value={patientSearchTerm}
                      onChange={(e) => {
                        setPatientSearchTerm(e.target.value);
                        setShowPatientResults(true);
                      }}
                      onFocus={() => setShowPatientResults(true)}
                    />
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                  
                  {showPatientResults && patientSearchTerm.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar">
                      {patients.filter(p => 
                        (p.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) || 
                        (p.phone || '').includes(patientSearchTerm) ||
                        (p.mrn || '').toLowerCase().includes(patientSearchTerm.toLowerCase())) &&
                        p.status === 'Active'
                      ).map(p => (
                        <div 
                          key={p.id} 
                          className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                          onClick={() => handleAdmitPatient(p.id)}
                        >
                          <p className="text-sm font-bold text-slate-800">{p.name}</p>
                          <p className="text-[10px] text-slate-500 font-medium">{p.mrn} • {p.phone}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAdmitDialogOpen(false)} className="w-full">
                  Close & Go Back
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="flex gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm">
              <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></div>
              <span className="text-xs font-semibold text-slate-600">Stable</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm">
              <div className="w-2.5 h-2.5 bg-amber-500 rounded-full"></div>
              <span className="text-xs font-semibold text-slate-600">Moderate</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm">
              <div className="w-2.5 h-2.5 bg-rose-500 rounded-full"></div>
              <span className="text-xs font-semibold text-slate-600">High Risk</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg">Ward Patient Overview</CardTitle>
              <CardDescription>Real-time monitoring of admitted patients</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-6 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {patients.filter(p => p.status && !['active', 'registered', 'discharged'].includes(p.status.toLowerCase())).map((patient, idx) => {
                const patientVitals = vitals.find(v => v.patientId === patient.id || v.patient_id === patient.id);
                const riskStatus = patient.status || 'Stable';
                
                return (
                  <Card key={patient.id} className={`border-2 transition-all duration-500 ${
                    riskStatus === 'High Risk' ? 'border-rose-200 bg-rose-50/30' : 
                    riskStatus === 'Moderate Risk' ? 'border-amber-200 bg-amber-50/30' : 
                    'border-emerald-200 bg-emerald-50/30'
                  } shadow-none`}>
                    <CardContent className="p-4 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <Badge variant="outline" className="text-[10px] font-bold uppercase mb-2 bg-white">
                            BED W{idx + 1}
                          </Badge>
                          <h4 className="font-bold text-slate-800">{patient.name}</h4>
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">
                            {patient.age}, {patient.gender?.charAt(0)} | {patient.mrn}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className={`w-4 h-4 rounded-full ${getStatusColor(riskStatus)} ${getStatusAnimation(riskStatus)}`}></div>
                          <Select value={riskStatus} onValueChange={(v: string) => handleUpdateCondition(patient.id, v)}>
                            <SelectTrigger className="h-7 text-[10px] w-24">
                              <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Stable">Stable</SelectItem>
                              <SelectItem value="Moderate Risk">Moderate</SelectItem>
                              <SelectItem value="High Risk">High Risk</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                        <div className="flex items-center gap-2">
                          <Activity className="w-3.5 h-3.5 text-slate-400" />
                          <div className="text-xs">
                            <span className="text-slate-500 font-medium">BP: </span>
                            <span className="font-bold text-slate-700">{patientVitals?.bp || '--/--'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Heart className="w-3.5 h-3.5 text-slate-400" />
                          <div className="text-xs">
                            <span className="text-slate-500 font-medium">HR: </span>
                            <span className="font-bold text-slate-700">{patientVitals?.pulse || '--'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Thermometer className="w-3.5 h-3.5 text-slate-400" />
                          <div className="text-xs">
                            <span className="text-slate-500 font-medium">T: </span>
                            <span className="font-bold text-slate-700">{patientVitals?.temp || '--'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Wind className="w-3.5 h-3.5 text-slate-400" />
                          <div className="text-xs">
                            <span className="text-slate-500 font-medium">SpO2: </span>
                            <span className="font-bold text-slate-700">{patientVitals?.spo2 || '--'}%</span>
                          </div>
                        </div>
                      </div>

                      <Separator className="opacity-50" />
                      
                      <div className="flex justify-between items-center">
                        <p className="text-[9px] text-slate-400 font-medium italic">
                          Updated: {patientVitals?.updated_at ? new Date(patientVitals.updated_at).toLocaleTimeString() : 'N/A'}
                        </p>
                        <Dialog open={isVitalsDialogOpen && selectedPatientId === patient.id} onOpenChange={(v) => {
                          if (!v) setSelectedPatientId(null);
                          setIsVitalsDialogOpen(v);
                        }}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1.5 text-medical-blue hover:text-medical-blue hover:bg-blue-50" onClick={() => setSelectedPatientId(patient.id)}>
                              <Plus className="w-3 h-3" />
                              Vitals
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[400px]">
                            <DialogHeader>
                              <DialogTitle>Update Patient Vitals</DialogTitle>
                              <DialogDescription>Enter current vital signs for {patient.name}.</DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-2 gap-4 py-4">
                              <div className="space-y-2">
                                <Label>Blood Pressure</Label>
                                <Input placeholder="120/80" value={newVitals.bp} onChange={(e) => setNewVitals({...newVitals, bp: e.target.value})} />
                              </div>
                              <div className="space-y-2">
                                <Label>Pulse Rate</Label>
                                <Input placeholder="72" value={newVitals.pulse} onChange={(e) => setNewVitals({...newVitals, pulse: e.target.value})} />
                              </div>
                              <div className="space-y-2">
                                <Label>Temperature (°F)</Label>
                                <Input placeholder="98.6" value={newVitals.temp} onChange={(e) => setNewVitals({...newVitals, temp: e.target.value})} />
                              </div>
                              <div className="space-y-2">
                                <Label>SpO2 (%)</Label>
                                <Input placeholder="98" value={newVitals.spo2} onChange={(e) => setNewVitals({...newVitals, spo2: e.target.value})} />
                              </div>
                            </div>
                            <DialogFooter className="flex gap-2">
                              <Button variant="outline" onClick={() => {
                                setIsVitalsDialogOpen(false);
                                setSelectedPatientId(null);
                              }} className="flex-1">
                                Cancel
                              </Button>
                              <Button className="bg-medical-blue flex-1" onClick={handleUpdateVitals}>Save Vitals</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Shift Roster</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {shifts.map((shift) => {
                const nurse = staff.find(u => u.id === shift.nurse_id);
                return (
                  <div key={shift.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 font-bold">
                        {nurse?.name?.charAt(0) || 'N'}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-0.5">{shift.shift_type} Shift</p>
                        <p className="text-sm font-bold text-slate-800">{nurse?.name || 'Staff'}</p>
                        <p className="text-[10px] text-slate-500">{shift.ward}</p>
                      </div>
                    </div>
                    <Badge className="bg-blue-50 text-blue-600 border-none text-[10px]">Active</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-slate-900 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-white">Critical Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="py-8 flex flex-col items-center justify-center text-slate-500">
                <Activity className="w-12 h-12 mb-4 opacity-20 animate-pulse" />
                <p className="text-xs font-medium uppercase tracking-widest">System Operational</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
            <CardTitle className="text-lg">Medication Schedule</CardTitle>
            <Badge variant="secondary" className="bg-amber-50 text-amber-600 border-none">{tasks.filter(t => t.description.includes('Administer') && t.status === 'Pending').length} Pending</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[300px]">
              <div className="p-4 space-y-3">
                {tasks.filter(t => (t.description || '').includes('Administer')).map(task => (
                  <div key={task.id} className="flex items-center justify-between p-4 rounded-xl bg-white border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${task.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        <Droplets className="w-5 h-5" />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${task.status === 'Completed' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                          {task.description}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-500 uppercase">{task.dueTime || task.due_time}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant={task.status === 'Completed' ? 'ghost' : 'outline'} 
                        size="sm"
                        onClick={() => toggleTaskStatus(task.id, task.status)}
                        className={task.status === 'Completed' ? 'text-emerald-600' : 'border-slate-200'}
                      >
                        {task.status === 'Completed' ? <CheckCircle2 className="w-4 h-4" /> : 'Mark Done'}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => handleDeleteTask(task.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
            <CardTitle className="text-lg">Nursing Workflow</CardTitle>
            <Dialog open={isAddTaskOpen} onOpenChange={setIsAddTaskOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-medical-blue h-8 gap-1">
                  <Plus className="w-3 h-3" />
                  Add Task
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                  <DialogTitle>Add New Nursing Task</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input value={newTask.description} onChange={(e) => setNewTask({...newTask, description: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Time</Label>
                      <Input placeholder="e.g. 10:00 PM" value={newTask.dueTime} onChange={(e) => setNewTask({...newTask, dueTime: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={newTask.priority} onValueChange={(v) => setNewTask({...newTask, priority: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="High">High</SelectItem>
                          <SelectItem value="Medium">Medium</SelectItem>
                          <SelectItem value="Low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsAddTaskOpen(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button className="bg-medical-blue flex-1" onClick={handleAddTask}>Add Task</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[300px]">
              <div className="p-4 space-y-3">
                {tasks.filter(t => !(t.description || '').includes('Administer')).map(task => (
                  <div key={task.id} className="flex items-center justify-between p-4 rounded-xl bg-white border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${task.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                        <ClipboardList className="w-5 h-5" />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${task.status === 'Completed' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                          {task.description}
                        </p>
                        <Badge variant="outline" className={`text-[8px] font-bold uppercase mt-1 ${
                          task.priority === 'High' ? 'text-rose-600 border-rose-100 bg-rose-50' :
                          task.priority === 'Medium' ? 'text-amber-600 border-amber-100 bg-amber-50' :
                          'text-slate-600'
                        }`}>
                          {task.priority} Priority
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant={task.status === 'Completed' ? 'ghost' : 'outline'} 
                        size="sm"
                        onClick={() => toggleTaskStatus(task.id, task.status)}
                        className={task.status === 'Completed' ? 'text-emerald-600' : 'border-slate-200'}
                      >
                        {task.status === 'Completed' ? <CheckCircle2 className="w-4 h-4" /> : 'Done'}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => handleDeleteTask(task.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
