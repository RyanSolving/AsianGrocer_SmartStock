'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { toPng } from 'html-to-image'

import { formatDayLabel, getLocalTodayDate } from '../../lib/date-utils'
import { buildPaperSections, sortIndexedRowsByName, type PaperRowColumns } from '../../lib/stock-paper-layout'
import { formatSheetDate } from '../../lib/stock-paper-utils'
import { formatQuantity, type ItemInsight } from '../../lib/report-insights'
import { useDailyReportData, type ReportRow, type IndexedReportRow, type ReportCatalogItem } from './useDailyReportData'
import { EditedMark, StockFlagBadge } from './StockFlagBadge'
import { FlagPickerSheet } from './FlagPickerSheet'
import { BrandTile } from './BrandMark'
import { ReportInfo } from './ReportNotices'
import { Button, IconButton } from './ui/Button'
import { inputClass } from './ui/Input'
import { ActionBar, ScreenHeader } from './ui/Primitives'

type DailyReportPanelProps = {
  catalogItems: ReportCatalogItem[]
  /** Opens the report on this date (from Home). A new `key` applies it again. */
  requestedDate?: { date: string; key: number } | null
  /** The newest date with a full report (today's may not be ready). Used until a date is picked. */
  defaultDate?: string | null
}

function orderedRows(rows: PaperRowColumns<ReportRow>) {
  return sortIndexedRowsByName([...rows.left, ...rows.right, ...rows.single])
}

type ReportGroup = { title?: string; items: IndexedReportRow[] }

function PhotoColumns({ title, left, right, insights, stockLabel }: {
  title: string
  left: ReportGroup[]
  right: ReportGroup[]
  insights: Record<string, ItemInsight>
  stockLabel: string
}) {
  return (
    <>
      <h3 className="report-area-title">{title}</h3>
      <div className="report-photo-columns">
        {[left, right].map((groups, index) => (
          <div className="report-photo-column" key={index}>
            <ReportArea groups={groups} insights={insights} stockLabel={stockLabel} />
            <div className="report-photo-rules" aria-hidden="true" />
          </div>
        ))}
      </div>
    </>
  )
}

function ReportArea({ title, groups, insights, onSelectItem, stockLabel }: {
  title?: string
  /** "Current" (closing + later stock in) on the newest report, else "Closing". */
  stockLabel: string
  groups: ReportGroup[]
  insights: Record<string, ItemInsight>
  /** Screen only: tap or Enter on a row opens the badge picker. */
  onSelectItem?: (row: ReportRow) => void
}) {
  const visibleGroups = groups.filter(group => group.items.length > 0)
  if (!visibleGroups.length) return null

  return (
    <table className="report-ledger">
      {title && <caption>{title}</caption>}
      <colgroup><col /><col className="report-number-column" /><col className="report-number-column" /></colgroup>
      <thead><tr><th scope="col">Item</th><th scope="col">{stockLabel}</th><th scope="col">Sold</th></tr></thead>
      {visibleGroups.map(group => (
        <tbody key={group.title ?? 'items'}>
          {group.title && <tr><th scope="rowgroup" colSpan={3} className="report-category">{group.title}</th></tr>}
          {group.items.map(({ row, index }) => {
            const insight = insights[row.code]
            // A negative figure is shown as it is (a miscount), in amber, with a warning above.
            const sold = insight?.status === 'ok' || insight?.status === 'negative'
              ? formatQuantity(insight.sold).replace('-', '−')
              : '-'
            return (
              <tr
                key={index}
                className={onSelectItem ? 'report-row-pressable' : undefined}
                tabIndex={onSelectItem ? 0 : undefined}
                aria-label={onSelectItem ? `${row.official_name}: change badge` : undefined}
                onClick={onSelectItem ? () => onSelectItem(row) : undefined}
                onKeyDown={onSelectItem ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectItem(row)
                  }
                } : undefined}
              >
                <th scope="row">
                  <div className="report-name">
                    {row.redMarked && <span aria-label="Marked for reorder" role="img" className="h-2 w-2 shrink-0 rounded-full bg-danger" />}
                    <span>{row.official_name}</span>
                    {insight?.stockFlag ? (
                      <StockFlagBadge flag={insight.stockFlag} edited={Boolean(onSelectItem) && insight.flagSource === 'manual'} />
                    ) : onSelectItem && insight?.flagSource === 'manual' ? (
                      <EditedMark />
                    ) : null}
                  </div>
                </th>
                <td className={row.current !== row.closing ? 'font-semibold text-forest' : undefined}>
                  {formatQuantity(row.current)}
                </td>
                <td
                  className={insight?.status === 'negative' ? 'text-warning' : 'text-muted'}
                  aria-label={insight?.status === 'negative' ? `Sold ${sold}, check the count` : undefined}
                >
                  {sold}
                </td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

export function DailyReportPanel({ catalogItems, requestedDate, defaultDate }: DailyReportPanelProps) {
  const [reportDate, setReportDate] = useState(() => requestedDate?.date ?? defaultDate ?? getLocalTodayDate())
  // Opens on the newest date with a report; once someone picks a date, it stays theirs.
  const hasPickedDate = useRef(Boolean(requestedDate?.date))
  useEffect(() => {
    if (requestedDate?.date) {
      hasPickedDate.current = true
      setReportDate(requestedDate.date)
    }
  }, [requestedDate])
  useEffect(() => {
    if (defaultDate && !hasPickedDate.current) setReportDate(defaultDate)
  }, [defaultDate])
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const photoRef = useRef<HTMLDivElement | null>(null)

  const {
    data, isLoading, error, reload, insights, indexedRows, notices, hasReport,
    sources, stockInNote, canChangeFlags, setFlagOverride, showsCurrent, arrivedDates,
  } = useDailyReportData(reportDate, catalogItems)
  const [flagPickerRow, setFlagPickerRow] = useState<ReportRow | null>(null)

  const openFlagPicker = (row: ReportRow) => setFlagPickerRow(row)

  const sections = useMemo(() => {
    const paper = buildPaperSections(indexedRows)
    const toGroup = (section: typeof paper.leftColumn[number]) => ({
      title: section.title,
      items: orderedRows(section.rows),
    })
    return {
      left: paper.leftColumn.map(toGroup),
      right: paper.rightColumn.map(toGroup),
      outside: orderedRows(paper.outsideRows),
      unknown: orderedRows(paper.unknownRows),
    }
  }, [indexedRows])

  async function exportPhoto() {
    if (isExporting) return
    setExportError(null)

    try {
      flushSync(() => setIsExporting(true))
      if (!photoRef.current) throw new Error('Report is no longer available.')
      const dataUrl = await toPng(photoRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#fefefe',
      })

      const link = document.createElement('a')
      link.download = `daily-detail-${reportDate}.png`
      link.href = dataUrl
      link.click()
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Failed to export the report photo.')
    } finally {
      setIsExporting(false)
    }
  }

  const stockLabel = showsCurrent ? 'Current' : 'Closing'

  function renderSheet(photo: boolean) {
    const midpoint = Math.ceil(sections.outside.length / 2)
    return (
      <div ref={photo ? photoRef : undefined} className={photo ? "report-photo bg-surface" : "report-screen bg-surface"}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5">
          <h2 className="text-lg font-semibold tracking-tight text-forest">{showsCurrent ? 'Current stock' : 'Closing stock'}</h2>
          <div className="flex items-center gap-3">
            <time dateTime={reportDate} className="text-xs font-medium text-muted">{formatSheetDate(reportDate)}</time>
            {photo && <BrandTile className="opacity-80" />}
          </div>
          {arrivedDates.length > 0 ? (
            <p className="w-full text-[13px] text-muted">
              Sold is for {formatDayLabel(reportDate)}. Current adds stock in from {arrivedDates.map((day) => formatDayLabel(day)).join(', ')}.
            </p>
          ) : null}
          {photo ? null : <p className="w-full text-[13px] text-muted">Tap an item to change or remove its badge.</p>}
        </header>
        {photo && sections.right.length > 0 ? (
          <PhotoColumns title="Inside coolroom" left={sections.left} right={sections.right} insights={insights} stockLabel={stockLabel} />
        ) : (
          <ReportArea title="Inside coolroom" groups={[...sections.left, ...sections.right]} insights={insights} stockLabel={stockLabel} onSelectItem={photo ? undefined : openFlagPicker} />
        )}
        <ReportArea title="Unclassified / staff inspection" groups={[{ items: sections.unknown }]} insights={insights} stockLabel={stockLabel} onSelectItem={photo ? undefined : openFlagPicker} />
        {photo && sections.outside.length > 0 ? (
          <PhotoColumns
            title="Outside coolroom"
            left={[{ items: sections.outside.slice(0, midpoint) }]}
            right={[{ items: sections.outside.slice(midpoint) }]}
            insights={insights}
            stockLabel={stockLabel}
          />
        ) : (
          <ReportArea title="Outside coolroom" groups={[{ items: sections.outside }]} insights={insights} stockLabel={stockLabel} onSelectItem={photo ? undefined : openFlagPicker} />
        )}
      </div>
    )
  }

  const shownError = exportError ?? error
  const canExport = hasReport && !isLoading && !isExporting

  return (
    <section className="space-y-3">
      <div className="hidden md:block">
        <ScreenHeader title="Daily report" />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="daily-report-date"
          type="date"
          aria-label="Report date"
          value={reportDate}
          onChange={(event) => {
            if (!event.target.value) return
            hasPickedDate.current = true
            setReportDate(event.target.value)
          }}
          className={`${inputClass} w-auto min-w-0 flex-1 tabular sm:flex-none`}
        />
        <IconButton label="Refresh" onClick={() => void reload()} disabled={isLoading} className="border border-line bg-surface">
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
        </IconButton>
      </div>

      {shownError ? (
        <div className="rounded-control bg-danger-soft px-4 py-3 text-[14px] text-danger">{shownError}</div>
      ) : null}

      <ReportInfo notices={notices} sources={sources} stockInNote={stockInNote} arrivedDates={arrivedDates} />

      <FlagPickerSheet
        open={flagPickerRow !== null}
        onClose={() => setFlagPickerRow(null)}
        itemName={flagPickerRow?.official_name ?? ''}
        insight={flagPickerRow ? insights[flagPickerRow.code] ?? null : null}
        unavailable={!canChangeFlags}
        onChoose={(choice) => {
          if (flagPickerRow) void setFlagOverride(flagPickerRow.code, choice)
        }}
      />

      {isLoading && !data ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 rounded-card border border-line bg-surface text-[15px] text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading report…
        </div>
      ) : null}

      {hasReport ? (
        <div className="min-w-0 overflow-hidden rounded-card border border-line">
          {renderSheet(false)}
        </div>
      ) : null}

      {hasReport && isExporting && (
        <div aria-hidden="true" className="pointer-events-none fixed right-full top-0">
          {renderSheet(true)}
        </div>
      )}

      {data && !isLoading && data.closingFound && indexedRows.length === 0 ? (
        <p className="py-8 text-sm text-slate-500">
          The saved closing has no items matching the current catalog, so there is nothing to show.
        </p>
      ) : null}
      {hasReport ? (
        <ActionBar className="md:static md:flex md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <Button size="lg" block className="md:w-auto" icon={<Download className="h-5 w-5" aria-hidden="true" />} loading={isExporting} loadingLabel="Exporting…" disabled={!canExport} onClick={() => void exportPhoto()}>
            Export photo
          </Button>
        </ActionBar>
      ) : null}
    </section>
  )
}
