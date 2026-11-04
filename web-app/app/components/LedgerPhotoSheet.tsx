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

/**
 * A photo sheet laid out like the Daily Report photo: the title and date with the logo, then the
 * coolroom areas, one row per item. 1080px in two columns, or a 540px long list
 * (`layout="list"`) that reads well on a phone. Used for exports only.
 */
export const LedgerPhotoSheet = forwardRef<HTMLDivElement, LedgerPhotoSheetProps>(function LedgerPhotoSheet(
  { title, date, quantityLabel, insideLeft, insideRight, outside, unknown, layout = 'columns' },
  ref,
) {
  const hasInside = [...insideLeft, ...insideRight].some((group) => group.rows.length > 0)
  const outsideMidpoint = Math.ceil(outside.length / 2)
  const isList = layout === 'list'

  return (
    <div ref={ref} className={`report-photo bg-surface ${isList ? 'is-list' : ''}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold tracking-tight text-forest">{title}</h2>
        <div className="flex items-center gap-3">
          <time dateTime={date} className="text-xs font-medium text-muted">{formatSheetDate(date)}</time>
          <BrandTile className="opacity-80" />
        </div>
      </header>

      {hasInside && isList ? (
        <>
          <h3 className="report-area-title">Inside coolroom</h3>
          <PhotoTable groups={[...insideLeft, ...insideRight]} quantityLabel={quantityLabel} />
        </>
      ) : hasInside ? (
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

      {outside.length > 0 && isList ? (
        <>
          <h3 className="report-area-title">Outside coolroom</h3>
          <PhotoTable groups={[{ rows: outside }]} quantityLabel={quantityLabel} />
        </>
      ) : outside.length > 0 ? (
        <TwoColumns
          title="Outside coolroom"
          left={[{ rows: outside.slice(0, outsideMidpoint) }]}
          right={[{ rows: outside.slice(outsideMidpoint) }]}
          quantityLabel={quantityLabel}
        />
      ) : null}
    </div>
  )
})
