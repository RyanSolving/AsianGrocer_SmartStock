import { forwardRef } from 'react'

import { formatSheetDate } from '../../lib/stock-paper-utils'
import { BrandTile } from './BrandMark'

export type PhotoRow = {
  key: string
  name: string
  quantity: string
  /** Text colour for rows that need a second look (missing or unknown items). */
  tone?: 'warning' | 'alert'
  /** Marked as selling fast: a red dot and red name, as on the paper sheet. */
  marked?: boolean
  /** Stock In: arrived on a special discount. */
  special?: boolean
  /** Stock In: short staff note for this item. */
  note?: string
  /** Stock In: price of one unit as text ("$24.50"; empty when none). Undefined = no price column. */
  price?: string
  /** Stock In: combo deals as text ("2 for $9.00"), shown under the price. */
  priceDeals?: string
  /** Stock In: why the price is highlighted, e.g. "Up from $20.00". */
  priceNote?: string
  /** Stock In: the price differs from the catalog price. */
  priceChanged?: boolean
}

export type PhotoGroup = { title?: string; rows: PhotoRow[] }

type LedgerPhotoSheetProps = {
  title: string
  date: string
  /** Header of the number column, e.g. "Stock in". */
  quantityLabel: string
  insideLeft: PhotoGroup[]
  insideRight: PhotoGroup[]
  outside: PhotoRow[]
  unknown: PhotoRow[]
  /** Vegies by big category, in two columns (right may be empty). */
  vegiesLeft?: PhotoGroup[]
  vegiesRight?: PhotoGroup[]
  /** `list`: one long, phone-width column (Stock In). `columns` (default): two columns. */
  layout?: 'columns' | 'list'
}

const TONE_CLASS: Record<NonNullable<PhotoRow['tone']>, string> = {
  warning: 'text-warning',
  alert: 'font-semibold text-red-600',
}

function PhotoTable({ groups, quantityLabel }: { groups: PhotoGroup[]; quantityLabel: string }) {
  const visible = groups.filter((group) => group.rows.length > 0)
  if (visible.length === 0) return null

  return (
    <table className="report-ledger">
      <colgroup><col /><col className="report-number-column" /></colgroup>
      <thead><tr><th scope="col">Item</th><th scope="col">{quantityLabel}</th></tr></thead>
      {visible.map((group, index) => (
        <tbody key={group.title ?? `rows-${index}`}>
          {group.title ? <tr><th scope="rowgroup" colSpan={2} className="report-category">{group.title}</th></tr> : null}
          {group.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <div className="report-name">
                  {row.marked ? <span aria-label="Selling fast" role="img" className="h-2 w-2 shrink-0 rounded-full bg-danger" /> : null}
                  <span className={row.marked ? 'font-semibold text-red-600' : row.tone ? TONE_CLASS[row.tone] : undefined}>{row.name}</span>
                  {row.special ? <span className="report-tag report-tag-special">Special</span> : null}
                </div>
                {row.note ? <p className="photo-list-note">{row.note}</p> : null}
              </th>
              <td className="font-semibold">{row.quantity}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  )
}

function TwoColumns({ title, left, right, quantityLabel }: { title: string; left: PhotoGroup[]; right: PhotoGroup[]; quantityLabel: string }) {
  return (
    <>
      <h3 className="report-area-title">{title}</h3>
      <div className="report-photo-columns">
        {[left, right].map((groups, index) => (
          <div className="report-photo-column" key={index}>
            <PhotoTable groups={groups} quantityLabel={quantityLabel} />
            <div className="report-photo-rules" aria-hidden="true" />
          </div>
        ))}
      </div>
    </>
  )
}

function toNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** "STONE FRUIT" -> "Stone fruit" (category titles arrive in capitals). */
function sentenceCase(value: string) {
  const lower = value.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function formatTotal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function RowName({ row }: { row: PhotoRow }) {
  return (
    <span className="report-name">
      {row.marked ? <span aria-label="Selling fast" role="img" className="h-2 w-2 shrink-0 rounded-full bg-danger" /> : null}
      <span className={row.marked ? 'font-semibold text-red-600' : row.tone ? TONE_CLASS[row.tone] : undefined}>{row.name}</span>
      {row.special ? <span className="report-tag report-tag-special">Special</span> : null}
    </span>
  )
}

/** One area of the long-list photo: a bar with the area's total, then light category labels. */
function ListArea({ title, groups, showPrices }: { title: string; groups: PhotoGroup[]; showPrices: boolean }) {
  const visible = groups.filter((group) => group.rows.length > 0)
  if (visible.length === 0) return null
  const total = visible.reduce((sum, group) => sum + group.rows.reduce((inner, row) => inner + toNumber(row.quantity), 0), 0)

  return (
    <section>
      <h3 className="report-area-title flex items-baseline justify-between">
        <span>{title}</span>
        <span className="tabular text-white/85">{formatTotal(total)}</span>
      </h3>
      {visible.map((group, index) => (
        <div key={group.title ?? `rows-${index}`}>
          {group.title ? <p className="photo-list-category">{sentenceCase(group.title)}</p> : null}
          <ul>
            {group.rows.map((row) => (
              <li key={row.key} className={`photo-list-row${row.priceChanged ? ' is-price-changed' : ''}`}>
                <div className="min-w-0 flex-1">
                  <RowName row={row} />
                  {row.priceNote ? <span className="stock-price-note">{row.priceNote}</span> : null}
                  {row.note ? <p className="photo-list-note">{row.note}</p> : null}
                </div>
                {showPrices ? (
                  <span className="photo-list-figures">
                    <span className="photo-list-price">
                      {row.price || (row.priceDeals ? '' : '–')}
                      {row.priceDeals ? <span className="photo-list-deals">{row.priceDeals}</span> : null}
                    </span>
                    <span className="photo-list-qty photo-list-qty-col">{row.quantity}</span>
                  </span>
                ) : (
                  <span className="photo-list-qty">{row.quantity}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function ListSheet({ title, date, insideLeft, insideRight, outside, unknown, vegiesLeft = [], vegiesRight = [] }: Omit<LedgerPhotoSheetProps, 'layout' | 'quantityLabel'>) {
  const all = [...insideLeft, ...insideRight, ...vegiesLeft, ...vegiesRight].flatMap((group) => group.rows).concat(outside, unknown)
  const units = all.reduce((sum, row) => sum + toNumber(row.quantity), 0)
  // Stock In passes a price with every row; Check Stock has none, so its photo stays as it was.
  const showPrices = all.some((row) => row.price !== undefined)
  const [year, month, day] = date.split('-').map(Number)
  const longDate = year && month && day
    ? new Date(year, month - 1, day).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : date

  return (
    <>
      <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-forest">{title}</h2>
          <p className="mt-0.5 text-[14px] text-muted"><time dateTime={date}>{longDate}</time></p>
          <p className="mt-2 text-[14px] text-ink">
            <span className="font-semibold tabular">{formatTotal(units)}</span> units · <span className="font-semibold tabular">{all.length}</span> {all.length === 1 ? 'item' : 'items'}
          </p>
        </div>
        <BrandTile />
      </header>
      {showPrices ? (
        <div className="photo-list-head" aria-hidden="true">
          <span>Item</span>
          <span className="photo-list-figures">
            <span className="photo-list-price">Price</span>
            <span className="photo-list-qty-col">Stock in</span>
          </span>
        </div>
      ) : null}
      <ListArea title="Inside coolroom" groups={[...insideLeft, ...insideRight]} showPrices={showPrices} />
      <ListArea title="Unclassified / staff inspection" groups={[{ rows: unknown }]} showPrices={showPrices} />
      <ListArea title="Outside coolroom" groups={[{ rows: outside }]} showPrices={showPrices} />
      <ListArea title="Vegies" groups={[...vegiesLeft, ...vegiesRight]} showPrices={showPrices} />
    </>
  )
}

/**
 * A photo sheet laid out like the Daily Report photo: the title and date with the logo, then the
 * coolroom areas, one row per item. 1080px in two columns, or a 540px long list
 * (`layout="list"`) that reads well on a phone. Used for exports only.
 */
export const LedgerPhotoSheet = forwardRef<HTMLDivElement, LedgerPhotoSheetProps>(function LedgerPhotoSheet(
  { title, date, quantityLabel, insideLeft, insideRight, outside, unknown, vegiesLeft = [], vegiesRight = [], layout = 'columns' },
  ref,
) {
  const hasInside = [...insideLeft, ...insideRight].some((group) => group.rows.length > 0)
  const outsideMidpoint = Math.ceil(outside.length / 2)
  const isList = layout === 'list'

  if (isList) {
    return (
      <div ref={ref} className="report-photo is-list bg-surface">
        <ListSheet title={title} date={date} insideLeft={insideLeft} insideRight={insideRight} outside={outside} unknown={unknown} vegiesLeft={vegiesLeft} vegiesRight={vegiesRight} />
      </div>
    )
  }

  return (
    <div ref={ref} className="report-photo bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold tracking-tight text-forest">{title}</h2>
        <div className="flex items-center gap-3">
          <time dateTime={date} className="text-xs font-medium text-muted">{formatSheetDate(date)}</time>
          <BrandTile className="opacity-80" />
        </div>
      </header>

      {hasInside ? (
        insideRight.some((group) => group.rows.length > 0) ? (
          <TwoColumns title="Inside coolroom" left={insideLeft} right={insideRight} quantityLabel={quantityLabel} />
        ) : (
          <>
            <h3 className="report-area-title">Inside coolroom</h3>
            <PhotoTable groups={insideLeft} quantityLabel={quantityLabel} />
          </>
        )
      ) : null}

      {unknown.length > 0 ? (
        <>
          <h3 className="report-area-title">Unclassified / staff inspection</h3>
          <PhotoTable groups={[{ rows: unknown }]} quantityLabel={quantityLabel} />
        </>
      ) : null}

      {outside.length > 0 ? (
        <TwoColumns
          title="Outside coolroom"
          left={[{ rows: outside.slice(0, outsideMidpoint) }]}
          right={[{ rows: outside.slice(outsideMidpoint) }]}
          quantityLabel={quantityLabel}
        />
      ) : null}

      {[...vegiesLeft, ...vegiesRight].some((group) => group.rows.length > 0) ? (
        vegiesRight.some((group) => group.rows.length > 0) ? (
          <TwoColumns title="Vegies" left={vegiesLeft} right={vegiesRight} quantityLabel={quantityLabel} />
        ) : (
          <>
            <h3 className="report-area-title">Vegies</h3>
            <PhotoTable groups={vegiesLeft} quantityLabel={quantityLabel} />
          </>
        )
      ) : null}
    </div>
  )
})
