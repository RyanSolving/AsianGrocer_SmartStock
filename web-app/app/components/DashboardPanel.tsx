'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { toPng } from 'html-to-image'
import { getLocalTodayDate } from '../../lib/date-utils'

import { DailyReportSummary } from './DailyReportSummary'
import { ReportInfo } from './ReportNotices'
import { Button, IconButton } from './ui/Button'
import { inputClass } from './ui/Input'
import { ActionBar, ScreenHeader } from './ui/Primitives'
import { useDailyReportData, type ReportCatalogItem } from './useDailyReportData'

type DashboardPanelProps = {
  catalogItems: ReportCatalogItem[]
  /** The newest date with a full report (today's may not be ready). Used until a date is picked. */
  defaultDate?: string | null
}

function DailySummaryTab({ catalogItems, date, refreshKey }: { catalogItems: ReportCatalogItem[]; date: string; refreshKey: number }) {
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { data, isLoading, error, entries, notices, hasReport, sources, stockInNote, arrivedDates, showsCurrent } = useDailyReportData(date, catalogItems, refreshKey)

  async function exportPhoto() {
    if (!summaryRef.current) return

    setIsExporting(true)
    setExportError(null)

    try {
      // Let the photo layout (top contributors only) render before capturing.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const dataUrl = await toPng(summaryRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: '#f3f4f6' })
      const link = document.createElement('a')
      link.download = `daily-summary-${date}.png`
      link.href = dataUrl
      link.click()
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Failed to export the summary photo.')
    } finally {
      setIsExporting(false)
    }
  }

  const shownError = exportError ?? error

  return (
    <div className="space-y-3">
      {shownError ? (
        <div className="rounded-control bg-danger-soft px-4 py-3 text-[14px] text-danger">{shownError}</div>
      ) : null}

      <ReportInfo notices={notices} sources={sources} stockInNote={stockInNote} arrivedDates={arrivedDates} />

      {isLoading && !data ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-card border border-line bg-surface">
          <div className="flex items-center gap-2 text-[15px] text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading daily summary…
          </div>
        </div>
      ) : null}

      {hasReport ? (
        <>
          {/* Refetch keeps the frame: hold the previous render at reduced opacity. */}
          <div className={`overflow-x-auto rounded-card border border-line transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
            <DailyReportSummary
              containerRef={summaryRef}
              photoMode={isExporting}
              date={date}
              prevClosingDate={data?.prevClosingDate ?? null}
              entries={entries}
              showsCurrent={showsCurrent}
            />
          </div>
          <ActionBar className="md:static md:flex md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <Button size="lg" block className="md:w-auto" icon={<Download className="h-5 w-5" aria-hidden="true" />} loading={isExporting} loadingLabel="Exporting…" onClick={() => void exportPhoto()}>
              Export photo for owner
            </Button>
          </ActionBar>
        </>
      ) : null}
    </div>
  )
}

export function DashboardPanel({ catalogItems, defaultDate }: DashboardPanelProps) {
  const today = useMemo(() => getLocalTodayDate(), [])
  const [selectedDate, setSelectedDate] = useState(defaultDate ?? today)
  const hasPickedDate = useRef(false)
  useEffect(() => {
    if (defaultDate && !hasPickedDate.current) setSelectedDate(defaultDate)
  }, [defaultDate])
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0)

  return (
    <section className="space-y-3">
      <div className="hidden md:block">
        <ScreenHeader title="Dashboard" />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="date"
          value={selectedDate}
          onChange={(event) => {
            if (!event.target.value) return
            hasPickedDate.current = true
            setSelectedDate(event.target.value)
          }}
          aria-label="Report date"
          className={`${inputClass} w-auto min-w-0 flex-1 tabular sm:flex-none`}
        />
        <IconButton label="Refresh" onClick={() => setSummaryRefreshKey((value) => value + 1)} className="border border-line bg-surface">
          <RefreshCw className="h-5 w-5" />
        </IconButton>
      </div>

      <DailySummaryTab catalogItems={catalogItems} date={selectedDate} refreshKey={summaryRefreshKey} />
    </section>
  )
}
