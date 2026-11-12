import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'date' | 'number' | 'textarea' | 'select';
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  min?: number;
  step?: string;
}
export function FormDialog({
  title,
  description,
  fields,
  initial = {},
  onSave,
  onClose,
  onFieldChange,
  children,
  submitLabel = 'Save changes',
}: {
  title: string;
  description?: string;
  fields: Field[];
  initial?: Record<string, string>;
  onSave: (values: Record<string, string>) => Promise<unknown>;
  onClose: () => void;
  onFieldChange?: (name: string, value: string) => void;
  children?: ReactNode;
  submitLabel?: string;
}) {
  const schema = z.object(
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        f.required ? z.string().trim().min(1, `${f.label} is required`) : z.string(),
      ]),
    ),
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Record<string, string>>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? ''])),
  });
  const [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const close = () => {
    if (isSubmitting) return;
    if (isDirty) setConfirm(true);
    else onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          onInteractOutside={(e) => {
            if (isSubmitting) e.preventDefault();
          }}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ?? 'Enter the details below. Fields marked * are required.'}
              </Dialog.Description>
            </div>
            <button
              className="icon-btn"
              aria-label="Close form"
              disabled={isSubmitting}
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <form
            onSubmit={handleSubmit(async (values) => {
              setError('');
              try {
                await onSave(values);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Unable to save');
              }
            })}
          >
            {children}
            <div className="form-grid">
              {fields.map((f) => (
                <label key={f.name} className={f.type === 'textarea' ? 'full' : ''}>
                  {f.label}
                  {f.required ? ' *' : ''}
                  {f.type === 'select' ? (
                    <select
                      {...register(f.name, {
                        onChange: (event: { target: { value: string } }) =>
                          onFieldChange?.(f.name, event.target.value),
                      })}
                    >
                      <option value="">Select…</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea {...register(f.name)} rows={3} />
                  ) : (
                    <input
                      defaultValue={initial[f.name] ?? ''}
                      {...register(f.name)}
                      type={f.type ?? 'text'}
                      min={f.min}
                      step={f.step ?? 'any'}
                      autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                    />
                  )}{' '}
                  {f.hint && <small className="muted">{f.hint}</small>}
                  {errors[f.name] && (
                    <small className="error-text">{String(errors[f.name]?.message)}</small>
                  )}
                </label>
              ))}
            </div>
            {error && (
              <div role="alert" className="alert danger">
                {error}
              </div>
            )}
            {confirm && (
              <div className="alert warning">
                Discard unsaved changes?
                <button type="button" className="btn secondary" onClick={onClose}>
                  Discard
                </button>
                <button type="button" className="btn secondary" onClick={() => setConfirm(false)}>
                  Keep editing
                </button>
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={isSubmitting}
                onClick={close}
              >
                Cancel
              </button>
              <button className="btn" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
