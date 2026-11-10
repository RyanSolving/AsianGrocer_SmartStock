'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Download, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { toPng } from 'html-to-image'

import { formatDayLabel, getLocalTodayDate } from '../../lib/date-utils'
import { buildPaperSections, sortIndexedRowsByName, VEGIES_LOCATION, type PaperRowColumns } from '../../lib/stock-paper-layout'
import { formatSheetDate } from '../../lib/stock-paper-utils'
import { formatQuantity, type ItemInsight, type StockFlag } from '../../lib/report-insights'
import { useDailyReportData, type ReportRow, type IndexedReportRow, type ReportCatalogItem } from './useDailyReportData'
import { EditedMark, StockFlagBadge } from './StockFlagBadge'
import { FlagPickerSheet } from './FlagPickerSheet'
import { BrandTile } from './BrandMark'
import { ReportInfo } from './ReportNotices'
import { Button, IconButton } from './ui/Button'
import { fieldClass, inputClass } from './ui/Input'
import { ActionBar, ScreenHeader } from './ui/Primitives'

type DailyReportPanelProps = {
  catalogItems: ReportCatalogItem[]
  /** Bumped when a Stock In or Stock Close is saved anywhere, to reload the report live. */
  liveKey?: number
  /** Opens the report on this date (from Home). A new `key` applies it again. */
  requestedDate?: { date: string; key: number } | null
  /** The newest date with a full report (today's may not be ready). Used until a date is picked. */
  defaultDate?: string | null
}

function orderedRows(rows: PaperRowColumns<ReportRow>) {
  return sortIndexedRowsByName([...rows.left, ...rows.right, ...rows.single])
}

type ReportView = 'fruit' | 'vegies'
const viewLabel: Record<ReportView, string> = { fruit: 'Fruit', vegies: 'Vegies' }

type ReportGroup = { title?: string; items: IndexedReportRow[] }

function PhotoColumns({ title, left, right, insights, stockLabel, soldLabel }: {
  title: string
  left: ReportGroup[]
  right: ReportGroup[]
  insights: Record<string, ItemInsight>
  stockLabel: string
  soldLabel: string
}) {
  return (
    <>
      <h3 className="report-area-title">{title}</h3>
      <div className="report-photo-columns">
        {[left, right].map((groups, index) => (
          <div className="report-photo-column" key={index}>
            <ReportArea groups={groups} insights={insights} stockLabel={stockLabel} soldLabel={soldLabel} />
            <div className="report-photo-rules" aria-hidden="true" />
          </div>
        ))}
      </div>
    </>
  )
}

function ReportArea({ title, groups, insights, onSelectItem, stockLabel, soldLabel }: {
  title?: string
  /** "Current" (closing + later stock in) on the newest report, else "Closing". */
  stockLabel: string
  /** "Sold", or "Sold/day" when the closings are more than a day apart. */
  soldLabel: string
  groups: ReportGroup[]
  insights: Record<string, ItemInsight>
  /** Screen only: tap or Enter on a row opens the badge picker. */
  onSelectItem?: (row: ReportRow) => void
}) {
  const visibleGroups = groups.filter(group => group.items.length > 0)
  if (!visibleGroups.length) return null

  // The title is a heading above the table, not a <caption>: the exported photo copies the
  // table's measured height (which includes a caption) onto the table body, which stretched
  // every row and cut the last rows off the image.
  return (
    <>
    {title ? <h3 className="report-area-title">{title}</h3> : null}
    <table className="report-ledger" aria-label={title}>
      <colgroup><col /><col className="report-number-column" /><col className="report-number-column" /></colgroup>
      <thead><tr><th scope="col">Item</th><th scope="col">{stockLabel}</th><th scope="col" aria-label={soldLabel}>{soldLabel === 'Sold' ? 'Sold' : <>Sold<span className="report-col-sub">per day</span></>}</th></tr></thead>
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
                    {row.isNew ? <span className="report-tag-new">New</span> : null}
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
                  aria-label={insight?.status === 'negative' ? `${soldLabel} ${sold}, check the count` : undefined}
                >
                  {sold}
                </td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
    </>
  )
}

type BadgeKey = StockFlag | 'none'
const badgeKeys: BadgeKey[] = ['Stock-out', 'Low stock', 'No sell today', 'Over-stock', 'none']
const badgeLabel: Record<BadgeKey, string> = {
  'Stock-out': 'Stock-out',
  'Low stock': 'Low stock',
  'Over-stock': 'Over-stock',
  'No sell today': 'No sell',
  none: 'No badge',
}
// Same colours as the badges (StockFlagBadge).
const badgeDot: Record<StockFlag, string> = {
  'Stock-out': 'bg-[#B53C2B]',
  'Low stock': 'bg-[#A8561F]',
  'Over-stock': 'bg-[#3E2BB5]',
  'No sell today': 'bg-warning',
}
const chipClass = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors duration-150'
const chipOn = 'border-forest bg-forest text-white'
const chipOff = 'border-line bg-surface text-ink hover:bg-slate-50'

export function DailyReportPanel({ catalogItems, requestedDate, defaultDate, liveKey = 0 }: DailyReportPanelProps) {
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
    sources, stockInNote, canChangeFlags, setFlagOverride, showsCurrent, arrivedDates, soldPeriod,
  } = useDailyReportData(reportDate, catalogItems, liveKey)
  const [flagPickerRow, setFlagPickerRow] = useState<ReportRow | null>(null)

  const openFlagPicker = (row: ReportRow) => setFlagPickerRow(row)

  // Fruit and Vegies are separate reports: the screen and the exported photo show one at a time.
  const [view, setView] = useState<ReportView>('fruit')
  const viewCounts = useMemo(() => {
    const vegies = indexedRows.filter(({ row }) => row.location === VEGIES_LOCATION).length
    return { fruit: indexedRows.length - vegies, vegies }
  }, [indexedRows])
  const viewRows = useMemo(
    () => indexedRows.filter(({ row }) => (row.location === VEGIES_LOCATION) === (view === 'vegies')),
    [indexedRows, view],
  )

  // Badge filter: empty means every item. Applies to the screen and the exported photo.
  const [badgeFilter, setBadgeFilter] = useState<BadgeKey[]>([])
  const badgeCounts = useMemo(() => {
    const counts = new Map<BadgeKey, number>()
    for (const { row } of viewRows) {
      const key = insights[row.code]?.stockFlag ?? 'none'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [viewRows, insights])
  const toggleBadge = (key: BadgeKey) => setBadgeFilter((current) =>
    current.includes(key) ? current.filter((value) => value !== key) : [...current, key])
  const badgeRows = useMemo(() => {
    if (badgeFilter.length === 0) return viewRows
    return viewRows.filter(({ row }) => badgeFilter.includes(insights[row.code]?.stockFlag ?? 'none'))
  }, [viewRows, insights, badgeFilter])

  const [query, setQuery] = useState('')
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query])
  // Every word must appear in the item's name, stocklist name, product, category or code.
  const shownRows = useMemo(() => {
    if (terms.length === 0) return badgeRows
    return badgeRows.filter(({ row }) => {
      const haystack = [row.official_name, row.stocklist_name, row.product, row.category, row.code].join(' ').toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [badgeRows, terms])

  const [searchOpen, setSearchOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const suggestions = useMemo(() => (terms.length === 0 ? [] : shownRows.slice(0, 8).map(({ row }) => row)), [shownRows, terms])
  const showSuggestions = searchOpen && suggestions.length > 0
  const pickSuggestion = (row: ReportRow) => {
    setQuery(row.official_name)
    setSearchOpen(false)
  }

  const toSections = (rows: IndexedReportRow[]) => {
    const paper = buildPaperSections(rows)
    const toGroup = (section: typeof paper.leftColumn[number]) => ({
      title: section.title,
      items: orderedRows(section.rows),
    })
    return {
      left: paper.leftColumn.map(toGroup),
      right: paper.rightColumn.map(toGroup),
      outside: orderedRows(paper.outsideRows),
      unknown: orderedRows(paper.unknownRows),
      vegies: orderedRows(paper.vegieRows),
    }
  }
  // The exported photo follows the badge filter; the search only narrows the screen.
  const allSections = useMemo(() => toSections(badgeRows), [badgeRows])
  const screenSections = useMemo(() => toSections(shownRows), [shownRows])

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
      link.download = `daily-${view}-${reportDate}.png`
      link.href = dataUrl
      link.click()
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Failed to export the report photo.')
    } finally {
      setIsExporting(false)
    }
  }

  const stockLabel = showsCurrent ? 'Current' : 'Closing'
  const soldLabel = soldPeriod ? 'Sold/day' : 'Sold'

  function renderSheet(photo: boolean) {
    const sections = photo ? allSections : screenSections
    const midpoint = Math.ceil(sections.outside.length / 2)
    const vegieMidpoint = Math.ceil(sections.vegies.length / 2)
    const isVegies = view === 'vegies'
    const sheetTitle = `${isVegies ? 'Vegies' : 'Fruit'} ${showsCurrent ? 'current stock' : 'closing stock'}`
    return (
      <div ref={photo ? photoRef : undefined} className={photo ? "report-photo bg-surface" : "report-screen bg-surface"}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5">
          <h2 className="text-lg font-semibold tracking-tight text-forest">{sheetTitle}</h2>
          <div className="flex items-center gap-3">
            <time dateTime={reportDate} className="text-xs font-medium text-muted">{formatSheetDate(reportDate)}</time>
            {photo && <BrandTile className="opacity-80" />}
          </div>
          {soldPeriod || arrivedDates.length > 0 ? (
            <p className="w-full text-[13px] text-muted">
              {soldPeriod ? soldPeriod.sentence : `Sold is for ${formatDayLabel(reportDate)}.`}
              {arrivedDates.length > 0 ? ` Current adds stock in from ${arrivedDates.map((day) => formatDayLabel(day)).join(', ')}.` : ''}
            </p>
          ) : null}
          {badgeFilter.length > 0 ? (
            <p className="w-full text-[13px] font-medium text-ink">
              Showing {badgeFilter.map((key) => badgeLabel[key]).join(', ')} · {badgeRows.length} of {viewRows.length} items
            </p>
          ) : null}
          {photo ? null : <p className="w-full text-[13px] text-muted">Tap an item to change or remove its badge.</p>}
        </header>
        {isVegies ? (
          photo && sections.vegies.length > 1 ? (
            <PhotoColumns
              title="Vegies"
              left={[{ items: sections.vegies.slice(0, vegieMidpoint) }]}
              right={[{ items: sections.vegies.slice(vegieMidpoint) }]}
              insights={insights}
              stockLabel={stockLabel} soldLabel={soldLabel}
            />
          ) : (
            <ReportArea title="Vegies" groups={[{ items: sections.vegies }]} insights={insights} stockLabel={stockLabel} soldLabel={soldLabel} onSelectItem={photo ? undefined : openFlagPicker} />
          )
        ) : (
          <>
            {photo && sections.right.length > 0 ? (
              <PhotoColumns title="Inside coolroom" left={sections.left} right={sections.right} insights={insights} stockLabel={stockLabel} soldLabel={soldLabel} />
            ) : (
              <ReportArea title="Inside coolroom" groups={[...sections.left, ...sections.right]} insights={insights} stockLabel={stockLabel} soldLabel={soldLabel} onSelectItem={photo ? undefined : openFlagPicker} />
            )}
            <ReportArea title="Unclassified / staff inspection" groups={[{ items: sections.unknown }]} insights={insights} stockLabel={stockLabel} soldLabel={soldLabel} onSelectItem={photo ? undefined : openFlagPicker} />
            {photo && sections.outside.length > 0 ? (
              <PhotoColumns
                title="Outside coolroom"
                left={[{ items: sections.outside.slice(0, midpoint) }]}
                right={[{ items: sections.outside.slice(midpoint) }]}
                insights={insights}
                stockLabel={stockLabel} soldLabel={soldLabel}
              />
            ) : (
              <ReportArea title="Outside coolroom" groups={[{ items: sections.outside }]} insights={insights} stockLabel={stockLabel} soldLabel={soldLabel} onSelectItem={photo ? undefined : openFlagPicker} />
            )}
          </>
        )}
      </div>
    )
  }

  const shownError = exportError ?? error
  const canExport = hasReport && badgeRows.length > 0 && !isLoading && !isExporting

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
        <div className="flex gap-2" role="group" aria-label="Report">
          {(['fruit', 'vegies'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => { setView(key); setBadgeFilter([]) }}
              aria-pressed={view === key}
              className={`${chipClass} flex-1 justify-center sm:flex-none ${view === key ? chipOn : chipOff}`}
            >
              {viewLabel[key]} <span className="tabular opacity-70">{viewCounts[key]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {hasReport ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                if (showSuggestions) setSearchOpen(false)
                else setQuery('')
              } else if (event.key === 'ArrowDown' && showSuggestions) {
                event.preventDefault()
                setHighlight((index) => Math.min(index + 1, suggestions.length - 1))
              } else if (event.key === 'ArrowUp' && showSuggestions) {
                event.preventDefault()
                setHighlight((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter' && showSuggestions) {
                event.preventDefault()
                pickSuggestion(suggestions[Math.min(highlight, suggestions.length - 1)])
              }
            }}
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="daily-report-options"
            placeholder="Find an item"
            aria-label="Find an item in the report"
            enterKeyHint="search"
            autoComplete="off"
            className={`${fieldClass} pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-control text-muted hover:text-ink"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          {showSuggestions ? (
            <div id="daily-report-options" role="listbox" aria-label="Matching items" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-control border border-line bg-surface shadow-raised">
              {suggestions.map((row, index) => (
                <button
                  key={row.code}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickSuggestion(row)}
                  className={`flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left last:border-b-0 ${index === highlight ? 'bg-forest-50' : 'hover:bg-slate-50 active:bg-slate-100'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-ink">{row.official_name}</span>
                    <span className="block truncate text-[12px] text-muted">{row.category || row.code}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-forest-50 px-2 py-0.5 text-[12px] font-medium text-forest-800 tabular">has {formatQuantity(row.current)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasReport ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Show items with badge">
          <button
            type="button"
            onClick={() => setBadgeFilter([])}
            aria-pressed={badgeFilter.length === 0}
            className={`${chipClass} ${badgeFilter.length === 0 ? chipOn : chipOff}`}
          >
            All <span className="tabular opacity-70">{viewRows.length}</span>
          </button>
          {badgeKeys.map((key) => {
            const on = badgeFilter.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleBadge(key)}
                aria-pressed={on}
                className={`${chipClass} ${on ? chipOn : chipOff}`}
              >
                {key !== 'none' ? <span className={`h-2 w-2 shrink-0 rounded-full ${badgeDot[key]}`} aria-hidden="true" /> : null}
                {badgeLabel[key]} <span className="tabular opacity-70">{badgeCounts.get(key) ?? 0}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {hasReport && badgeFilter.length > 0 && badgeRows.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">No item has {badgeFilter.length === 1 ? 'this badge' : 'these badges'}.</p>
      ) : null}

      {hasReport && viewRows.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">No {viewLabel[view].toLowerCase()} items in the catalog yet.</p>
      ) : null}

      {hasReport && terms.length > 0 ? (
        <p className="px-1 text-[13px] text-muted" aria-live="polite">
          {shownRows.length === 0
            ? `No item matches "${query.trim()}".`
            : `${shownRows.length} of ${badgeRows.length} items`}
        </p>
      ) : null}

      {hasReport && shownRows.length > 0 ? (
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
