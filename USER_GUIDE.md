# AgriPOS user guide

## Start the day

Sign in with your invited staff account. If the shop requires cash registers, open **Cash registers**, choose an opening cash float and open the terminal session. Check Notifications for low stock, expiry, overdue invoices and synchronization conflicts.

## Products and stock

Create categories and select their product type. Add products with unique SKU/barcode, base sale unit, prices, tax rate and reorder levels. Category-specific attributes are shown for fertilizer, seed, plant and equipment products. A purchase unit can convert a bag/carton into base units; for example, one bag can equal 50 kg. Existing stock prevents changing the base unit.

Use **Import CSV** for up to 200 new products. Required headers are `name,sku,category,selling_price,purchase_price`; categories must already exist. Optional fields are `barcode,unit,minimum_stock,tax_percent,brand,description`. Prices use decimal LKR values. The entire file succeeds or rolls back. Duplicate SKUs are rejected rather than overwritten.

Upload product thumbnails from the catalog. The desktop converts them into small PNG files and saves them in its own local app data. To display an image on another computer, add it there too. Back up each desktop's app data to preserve its images.

Register suppliers, create purchase orders, then **Receive goods** when stock physically arrives. Record base-unit quantities, batch/lot numbers, expiry dates and optional manufacture/supplier lot details. Partial receiving is supported. Creating an order alone adds no stock.

Inventory shows batches. Use adjustments only with a business reason; damage and write-offs reduce stock. **Count stock** records expected and actual quantities and rejects a count if stock changed meanwhile. **Return to supplier** removes accepted returned goods from the original purchase batch and credits the supplier account. Supplier credit can be applied to later liabilities.

## Make a sale

Open **Point of sale**. Search by name/SKU or scan a barcode and press Enter. F2 focuses search; F4 opens payment. Choose products and adjust quantities in base units. Authorized managers can apply line discounts. Stock is consumed first-expiring-first-out and expired batches are excluded.

Select a customer for credit. Enter confirmed cash, card and bank-transfer allocations; external payments require a confirmation reference. Cash received is separate from the amount allocated to the sale and determines change. Any unpaid portion requires a customer, a due date and sufficient available credit.

Confirm once. If the response is uncertain, use **Retry identical transaction**. Do not start a replacement payment or collect money again. AgriPOS retains the original transaction ID across restart to prevent duplicate posting.

Sales history provides the original invoice, print/PDF actions and authorized returns. Return selected quantities, state the reason and whether the goods are sellable. Unpaid invoice credit is reduced first; the remaining paid portion is refunded. Confirm any external refund reference. Unsellable goods do not return to stock.

Park a cart to save it without payment or stock reservation. Resume it before checkout; prices and stock are checked again. Claimed carts belong to the employee who resumed them until completion.

## Credit, expenses and suppliers

Credit management shows customer balances. Record repayments with their payment method/reference. Repayments are allocated to the oldest due invoices and cannot exceed the account balance. Authorized staff can change credit limits.

Supplier balances increase when goods are received, decrease when payments or returns are recorded, and can show a credit balance. Enter only confirmed supplier payments. Expenses record a category, description, amount, date and cash/bank source. Cash transactions affect an open register when provided and are blocked without one when the shop requires it.

## Offline selling

While online, an administrator authorizes the terminal and the cashier prepares a 12-hour catalog snapshot and PIN in **Offline & sync**. Resolve pending online checkouts first. Switch to offline checkout or choose **Unlock offline** at login during an outage.

Offline mode permits walk-in cash sales and local receipts. No credit, discounts, card payments, returns, purchasing or catalog edits are permitted. The banner identifies the cached snapshot. Paid receipts remain in the local queue until accepted by the server.

When connectivity returns, synchronize. Conflicts remain visible and need a manager; do not delete them. Sign out and sign in online to return to live data. Prepare a fresh snapshot after all earlier receipts are accepted. See [OFFLINE_SYNC.md](OFFLINE_SYNC.md) for exact policies.

## Reports and closing

Select a business-date range in Reports. Detailed reports include product/category/employee sales, stock valuation, low stock, expiry, purchases, expenses, customer/supplier balances, cash closing, returns, movements and audit activity. Exports include CSV, Excel-compatible XML and PDF. Current stock/balance reports show current state rather than historical balances.

At closing, synchronize all offline receipts, review unresolved payments, count actual cash and close the register. AgriPOS records expected cash, counted cash and the difference. Investigate differences through cash movement and sales records rather than changing accounting history.

Settings controls shop/receipt details, logo, invoice prefix, default tax, register policy, theme, printer margins, keyboard shortcuts, your profile name and password changes according to role. Administrators can create staff usernames with initial passwords and change their access. Staff should change their initial password after first sign-in.

Purchase orders can start as drafts, be submitted for approval, approved by an authorized manager, then marked sent. Receive only approved/ordered/sent orders; partial receipts keep the remaining quantities open. Cancel unreceived orders when needed. Record supplier invoice references and due dates during receiving.

Managers can apply an order discount as well as line discounts; the order discount is allocated across lines before tax. Repark or cancel a resumed cart before starting another sale. Correct expense mistakes using **Correct**, which preserves the original expense and posts a replacement with an audit reason.

Use **More records** and **Previous records** to browse historical sales, purchases, expenses, inventory, registers and contacts. Each group loads up to 100 records; table search/sort applies to that group. Use date-filtered reports for aggregate searches and exports. Default shortcuts are F2 search, F4 payment, F6 new sale, F8 hold and F9 print; customize them in Settings.
