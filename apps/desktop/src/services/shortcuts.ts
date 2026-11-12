export const shortcutKeys = ['F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9'] as const;
export const defaultShortcuts = {
  search: 'F2',
  payment: 'F4',
  newSale: 'F6',
  hold: 'F8',
  print: 'F9',
};
export function shortcuts(): typeof defaultShortcuts {
  try {
    const stored = JSON.parse(localStorage.getItem('agripos-shortcuts') ?? 'null') as Record<
      string,
      string
    > | null;
    if (
      stored &&
      Object.keys(defaultShortcuts).every((k) =>
        shortcutKeys.includes(stored[k] as (typeof shortcutKeys)[number]),
      ) &&
      new Set(Object.values(stored)).size === 5
    )
      return stored as typeof defaultShortcuts;
  } catch {
    /* Restore defaults for invalid local preferences. */
  }
  return defaultShortcuts;
}
