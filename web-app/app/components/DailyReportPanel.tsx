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
import { Button, IconButton } from './ui/Button'
import { inputClass } from './ui/Input'
import { ActionBar, ScreenHeader } from './ui/Primitives'

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
    <section className="space-y-4">
      <ScreenHeader
        title="Daily report"
        subtitle="Closing sheet with units sold and refill tags. The photo matches this preview."
        actions={
          <IconButton label="Refresh" onClick={() => void reload()} disabled={isLoading} className="border border-line bg-surface">
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
          </IconButton>
        }
      />

      <div className="flex items-center gap-3">
        <label htmlFor="daily-report-date" className="text-[14px] font-medium text-ink">Date</label>
        <input
          id="daily-report-date"
          type="date"
          value={reportDate}
          onChange={(event) => event.target.value && setReportDate(event.target.value)}
          className={`${inputClass} w-auto tabular`}
        />
      </div>

      {shownError ? (
        <div className="rounded-control bg-danger-soft px-4 py-3 text-[14px] text-danger">{shownError}</div>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-control bg-warning-soft px-4 py-3 text-[14px] text-warning">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isLoading && !data ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 rounded-card border border-line bg-surface text-[15px] text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading report…
        </div>
      ) : null}

      {hasReport ? (
        <div className="overflow-x-auto rounded-card border border-line bg-[#c8ccd3] p-2 sm:p-3">
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
