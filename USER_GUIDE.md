# AgriPOS user guide

## Start the day

Sign in with your invited staff account. If the shop requires cash registers, open **Cash registers**, choose an opening cash float and open the terminal session. Check Notifications for low stock, expiry, overdue invoices and synchronization conflicts.

## Products and stock

Create categories and select their product type. Add products with unique SKU/barcode, base sale unit, prices, tax rate and reorder levels. Category-specific attributes are shown for fertilizer, seed, plant and equipment products. A purchase unit can convert a bag/carton into base units; for example, one bag can equal 50 kg. Existing stock prevents changing the base unit.

Use **Import CSV** for up to 200 new products. Required headers are `name,sku,category,selling_price,purchase_price`; categories must already exist. Optional fields are `barcode,unit,minimum_stock,tax_percent,brand,description`. Prices use decimal LKR values. The entire file succeeds or rolls back. Duplicate SKUs are rejected rather than overwritten.

Upload product thumbnails from the catalog. The desktop converts them into small PNG files and saves them in its own local app data. To display an image on another computer, add it there too. Back up each desktop's app data to preserve its images.

Register suppliers, create purchase orders, then **Receive goods** when stock physically arrives. Record base-unit quantities, batch/lot numbers, expiry dates and optional manufacture/supplier lot details. Partial receiving is supported. Creating an order alone adds no stock.

Inventory shows batches. Use adjustments only with a business reason; damage and write-offs reduce stock. **Count stock** records expected and actual quantities and rejects a count if stock changed meanwhile. **Return to supplier** removes accepted returned goods from the original purchase batch and credits the supplier account. Supplier credit can be applied to later liabilities.

## Factories and lorry drivers

Open **Factories**, click **Add factory**, and enter the name (address, phone and notes are optional). Type part of a name in the search box to find it; **View drivers** shows every driver registered under that factory with their balances, upcoming and overdue payments and sales history. **Print report** prints the factory's driver credit.

Open **Lorry drivers** and click **Add driver**. Choose the factory and enter the name, lorry number and phone. Each driver gets a permanent ID such as `DRV-0001`. Search by name, driver ID, lorry number, phone or factory. A driver's **Profile** shows total purchases, credit issued and repaid, the outstanding balance, dues by month, every installment, invoice and payment, and **Print statement**. Each driver's debt is their own; a factory only groups drivers.

## Products with sizes

For fertilizer sold loose and in sealed bags, click **Products > Add product with sizes**. Enter the product name and category, then one row per size (for example Loose per kg, 25 kg bag, 50 kg bag) with its SKU, selling price, optional cost, reorder level and the **driver discount per unit**. Each size has its own price and stock. Loose kg can be sold in decimals (0.5, 1.25); bags only in whole numbers.

To open a bag for loose sale, use the convert button on the bag row (**Open bag / convert stock**). This reduces bag stock and adds the loose kilograms in one recorded movement. Use **Receive stock** on Products or Inventory to add stock without a purchase order, and the history button to see every movement with before and after quantities.

## Make a sale

Open **Point of sale**. Search by name/SKU or scan a barcode and press Enter. F2 focuses search; F4 opens payment. Choose products and adjust quantities in base units. Authorized managers can apply line discounts. Stock is consumed first-expiring-first-out and expired batches are excluded.

Choose the customer type at the top of the cart:

- **Walk-in**: pay in full.
- **Lorry driver**: search by name, factory or lorry number. Driver discounts for each size are applied automatically (for example Rs. 10 per 25 kg bag × 3 bags = Rs. 30). In **Take payment**, enter the cash paid now; the rest becomes credit with two monthly installments by default. You can change the dates and amounts before confirming; month-end dates are handled (31 January → 28/29 February).
- **Credit customer**: for a known local customer without a profile. Enter the name, optional phone and the agreed repayment date (default one month). To add to someone's existing unpaid record, search for it; otherwise a new record is created so people with the same name are never mixed up.

Managers can add a bill discount (whole-invoice LKR amount) and line discounts; for drivers it is added on top of the automatic discounts. Enter confirmed cash, card and bank-transfer allocations; external payments require a confirmation reference. Cash received is separate from the amount allocated to the sale and determines change. Any unpaid portion requires a customer, a due date and sufficient available credit.

Confirm once. If the response is uncertain, use **Retry identical transaction**. Do not start a replacement payment or collect money again. AgriPOS retains the original transaction ID across restart to prevent duplicate posting.

Sales history provides the original invoice, print/PDF actions and authorized returns. Return selected quantities, state the reason and whether the goods are sellable. Unpaid invoice credit is reduced first; the remaining paid portion is refunded. Confirm any external refund reference. Unsellable goods do not return to stock.

Park a cart to save it without payment or stock reservation. Resume it before checkout; prices and stock are checked again. Claimed carts belong to the employee who resumed them until completion.

## Credit, expenses and suppliers

**Credit management** lists every unpaid installment, drivers and normal customers together: overdue first (red), then due today and due soon (amber), then upcoming. Filter by customer type, factory or status, or search by name, invoice, phone or lorry. The “due soon” window is set in Settings (default 7 days).

Click **Record payment** to take a full or partial payment. The dialog shows exactly which installment(s) will be paid and what remains before you confirm; by default the oldest due installment is paid first, or you can apply the payment to the selected installment. A partly paid installment shows **part paid** and its remaining amount; when fully paid it leaves the unpaid list and stays in history as Paid. Print or save the payment receipt afterwards. Payments can never exceed what is owed.

Returns on a credit invoice reduce its latest installments first, so the nearest due dates stay unchanged.

Supplier balances increase when goods are received, decrease when payments or returns are recorded, and can show a credit balance. Enter only confirmed supplier payments. Expenses record a category, description, amount, date and cash/bank source. Cash transactions affect an open register when provided and are blocked without one when the shop requires it.

## Offline selling

When the internet is down, keep working normally: every till uses the shop database on the main shop computer, so all features stay available. The steps below are only for a till that cannot reach the main computer at all.

While connected, an administrator authorizes the terminal and the cashier prepares a 12-hour catalog snapshot and PIN in **Offline & sync**. Resolve pending online checkouts first. Switch to offline checkout or choose **Unlock offline** at login during an outage.

Offline mode permits walk-in cash sales and local receipts. No credit, discounts, card payments, returns, purchasing or catalog edits are permitted. The banner identifies the cached snapshot. Paid receipts remain in the local queue until accepted by the server.

When connectivity returns, synchronize. Conflicts remain visible and need a manager; do not delete them. Sign out and sign in online to return to live data. Prepare a fresh snapshot after all earlier receipts are accepted. See [OFFLINE_SYNC.md](OFFLINE_SYNC.md) for exact policies.

## Daily business

**Daily business** shows one business day (or a range): gross sales before discounts, driver and bill discounts, returns, net sales, fully paid, credit and mixed sales, cash from new sales, cash from credit repayments, refunds, net cash collected, new credit and the outstanding, overdue and due-today totals. Credit repayments are cash received, never counted as new sales. **Print end-of-day summary** prints it; the dashboard shows today's figures from the same calculation.

## Reports and closing

Select a business-date range in Reports. Detailed reports include product/category/employee sales, stock valuation, low stock, expiry, purchases, expenses, customer/supplier balances, cash closing, returns, movements and audit activity. Exports include CSV, Excel-compatible XML and PDF. Current stock/balance reports show current state rather than historical balances.

At closing, synchronize all offline receipts, review unresolved payments, count actual cash and close the register. On the main shop computer, check **Settings > Backup and recovery** and click **Back up now** before shutting down. AgriPOS records expected cash, counted cash and the difference. Investigate differences through cash movement and sales records rather than changing accounting history.

Settings controls credit defaults (driver installments and months, normal customer period, due-soon days), the next invoice number, lorry driver discounts per size, shop/receipt details, logo, invoice prefix, default tax, register policy, theme, printer margins, keyboard shortcuts, your profile name and password changes according to role. Administrators can create staff usernames with initial passwords and change their access. Staff should change their initial password after first sign-in.

Purchase orders can start as drafts, be submitted for approval, approved by an authorized manager, then marked sent. Receive only approved/ordered/sent orders; partial receipts keep the remaining quantities open. Cancel unreceived orders when needed. Record supplier invoice references and due dates during receiving.

Managers can apply an order discount as well as line discounts; the order discount is allocated across lines before tax. Repark or cancel a resumed cart before starting another sale. Correct expense mistakes using **Correct**, which preserves the original expense and posts a replacement with an audit reason.

Use **More records** and **Previous records** to browse historical sales, purchases, expenses, inventory, registers and contacts. Each group loads up to 100 records; table search/sort applies to that group. Use date-filtered reports for aggregate searches and exports. Default shortcuts are F2 search, F4 payment, F6 new sale, F8 hold and F9 print; customize them in Settings.
