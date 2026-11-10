# Business rules: Asian Grocer SmartStock

The rules behind the Daily Report, the Dashboard and the photo exports. When a rule changes,
change it here and in the code listed next to it, and update the tests.

All quantities are in each item's own outer unit (box, bag, tray…), so every formula works per
item code.

## 1. Daily records

| Record | Where it comes from | Rule |
|---|---|---|
| **Closing** | Stock Close, saved at about 4 PM | One per date for the whole store. Saving a close for a date that already has one asks first, then replaces it. A report needs the closing for its date. |
| **Previous closing** | The latest saved closing **before** the report date | Not necessarily yesterday: a skipped day uses the last saved closing. |
| **Stock in** | Stock In records for the date | The **latest main** record, **plus** every record saved as an **extra delivery** (`extra_delivery: true`). Earlier main records are re-saves of the same delivery and are not added, because that would double count. |

Code: `web-app/app/api/daily-report/route.ts`, `combineStockInRecords` in `web-app/lib/report-records.ts`
(also used by the Home sales trend).

### 1a. Saving: date and same-day checks

- A new Stock In or Stock Close sheet whose date is not today asks at Save which day it is for
  (**Today** or **keep the sheet's date**). A continued draft keeps the day it was started, so
  without this a next-day count could be filed under the previous day.
- A new Stock In for a date that already has one asks: **Extra delivery** (added to that day's
  stock in) or **Same delivery, counted again** (replaces the earlier one in the report).
- Editing a saved record skips both questions.

### 1c. Shared store data

- Every account with the `admin` or `staff` role (table `user_roles`) sees and edits the whole
  store's Stock In, Stock Close and report badges. Records keep the account that saved them.
- An account with no role sees only its own records. Give new staff accounts the `staff` role.
- Migration: `web-app/supabase/migrations/20261105_shared_store_data.sql`.

### 1b. Special discount (Stock In)

- Any stock-in item can be marked **Special**: it arrived on a special discount.
- To mark it, tick **Special (discount)** before Add, or tap the tag icon before the item's name
  in the list. Tap the icon again to clear it. Re-adding an item without the tick leaves an
  existing mark alone.
- A marked item shows a soft green **SPECIAL** tag on screen and in the Stock In photo, and
  `yes` in the CSV's **Special** column.
- Saved as `special: true` on the item in the stock-in record (`event_generate.final_output`)
  and in the warehouse JSON `item_data`. Older records have no field, which means not special.
- It is information only: it doesn't change units sold, flags or refill.

Code: `special` in `itemSchema` (`web-app/lib/stock-schema.ts`); `renderDataEntryLedgerName`
in `web-app/app/page.tsx`.

### 1d. Selling prices (Catalog and Stock In)

- **What a price is.** The *selling* price of an item, in three parts: the normal price ("1 for
  $4.99"), what it is **sold by** (Each, KG, Pack, Bunch or Punnet), and any **combo deals**
  such as "2 for $9.00" or "3 for $12.00" (up to 5, one per quantity, 2 or more items).
  Shown as `$4.99 ea`, `$9.99 /kg`, and `2 for $9.00` under it. Empty means no price yet.
- **Where to set it.** Catalog → Edit item / New item (Selling price), or **Quick prices**: every
  item in one list, type the price, pick what it is sold by, tap **Add deal** for a combo; Enter
  saves and moves to the next item. **Missing price** shows only unpriced items. Editing other
  fields of an item never clears its price.
- **Stock In.** Every row has a **Price** cell starting at the catalog price. Tap it to change the
  price, unit or deals for this delivery. The same can be done while adding: pick the item, then
  the **Selling price** box under Quantity (order: item, quantity, price, special, note, Add item; Add item asks to confirm a changed price) (it shows the current system price, then sold-by first and the price next to it; no change = the delivery keeps the current price, a change = the new price) (price, sold by, deals). The name column shows only the name and the note; the
  "Up from ..." text is on the price sheet, the photo and History. The photo, History preview and CSV show the same.
  Stock Close has no prices.
- **Price change.** A row whose price differs from the catalog price it started from is highlighted
  (soft yellow) with a note: **Up from $4.99 ea**, **Down from ...**, **Changed from ...** (the unit
  or a deal changed), or **New price**. Items typed in by name have nothing to compare with, so they
  are never highlighted.
- **Packs have a weight.** Sold by Pack asks for the pack weight (a dropdown: 500g, 730g, 1kg, or Other: type the grams) before the price and
  shows it (`$3.99 /250g pack`). A different weight is a price change ("Changed from ..."); the CSV
  Sold By reads `Pack 250g`. Stored in `catalog_items.price_pack_g` (migration 20261111).
- **Kept note.** The saved record keeps `sell` (price, unit, deals) and `catalog_sell` (the catalog
  price it started from) on each counted item, so a reopened Stock In still shows what changed.
- **Saving updates the catalog.** Saving sets the catalog price of each changed item (price, unit
  and deals) and says how many. A price is only replaced while the catalog still holds the price
  and unit the row started from, so re-saving an old Stock In, or two phones changing the same
  item, never puts an older price back. Re-saving a corrected record also works: the catalog may
  hold the price this same record put there the last time. Only counted rows change the catalog,
  and editing an item's other details in the Catalog never resends its price. A cleared price never clears the catalog. A failed catalog
  update never fails the save.
- **Save and photo are one button.** Save stores the Stock In and then downloads its photo. If
  the photo cannot be made, the record is still saved and the sheet stays open: Save again to
  retry the photo.
- **CSV.** Export CSV ends with **Price**, **Sold By**, **Deals** (`2 for 9.00; 3 for 12.00`) and
  **Catalog Price**.
- Prices are information only: they don't change units sold, flags or refill.

Code: `web-app/lib/stock-price.ts` (format, change rule), `lib/catalog-prices.ts` (catalog update on
save), `SellPriceEditor.tsx`, `catalog/QuickPriceEntry.tsx`, `api/catalog/prices`.
Migrations: `web-app/supabase/migrations/20261109_catalog_price.sql` and
`20261110_catalog_sell_price_unit_deals.sql`.

**Sources row.** The Daily Report and Dashboard show which records were used: the closing, the
previous closing and the stock in, each with its date, name and saved time (`created_at` for a
closing, which is when it was first saved; `log_time` for stock in). When there are several
stock-in records it says "latest of N". Code: `ReportSources.tsx`.

## 2. Units sold

```
units sold (total)   = previous closing + stock in since then − closing
units sold (per day) = total ÷ days between the two closings
```

- **Stock in** counts every Stock In dated after the previous closing, up to the report date.
  Each date is combined on its own (latest main save + extra deliveries), then the dates are
  added. Example: closing on Thursday, delivery on Friday with no closing, closing on Saturday:
  the Saturday report uses Thursday's closing + Friday's and Saturday's stock in.
- **Days** = calendar days from the previous closing to this one (Thu → Sat = 2). When it is
  more than 1, every sold figure in the app is the **daily average, rounded up to a whole
  unit** (12.5 → 13, 13.33 → 14; a negative miscount rounds away from zero, −2.5 → −3):
  - Daily Report (screen and photo): the column reads "Sold / per day" and the sheet says
    "Sold is a daily average over 2 days (Fri, 6 Nov – Sat, 7 Nov), since the closing on Thu, 5 Nov."
  - Dashboard: "Units sold a day" with the total in the note ("28 over 2 days"); rankings,
    category bars, refill table and the photo header use the daily figure.
  - Welcome: "units sold a day" with "2-day average … · 28 in total".
  - Badge picker: "Sold 2 a day (4 over 2 days)".
- Badges use the daily figure, so cover stays "days of stock left" (§3). Total units sold is
  the sum of the totals ÷ days, not a sum of rounded averages.

| Status | When | What the report shows |
|---|---|---|
| `ok` | The formula gives 0 or more | The sold figure |
| `no-baseline` | The item has no previous closing | `-`. A missing previous closing is never treated as 0, which would invent a large sale. |
| `negative` | Closing is higher than previous closing + stock in (a miscount or a missing stock-in) | The negative figure (e.g. `−2`) in amber |
| `no-closing` | The item is not on the closing | Nothing |

`ok` and `negative` items count towards **total units sold**, so a miscount one day and its
correction the next net out. Only `ok` items count towards rankings, top sellers and charts.
Negative items get an amber warning in the report notes naming them (first three, then
"and N more") and asking staff to check the counts. The notes row reads "N items to check"
in amber while folded. The report notes also say how many items show `-`.

Code: `computeItemInsight` in `web-app/lib/report-insights.ts`.

### 2b. Current stock

```
current = closing + stock in saved after the closing date, up to today
```

- Counted only while no later closing exists. Once the next Stock Close is saved, that day's
  report takes over and its closing already includes the stock in.
- Each later date's stock in is combined on its own (latest main save + extra deliveries).
- On the newest report the stock column is **Current** and the sheet is titled "Current stock";
  it says which day's stock in was added. Units sold stays the closing day's figure until
  today's closing is saved. Older dates show **Closing** as before.
- An item that arrived after the closing but is not on it gets its own row tagged **New**,
  with current = what arrived and sold shown as `-`.
- Live: when anyone saves or changes a Stock In or Stock Close, Welcome, Daily Report and
  Dashboard reload by themselves (Supabase realtime; also on returning to the app).
- Stock flags, refill hints, "Stock left" and "Products in hand" use current stock, so a
  morning delivery clears yesterday's Stock-out at once.

Code: `arrivedSince` / `current` in `web-app/lib/report-insights.ts`; `combineStockInByDate`
in `web-app/lib/report-records.ts`; `today` parameter of `/api/daily-report`.

## 3. Stock flags

**Cover** = current stock (§2b) ÷ units sold (how many days today's pace would last).
Rules are checked in this order; the first match wins:

| Flag | Rule | Colour |
|---|---|---|
| **Stock-out** | closing = 0 | Brick `#B53C2B`, white text |
| **No sell today** | stock left and units sold = 0 | Mustard text, no fill |
| **Low stock** | cover **< 3** | Orange `#A8561F`, white text |
| **Over-stock** | cover **> 7** | Violet `#3E2BB5`, white text |
| *(none)* | cover from 3 to 7 | No badge |

- Stock-out needs only the closing, so it also applies to items without a reliable sold figure.
  Low stock and Over-stock need a reliable (`ok`) sold figure.
- Cover exactly 3 or exactly 7 gets no flag.
- The three action flags are solid fills of similar darkness so they read as one set:
  brick 5.8:1, orange 5.2:1, violet 9.5:1 contrast with the white text.

Code: `getStockFlag` in `web-app/lib/report-insights.ts`; colours in
`web-app/app/components/StockFlagBadge.tsx`.

### 3-. Fruit and Vegies

Fruit and Vegies are two sections of one store, counted and received separately.

- **Which section an item is in:** catalog items with location `Vegies` are vegies; every other
  item (and anything unclassified) is fruit. Code: `web-app/lib/sections.ts`.
- **Records are per section.** Each Stock Close and Stock In record belongs to one section
  (`section` column, default `fruit`, so old records are fruit). There is one close per date
  **per section**: saving a vegies close never replaces the fruit close, and each section
  uses its own previous closing and its own Stock In. Migration `20261112_section_fruit_vegies.sql`
  must be applied before the app version that saves a section is deployed.
- **Choosing a section:** a Fruit / Vegies / Both choice, remembered on the device, is shared by
  Stock Close, Stock In, Daily Report, Dashboard and Home. The entry screens ask on their start
  screen, before any entry, in a pop-up when Start new is tapped: Stock Close asks "What are you
  counting?" (Fruit or Vegies, because two people count separately); Stock In asks "What arrived?"
  (Fruit, Vegies or Both, because one person usually enters the whole delivery). The start screen
  shows the section on screen with a Change link that opens the same pop-up (to see the other section's draft). Each section has its own draft on the phone. A saved record
  opened from history opens in its own section.
- **Stock In with Both** is one sheet but saves one record per section (fruit and vegies). A section
  with nothing counted gets no record. The "Stock In already saved for this day" question only looks
  at records of the same section(s), so a fruit delivery does not ask about a vegies one.
- **Both** (reports and dashboard): the two sections are loaded and shown together. Each item's sold
  figure uses its own section's previous closing, so a missed vegies day does not change fruit.
  If one section has no closing for the date, the other still reports and a note says which is missing.
- **Big categories of vegies:** a vegie item's `sub_location` is its big category (Leafy & Salad,
  Cabbage & Brassica, Stalks & Shoots, Beans & Peas, Fruiting Veg, Capsicum & Chilli, Gourds Pumpkin
  & Squash, Mushrooms, Root & Starchy, Potato & Sweet Potato, Onion Garlic & Ginger, Herbs Leaf &
  Citrus). On Stock Close, Stock In and the Daily Report, vegies appear as a "Vegies" area with one
  headed section per big category, like the coolroom sections. Other categories can be typed in the catalog.
- **Same rules for now:** sold, current, stock-out/low/over-stock badges all work the same for
  both sections. Vegies use the catalog units (kg, bunch, box) until changed.
- **Warehouse (BigQuery):** vegies are not sent; their records live in Supabase only.
- The exported photo is the section(s) on screen: `daily-fruit-<date>.png`, `daily-vegies-<date>.png`
  or `daily-both-<date>.png`.

### 3a. Filtering the Daily Report by badge

- Chips under the search: All, Stock-out, Low stock, No sell, Over-stock, No badge, each with
  its count. Several can be on at once; All clears them.
- The filter applies to the screen and to the exported photo. The sheet header then says
  "Showing Stock-out, Low stock · 3 of 120 items". The search box narrows the screen only.

### 3b. Changing a badge by hand

- On the Daily Report, tap an item to open its badge picker. The choices are:
  - **Automatic:** the calculated flag, with the reason (for example `18 left ÷ 2 sold = 9 days, over 7`);
  - any of the four flags;
  - **No badge**.
- One tap saves and closes. The choice applies to that item **on that date only**.
- A badge set or removed by hand shows a small pencil mark on screen. Exported photos show the
  badge without the mark.
- The choice is used everywhere the flag is: the Daily Report, the Dashboard flag counts, the
  refill list and the photos.
- Choosing Automatic deletes the choice, so the calculated flag shows again.
- Stored in Supabase table `report_flag_override` (migration
  `20261104_report_flag_overrides.sql`). No row means automatic; `flag = null` means no badge.
  Until the migration is applied, the report works as before and tapping an item explains
  what's missing.

Code: `applyFlagOverrides` and `describeAutoFlag` in `web-app/lib/report-insights.ts`;
`/api/daily-report/flags`; `FlagPickerSheet.tsx`.

## 4. Refill for tomorrow

- Lists **Stock-out** and **Low stock** items only.
- Order:
  1. Stock-out first, best sellers first.
  2. Then Low stock, least cover first.
  3. Ties: most sold first, then by name.
- Columns: Item, Closing, Sold (`–` when there's no reliable figure), Status (the flag badge).
- The screen lists every item. The owner's photo keeps the 12 most urgent and says how many
  more there are.

Code: `refillList` in `web-app/lib/report-aggregations.ts`.

## 5. Top contributors (the "half of sales" line)

- Walk down the products, best seller first, adding up units sold. Every product up to and
  including the one that takes the running total to **50%** of the day's units sold is a top
  contributor.
- The same rule marks the top categories. "Other" never counts as a top category.
- Charts show a line under the last top contributor: "NN% of sales above this line".

Code: `rankProductsBySales` and `TOP_CONTRIBUTION_SHARE` in
`web-app/lib/report-aggregations.ts`; `topCategoryLabels` in
`web-app/app/components/DailyReportSummary.tsx`.

## 6. Dashboard summary

| Figure | Rule |
|---|---|
| **Units sold** | Sum of units sold over `ok` and `negative` items (see §2) |
| **Stock in today** | Sum of stock in over all items |
| **Top selling category** | The category with the most units sold, with its share of sales |
| **Stock left** | Sum of closing over all items (negatives count as 0) |
| **Products in hand** | Number of items with closing above 0 |
| **Top selling products** | Every `ok` item, ranked by units sold. Bars are scaled to the day's best seller. |
| **Sales by category** | The nine biggest categories, plus "Other" for the rest (always last) |

Colour shows what to read first: **units sold** (forest green and the strongest bars), then
**contribution** (brand green, for the half-of-sales items), then **stock left** (violet, the
quietest).

Code: `web-app/lib/report-aggregations.ts` and
`web-app/app/components/DailyReportSummary.tsx`.

## 6b. Home screen

The app opens on Home. Tap the logo to come back to it; on desktop it's also at the top of the
sidebar.

- **Yesterday** means the phone's calendar day before today.
- **Units sold:** yesterday's figure, using the formula in §2. The change shown is against the
  day before.
- **7-day chart:** units sold for each of the last 7 days, worked out the same way. A day with
  no closing, or no earlier closing, shows a flat line.
- **Tiles:** stock in, the top seller with its share of sales, and the Stock-out and Low stock
  counts. Badges changed by hand count. Tapping a flag tile opens yesterday's Daily Report.
- **Today:**
  - Daily Report shows "ready" when yesterday's closing exists.
  - Stock in shows "Saved" when today's stock-in exists.
  - Stock close shows "Saved" when today's closing exists, otherwise "Due 4 PM", or "Due now"
    after 4 PM.
- **Up next:** Stock in until today's stock-in is saved, then Stock close until today's
  closing is saved, then Daily Report.

Code: `HomePanel.tsx`; `/api/daily-report/trend` with `buildSalesTrend` in
`web-app/lib/report-records.ts`.

## 7. Report notices

Shown above the Daily Report and Dashboard, in one light box with the Sources row.

- **Always visible** (they stop the figures):
  - no closing saved for the date;
  - no earlier closing, so units sold can't be worked out.
- **Folded into one "notes" row** (warnings listed first, in amber):
  - sold below zero for some items (see §2);
  - no stock-in record for the date (sold then assumes nothing arrived);
  - several stock-in records (the latest is used);
  - how many items show `-` or `?`.

Code: `notices` in `web-app/app/components/useDailyReportData.ts`.

## 8. Before a closing is saved (Check Stock → Save)

An item is **expected** on the closing when either is true:
- it had stock at the previous closing (the latest one before the sheet's date), or
- stock arrived for it on the sheet's date (the latest Stock In record).

If an expected item is **blank**, **0** or **not on the sheet**, Save stops and lists it:
"last + arrived → now", for example `5 + 3 in → blank`. Staff either count it (**Fix counts**)
or confirm the 0 is right (**Save anyway**).

- Blanks are listed first, then zeros, each by area and name.
- Hidden catalog items and items removed from the catalog are not asked about.
- A code on two rows counts as counted if either row has a number.
- Free-typed (unknown) items are compared with the last validated sheet instead, by name.
- Offline, or if the check can't load within 6 seconds, catalog items are compared with the last
  validated sheet in history, without stock-in.

Code: `findUncountedItems` in `web-app/lib/closing-completeness.ts`; `buildSaveWarnings` and
`handleSave` in `web-app/app/components/EmbeddedStockCheckPanel.tsx`.

### 8b. Type and Photo on Check Stock

- Switching between **Type** and **Photo** never clears the sheet.
- A parsed photo is merged into the sheet:
  - a count that is still blank is filled from the photo;
  - a count already on the sheet is **kept**, even when the photo read a different number, and
    the message says how many were kept;
  - items only the photo has are added.
- Rows match by catalog code, or by name (ignoring case and spacing) for free-typed items.
- Stock In has no photo entry: deliveries are always typed.

Code: `mergePhotoRows` in `web-app/lib/photo-merge.ts`.

## 9. Kept in code, not shown

- **ORDER flag and suggested quantity**: units sold − closing, rounded up. An item is ORDER when
  that is above 0, or it sold out. It is no longer shown in the refill list but still counts in
  `summary.itemsToOrder`.
- **Selling fast**: units sold is at least 80% of what was available (`FAST_SELL_THROUGH`).
