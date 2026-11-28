import { branches, type Branch } from '@agripos/shared';
import { FormDialog } from './FormDialog';
import { toast } from 'sonner';
export function ShopConnectionDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  return (
    <FormDialog
      title="Connect your shop"
      description="Enter your Neon cloud connection once. AgriPOS saves your shop on this computer automatically, so the same username, password and features work without internet. For a new shop only, choose an initial administrator password."
      initial={{branch:'Kuruwita'}}
      fields={[
        {name:'branch',label:'Stock location for this till',type:'select',required:true,options:branches.map(value=>({value,label:value}))},
        {
          name: 'databaseUrl',
          label: 'Neon cloud database URL',
          type: 'password',
          required: true,
          hint: 'Your cloud URL is protected by Windows secure storage. No local database setup is needed.',
        },
        {
          name: 'adminPassword',
          label: 'Initial admin password (new database)',
          type: 'password',
        },
        { name: 'shopName', label: 'Shop name (new database)' },
        { name: 'existingStaffId', label: 'Existing administrator staff ID (existing shop)' },
      ]}
      onClose={onClose}
      onSave={async (values) => {
        await window.desktop.configure({
          branch: values.branch as Branch,
          databaseUrl: values.databaseUrl!,
          ...(values.adminPassword ? { adminPassword: values.adminPassword } : {}),
          ...(values.shopName ? { shopName: values.shopName } : {}),
          ...(values.existingStaffId ? { existingStaffId: values.existingStaffId } : {}),
        });
        await onSaved();
        toast.success('Shop connection saved');
      }}
    />
  );
}
