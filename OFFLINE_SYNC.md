# Local SQLite and Neon synchronization

Version 0.7.2 adds a **Work offline** checkbox on Login and Cloud sync. Enable it after the first shop download to pause all cloud synchronization while keeping normal login and features. The selection persists across restart. Turn it off to resume synchronization. Internet outages still fall back to local operation automatically when this switch is off.

AgriPOS 0.7 runs the same API and business rules on SQLite in both online and offline use. There is one login and no offline PIN. SQLite uses WAL and full synchronous commits. A serialized transaction queue prevents local commands from interleaving inside a transaction. Accounting history remains immutable.

Neon stores the complete shop, including credentials as password hashes, role permissions, products, images, inventory, sales, credit, repayments, purchases and reports' source data. Local session tokens and failed-login counters are not synchronized.

Synchronization compares a durable baseline with local and cloud snapshots. With no local changes, it downloads the cloud version atomically. With local changes and an unchanged cloud baseline, it applies a row delta in one PostgreSQL transaction. A lost acknowledgement is detected by comparing the cloud result with the local snapshot, so retrying does not duplicate sales. A cloud transaction failure leaves local changes queued. Imports use a SQLite transaction and foreign-key validation.

When both sides changed, synchronization pauses with an explicit conflict and preserves both sides. This release is for a single active POS, with synchronization before switching computers; it does not promise automatic concurrent multi-till merging. Full snapshots are currently compared each cycle, so synchronization is intended for small shop datasets.

Use Cloud sync to see pending work and the last successful synchronization. A disconnected computer uses its last synchronized credentials and access roles. New installations require one successful online initialization.
