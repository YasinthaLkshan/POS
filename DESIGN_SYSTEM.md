# Design system

The desktop prioritizes working space and readable financial tables. The main layout uses a collapsible dark sidebar, compact top bar, page heading, cards and tables. Navigation is filtered by server-provided permissions; server services independently enforce the same permission matrix.

## Tokens

The source of truth is `apps/desktop/src/styles/app.css`.

| Role        | Light-theme starting value |
| ----------- | -------------------------- |
| Primary     | `#17634A`                  |
| Sidebar     | `#102620`                  |
| Background  | `#F6F8F7`                  |
| Surface     | `#FFFFFF`                  |
| Main text   | `#17251F`                  |
| Muted text  | `#64736D`                  |
| Border      | `#E4EAE6`                  |
| Success     | `#21845B`                  |
| Information | `#3578B5`                  |
| Warning     | `#D38A21`                  |
| Danger      | `#C73535`                  |

Dark mode uses charcoal-green surfaces and light text with the same semantic statuses. Theme choices are light, dark or system. Avoid relying on color alone: alerts include text, labels and, where useful, icons.

## Components

- `PageHeading`: page title, explanation and primary action.
- `QueryState`: loading, retryable failure and content states.
- `Table`: local search, sorting, pagination and empty state over the supplied result set.
- `FormDialog`: Radix modal, React Hook Form, Zod validation, field labels, submission state and unsaved-change confirmation.
- `Badge`: compact textual status with success, danger, warning or neutral styling.
- `ProductImage`: restricted PNG data URLs with a catalog icon fallback.

The repository includes a shadcn-compatible component configuration and a small Radix-based UI package; it does not contain an unmodified full shadcn component catalog. Forms and tables are application-specific reusable components.

Use integer money/quantity values in data contracts and shared formatting functions in the UI. Every action must have a real handler; failed API writes remain visible. Offline mode must visibly identify cached stock and pending synchronization. Destructive accounting changes use reasoned, auditable compensating operations rather than deletion.

## Desktop behavior

The minimum window size is 1000 × 700. Tables scroll within available width. POS prioritizes catalog search and the current cart. F2 focuses barcode/product search and F4 opens payment. Barcode scanners are expected to operate as keyboard-wedge devices ending with Enter; hardware-specific drivers remain external.

Accessibility uses native inputs/buttons, explicit field labels, focus-managed Radix dialogs and keyboard-operable controls. A full independent accessibility audit has not been performed.
