'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw } from 'lucide-react'
import { toPng } from 'html-to-image'

import { getLocalTodayDate } from '../../lib/date-utils'
import {
  UNKNOWN_SECTION_ID,
  buildOutsideDisplayColumns,
  buildPaperSections,
} from '../../lib/stock-paper-layout'
import { formatSheetDate } from '../../lib/stock-paper-utils'
import { formatQuantity, type ItemInsight } from '../../lib/report-insights'
import { StockPaperSectionTable, StockPaperThreeColumnTable } from './StockPaperTables'
import { useDailyReportData, type IndexedReportRow, type ReportCatalogItem } from './useDailyReportData'

type DailyReportPanelProps = {
  catalogItems: ReportCatalogItem[]
}

function formatSold(insight: ItemInsight | undefined) {
  if (!insight) return null

  switch (insight.status) {
    case 'ok':
      return { text: `sold ${formatQuantity(insight.sold)}`, tone: 'ok' as const }
    case 'negative':
      return { text: 'sold ?', tone: 'warn' as const }
    case 'no-baseline':
      return { text: 'sold -', tone: 'muted' as const }
    default:
      return null
  }
}

export function DailyReportPanel({ catalogItems }: DailyReportPanelProps) {
  const [reportDate, setReportDate] = useState(() => getLocalTodayDate())
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const paperRef = useRef<HTMLDivElement | null>(null)

  const { data, isLoading, error, reload, insights, indexedRows, warnings, hasReport } = useDailyReportData(reportDate, catalogItems)

  const paperSections = useMemo(() => buildPaperSections(indexedRows), [indexedRows])
  const outsideColumns = useMemo(
    () => buildOutsideDisplayColumns(paperSections.outsideRows),
    [paperSections.outsideRows],
  )

  function renderLabelCell(item: IndexedReportRow | undefined) {
    if (!item) return null
    const insight = insights[item.row.code]

    return (
      <div className="stock-export-label-wrap">
        <span
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 rounded-full border ${item.row.redMarked ? 'border-red-600 bg-red-600' : 'border-slate-400 bg-transparent'}`}
        />
        <span
          className={`stock-export-label ${item.row.redMarked ? 'text-red-600 font-semibold' : ''}`}
          title={item.row.official_name}
        >
          {item.row.official_name}
          {insight?.flag === 'ORDER' ? <span className="report-refill-tag">REFILL</span> : null}
          {insight?.fast ? <span className="report-fast-tag">FAST</span> : null}
        </span>
      </div>
    )
  }

  function renderQuantityCell(item: IndexedReportRow) {
    const insight = insights[item.row.code]
    const sold = formatSold(insight)

    return (
      <div className="report-qty-cell">
        <div className={`stock-export-qty ${item.row.redMarked ? 'text-red-600' : ''}`}>
          {formatQuantity(item.row.closing)}
        </div>
        {sold ? <div className={`report-sold report-sold-${sold.tone}`}>{sold.text}</div> : null}
      </div>
    )
  }

  async function exportPhoto() {
    if (!paperRef.current) return

    setIsExporting(true)
    setExportError(null)

    try {
      const dataUrl = await toPng(paperRef.current, {
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

  const hasUnknownRows =
    paperSections.unknownRows.left.length > 0
    || paperSections.unknownRows.right.length > 0
    || paperSections.unknownRows.single.length > 0

  const shownError = exportError ?? error
  const canExport = hasReport && !isLoading && !isExporting

  return (
    <section className="card-surface rounded-2xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Daily Report</h1>
          <p className="mt-1 text-sm text-slate-600">
            Detailed stock sheet with closing count, units sold and refill tags. The preview matches the exported photo. Charts are on the Dashboard.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Date
            <input
              type="date"
              value={reportDate}
              onChange={(event) => event.target.value && setReportDate(event.target.value)}
              className="mt-1 block min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <button
            type="button"
            onClick={() => void reload()}
            disabled={isLoading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void exportPhoto()}
            disabled={!canExport}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export photo
          </button>
        </div>
      </div>

      {shownError ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{shownError}</div>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mb-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isLoading && !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading report...
        </div>
      ) : null}

      {hasReport ? (
        <div className="overflow-x-auto">
          <div ref={paperRef} className="stock-paper stock-paper-export min-w-[700px] sm:min-w-[760px] md:min-w-[820px]">
            <div className="report-detail-hdr">
              <span className="report-detail-title">Detailed Stock Sheet</span>
              <span className="report-detail-sub">Closing count · units sold · refill</span>
            </div>

            <div className="stock-date-row">
              <span>DATE:</span>
              <span className="stock-date-hand">{formatSheetDate(reportDate)}</span>
            </div>

            <div className="stock-sec-hdr">INSIDE COOLROOM</div>
            <div className="stock-inside-grid">
              <div className="stock-col stock-col-left">
                {paperSections.leftColumn.map((section) => (
                  <StockPaperSectionTable
                    key={section.id}
                    section={section}
                    keyPrefix="report-left"
                    renderLabelCell={renderLabelCell}
                    renderQuantityCell={renderQuantityCell}
                  />
                ))}
              </div>

              <div className="stock-col">
                {paperSections.rightColumn.map((section) => (
                  <StockPaperSectionTable
                    key={section.id}
                    section={section}
                    keyPrefix="report-right"
                    renderLabelCell={renderLabelCell}
                    renderQuantityCell={renderQuantityCell}
                  />
                ))}
              </div>
            </div>

            <div className="stock-sec-hdr">OUTSIDE COOLROOM</div>
            <StockPaperThreeColumnTable
              columns={outsideColumns}
              keyPrefix="report-outside"
              renderLabelCell={renderLabelCell}
              renderQuantityCell={renderQuantityCell}
            />

            {hasUnknownRows ? (
              <>
                <div id={UNKNOWN_SECTION_ID} className="stock-sec-hdr !bg-red-900 !text-white">
                  UNCLASSIFIED / STAFF INSPECTION
                </div>
                <StockPaperThreeColumnTable
                  columns={{
                    left: paperSections.unknownRows.left,
                    middle: paperSections.unknownRows.right,
                    right: paperSections.unknownRows.single,
                  }}
                  keyPrefix="report-unknown"
                  renderLabelCell={renderLabelCell}
                  renderQuantityCell={renderQuantityCell}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {data && !isLoading && data.closingFound && indexedRows.length === 0 ? (
        <p className="py-8 text-sm text-slate-500">
          The saved closing has no items matching the current catalog, so there is nothing to show.
        </p>
      ) : null}
    </section>
  )
}
