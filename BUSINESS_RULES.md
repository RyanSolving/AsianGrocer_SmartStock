# Business rules: Asian Grocer SmartStock

The rules behind the Daily Report, the Dashboard and the photo exports. When a rule changes,
change it here and in the code listed next to it, and update the tests.

All quantities are in each item's own outer unit (box, bag, tray…), so every formula works per
item code.

## 1. Daily records

| Record | Where it comes from | Rule |
|---|---|---|
| **Closing** | Check Stock, saved at about 4 PM | One per date. A report needs the closing for its date. |
| **Previous closing** | The latest saved closing **before** the report date | Not necessarily yesterday: a skipped day uses the last saved closing. |
| **Stock in** | Stock In records for the date | If several exist, the **latest** one is used. They are never added together, because a re-entered record would double count. |

Code: `web-app/app/api/daily-report/route.ts`.

## 2. Units sold

```
units sold = previous closing + stock in − closing
```

| Status | When | What the report shows |
|---|---|---|
| `ok` | The formula gives 0 or more | The sold figure |
| `no-baseline` | The item has no previous closing | `-`. A missing previous closing is never treated as 0, which would invent a large sale. |
| `negative` | Closing is higher than previous closing + stock in (a counting error or a missing stock-in) | `?` |
| `no-closing` | The item is not on the closing | Nothing |

Only `ok` items count towards totals, rankings and charts. The report notes say how many items
show `-` or `?`.

Code: `computeItemInsight` in `web-app/lib/report-insights.ts`.

## 3. Stock flags

**Cover** = closing ÷ units sold (how many days today's pace would last).
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
| **Units sold** | Sum of units sold over `ok` items |
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

## 7. Report notices

Shown above the Daily Report and Dashboard.

- **Always visible** (they stop the figures):
  - no closing saved for the date;
  - no earlier closing, so units sold can't be worked out.
- **Folded into one "notes" row**:
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

## 9. Kept in code, not shown

- **ORDER flag and suggested quantity**: units sold − closing, rounded up. An item is ORDER when
  that is above 0, or it sold out. It is no longer shown in the refill list but still counts in
  `summary.itemsToOrder`.
- **Selling fast**: units sold is at least 80% of what was available (`FAST_SELL_THROUGH`).
