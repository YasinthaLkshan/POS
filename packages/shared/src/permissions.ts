export const permissions = [
  'catalog.read',
  'catalog.write',
  'cost.read',
  'price.write',
  'inventory.write',
  'purchases.write',
  'sales.write',
  'discount.approve',
  'refund.write',
  'customers.write',
  'credit.manage',
  'payments.write',
  'expenses.write',
  'reports.read',
  'profit.read',
  'staff.manage',
  'settings.write',
] as const;
export type Permission = (typeof permissions)[number];
export const roleNames = [
  'administrator',
  'manager',
  'cashier',
  'inventory',
  'daily_sales',
] as const;
export type Role = (typeof roleNames)[number];
const matrix: Record<Role, readonly Permission[]> = {
  administrator: permissions,
  manager: permissions.filter((p) => !['staff.manage', 'settings.write'].includes(p)),
  daily_sales: ['catalog.read', 'sales.write'],
  cashier: ['catalog.read', 'sales.write', 'customers.write', 'payments.write'],
  inventory: ['catalog.read', 'catalog.write', 'cost.read', 'inventory.write', 'purchases.write'],
};
export const can = (role: Role, permission: Permission) => matrix[role].includes(permission);
export const permissionsFor = (role: Role) => [...matrix[role]];
export const branches = ['Kuruwita', 'Parakaduwa'] as const;
export type Branch = (typeof branches)[number];
export interface Actor {
  branch?: Branch;
  id: string;
  shopId: string;
  name: string;
  role: Role;
}
