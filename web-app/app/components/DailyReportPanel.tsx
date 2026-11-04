'use client'

import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { toPng } from 'html-to-image'

import { getLocalTodayDate } from '../../lib/date-utils'
import { buildPaperSections, sortIndexedRowsByName, type PaperRowColumns } from '../../lib/stock-paper-layout'
import { formatSheetDate } from '../../lib/stock-paper-utils'
import { formatQuantity, type ItemInsight } from '../../lib/report-insights'
import { useDailyReportData, type ReportRow, type IndexedReportRow, type ReportCatalogItem } from './useDailyReportData'
import { StockFlagBadge } from './StockFlagBadge'
import { BrandTile } from './BrandMark'
import { ReportNotices } from './ReportNotices'
import { Button, IconButton } from './ui/Button'
import { inputClass } from './ui/Input'
import { ActionBar, ScreenHeader } from './ui/Primitives'

type DailyReportPanelProps = {
  catalogItems: ReportCatalogItem[]
}

function orderedRows(rows: PaperRowColumns<ReportRow>) {
  return sortIndexedRowsByName([...rows.left, ...rows.right, ...rows.single])
}

type ReportGroup = { title?: string; items: IndexedReportRow[] }

function PhotoColumns({ title, left, right, insights }: {
  title: string
  left: ReportGroup[]
  right: ReportGroup[]
  insights: Record<string, ItemInsight>
}) {
  return (
    <>
      <h3 className="report-area-title">{title}</h3>
      <div className="report-photo-columns">
        {[left, right].map((groups, index) => (
          <div className="report-photo-column" key={index}>
            <ReportArea groups={groups} insights={insights} />
            <div className="report-photo-rules" aria-hidden="true" />
          </div>
        ))}
      </div>
    </>
  )
}

function ReportArea({ title, groups, insights }: {
  title?: string
  groups: ReportGroup[]
  insights: Record<string, ItemInsight>
}) {
  const visibleGroups = groups.filter(group => group.items.length > 0)
  if (!visibleGroups.length) return null

  return (
    <table className="report-ledger">
      {title && <caption>{title}</caption>}
      <colgroup><col /><col className="report-number-column" /><col className="report-number-column" /></colgroup>
      <thead><tr><th scope="col">Item</th><th scope="col">Closing</th><th scope="col">Sold</th></tr></thead>
      {visibleGroups.map(group => (
        <tbody key={group.title ?? 'items'}>
          {group.title && <tr><th scope="rowgroup" colSpan={3} className="report-category">{group.title}</th></tr>}
          {group.items.map(({ row, index }) => {
            const insight = insights[row.code]
            const sold = insight?.status === 'ok' ? formatQuantity(insight.sold) : insight?.status === 'negative' ? '?' : '-'
            return (
              <tr key={index}>
                <th scope="row">
                  <div className="report-name">
                    {row.redMarked && <span aria-label="Marked for reorder" role="img" className="h-2 w-2 shrink-0 rounded-full bg-danger" />}
                    <span>{row.official_name}</span>
                    {insight?.stockFlag && <StockFlagBadge flag={insight.stockFlag} />}
                  </div>
                </th>
                <td>{formatQuantity(row.closing)}</td>
                <td className={insight?.status === 'negative' ? 'text-warning' : 'text-muted'}>{sold}</td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

export function DailyReportPanel({ catalogItems }: DailyReportPanelProps) {
  const [reportDate, setReportDate] = useState(() => getLocalTodayDate())
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const photoRef = useRef<HTMLDivElement | null>(null)

  const { data, isLoading, error, reload, insights, indexedRows, notices, hasReport } = useDailyReportData(reportDate, catalogItems)

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

  function renderSheet(photo: boolean) {
    const midpoint = Math.ceil(sections.outside.length / 2)
    return (
      <div ref={photo ? photoRef : undefined} className={photo ? "report-photo bg-surface" : "report-screen bg-surface"}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5">
          <h2 className="text-lg font-semibold tracking-tight text-forest">Closing stock</h2>
          <div className="flex items-center gap-3">
            <time dateTime={reportDate} className="text-xs font-medium text-muted">{formatSheetDate(reportDate)}</time>
            {photo && <BrandTile className="opacity-80" />}
          </div>
        </header>
        {photo && sections.right.length > 0 ? (
          <PhotoColumns title="Inside coolroom" left={sections.left} right={sections.right} insights={insights} />
        ) : (
          <ReportArea title="Inside coolroom" groups={[...sections.left, ...sections.right]} insights={insights} />
        )}
        <ReportArea title="Unclassified / staff inspection" groups={[{ items: sections.unknown }]} insights={insights} />
        {photo && sections.outside.length > 0 ? (
          <PhotoColumns
            title="Outside coolroom"
            left={[{ items: sections.outside.slice(0, midpoint) }]}
            right={[{ items: sections.outside.slice(midpoint) }]}
            insights={insights}
          />
        ) : (
          <ReportArea title="Outside coolroom" groups={[{ items: sections.outside }]} insights={insights} />
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
          onChange={(event) => event.target.value && setReportDate(event.target.value)}
          className={`${inputClass} w-auto min-w-0 flex-1 tabular sm:flex-none`}
        />
        <IconButton label="Refresh" onClick={() => void reload()} disabled={isLoading} className="border border-line bg-surface">
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
        </IconButton>
      </div>

      {shownError ? (
        <div className="rounded-control bg-danger-soft px-4 py-3 text-[14px] text-danger">{shownError}</div>
      ) : null}

      <ReportNotices notices={notices} />

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
