import { storage, STORAGE_KEYS } from '@/lib/storage';

export function isUserAdmin(user: any): boolean {
  if (!user) return false;
  const role = (user.role as string || '').toUpperCase();
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HOSPITAL_ADMIN' || role.includes('ADMIN');
}

export function isRecordCreatedByAdmin(record: any, allUsers?: any[]): boolean {
  if (!record) return false;
  
  // Seed/fallback structures or IDs that are administrative
  const seedIds = ['bill1', 'bill2', 'bill3', 'bill4', 'bill5', 'exp-1', 'exp-2', 'exp-3', 'apt1', 'apt2', 'apt3', 'pat1', 'pat2', 'pat3'];
  if (record.id && (seedIds.includes(String(record.id)) || String(record.id).startsWith('seed-'))) return true;

  const creatorId = record.created_by || record.issued_by || record.createdBy || record.userId || record.recorded_by || record.doctor_id || record.doctorId || record.nurse_id || record.nurseId || record.surgeon_id || record.surgeonId;
  if (!creatorId) {
    // If no creator info, do not block unless we explicitly suspect it's seed data or legacy
    return false;
  }
  
  // Known Admin IDs
  const adminIds = ['u2', 'u-admin', 'u-admingh', 'admingh'];
  if (adminIds.includes(String(creatorId))) return true;

  // Find creator in the user list
  const usersList = allUsers || storage.get(STORAGE_KEYS.USERS, []);
  const creatorUser = usersList.find((u: any) => u.id === creatorId || u.email === creatorId || u.username === creatorId);
  if (creatorUser && isUserAdmin(creatorUser)) {
    return true;
  }

  return false;
}

export function canUserModifyRecord(record: any, currentUser?: any, allUsers?: any[]): boolean {
  return true;
}
