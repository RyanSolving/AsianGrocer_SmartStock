import type { ReactNode } from 'react'

const INTERACTIVE_SELECTOR = 'input:not([readonly]), textarea, select, button, a, [contenteditable="true"]'

function isInteractiveTarget(target: EventTarget | null, container: Element) {
  if (!(target instanceof Element)) return false
  const hit = target.closest(INTERACTIVE_SELECTOR)
  return hit !== null && hit !== container && container.contains(hit)
}

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ')
}

type IndexableRow = { index: number }

export type LedgerGroup<T> = { id: string; title?: string; items: T[] }
export type LedgerArea<T> = { id: string; title: string; groups: LedgerGroup<T>[]; tone?: 'alert' }

type CardSection<T> = { id: string; title: string; items: T[] }

/**
 * Groups the phone sections into the Daily Report's areas: the coolroom categories under
 * "Inside coolroom", then "Outside coolroom", then unclassified items.
 */
export function toLedgerAreas<T>(sections: CardSection<T>[], ids: { outside: string; unknown: string }): LedgerArea<T>[] {
  const inside = sections.filter((section) => section.id !== ids.outside && section.id !== ids.unknown)
  const outside = sections.find((section) => section.id === ids.outside)
  const unknown = sections.find((section) => section.id === ids.unknown)
  const areas: LedgerArea<T>[] = []

  if (inside.length > 0) {
    areas.push({ id: 'inside', title: 'Inside coolroom', groups: inside.map((section) => ({ id: section.id, title: section.title, items: section.items })) })
  }
  if (outside && outside.items.length > 0) {
    areas.push({ id: outside.id, title: 'Outside coolroom', groups: [{ id: outside.id, items: outside.items }] })
  }
  if (unknown && unknown.items.length > 0) {
    areas.push({ id: unknown.id, title: 'Unclassified / staff inspection', tone: 'alert', groups: [{ id: unknown.id, items: unknown.items }] })
  }
  return areas
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={joinClasses('h-4 w-4 shrink-0 transition-transform duration-150', open && 'rotate-180')}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type StockLedgerProps<T extends IndexableRow> = {
  areas: LedgerArea<T>[]
  keyPrefix: string
  /** Header of the number column, e.g. "Closing" or "Stock in". */
  quantityLabel: string
  /** Stock In: header of an extra price column, drawn when `renderPriceCell` is given. */
  priceLabel?: string
  renderPriceCell?: (item: T) => ReactNode
  isCollapsed?: (id: string) => boolean
  onToggleCollapse?: (id: string) => void
  getRowClass?: (index?: number) => string
  renderName: (item: T) => ReactNode
  renderQuantityCell: (item: T) => ReactNode
  /** Adds a small remove button at the end of each row. */
  onRemove?: (item: T) => void
  /** Accessible name of an item, for the remove button's label. */
  getItemLabel?: (item: T) => string
}

/**
 * The phone list for Check Stock and Stock In, laid out like the Daily Report sheet:
 * an area bar, an Item / quantity header, a sage band per category (tap to fold), and one
 * row per item with its count box on the right. Tapping a row puts the cursor in its count.
 */
export function StockLedger<T extends IndexableRow>({
  areas,
  keyPrefix,
  quantityLabel,
  priceLabel = 'Price',
  renderPriceCell,
  isCollapsed,
  onToggleCollapse,
  getRowClass,
  renderName,
  renderQuantityCell,
  onRemove,
  getItemLabel,
}: StockLedgerProps<T>) {
  const columnCount = 2 + (renderPriceCell ? 1 : 0) + (onRemove ? 1 : 0)
  if (areas.length === 0) return null

  return (
    <div className="report-screen stock-ledger overflow-hidden rounded-card border border-line bg-surface">
      {areas.map((area) => {
        const isSingleGroup = area.groups.length === 1 && !area.groups[0].title
        const areaOpen = !(isSingleGroup && isCollapsed?.(area.id))
        const barClass = joinClasses('report-area-title', area.tone === 'alert' && 'stock-ledger-alert')

        return (
          <section key={`${keyPrefix}-${area.id}`}>
            {isSingleGroup && onToggleCollapse ? (
              <button type="button" className={joinClasses(barClass, 'stock-ledger-bar-btn')} onClick={() => onToggleCollapse(area.id)} aria-expanded={areaOpen}>
                <span>{area.title}</span>
                <Chevron open={areaOpen} />
              </button>
            ) : (
              <h3 className={barClass}>{area.title}</h3>
            )}

            {areaOpen ? (
              <table className="report-ledger">
                <colgroup>
                  <col />
                  <col className="stock-ledger-qty-col" />
                  {renderPriceCell ? <col className="stock-ledger-price-col" /> : null}
                  {onRemove ? <col className="stock-ledger-remove-col" /> : null}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">{quantityLabel}</th>
                    {renderPriceCell ? <th scope="col">{priceLabel}</th> : null}
                    {onRemove ? <th scope="col"><span className="sr-only">Remove</span></th> : null}
                  </tr>
                </thead>
                {area.groups.filter((group) => group.items.length > 0).map((group) => {
                  const groupOpen = !(group.title && isCollapsed?.(group.id))
                  return (
                    <tbody key={`${keyPrefix}-${group.id}`}>
                      {group.title ? (
                        <tr>
                          <th scope="rowgroup" colSpan={columnCount} className="report-category">
                            {onToggleCollapse ? (
                              <button type="button" className="stock-ledger-band-btn" onClick={() => onToggleCollapse(group.id)} aria-expanded={groupOpen}>
                                <span className="min-w-0 flex-1 truncate">{group.title}</span>
                                <span className="tabular text-[12px] font-medium normal-case tracking-normal opacity-70">{group.items.length}</span>
                                <Chevron open={groupOpen} />
                              </button>
                            ) : (
                              <span className="stock-ledger-band-btn">{group.title}</span>
                            )}
                          </th>
                        </tr>
                      ) : null}
                      {groupOpen ? group.items.map((item) => (
                        <tr
                          key={`${keyPrefix}-row-${item.index}`}
                          className={getRowClass?.(item.index)}
                          onClick={(event) => {
                            if (isInteractiveTarget(event.target, event.currentTarget)) return
                            event.currentTarget.querySelector<HTMLInputElement>('input.stock-qty-input')?.focus()
                          }}
                        >
                          <th scope="row">{renderName(item)}</th>
                          <td>{renderQuantityCell(item)}</td>
                          {renderPriceCell ? <td className="stock-ledger-price-cell">{renderPriceCell(item)}</td> : null}
                          {onRemove ? (
                            <td className="stock-ledger-remove-cell">
                              <button
                                type="button"
                                className="stock-ledger-remove-btn"
                                aria-label={`Remove ${getItemLabel?.(item) ?? 'item'} from today's list`}
                                title="Remove from today's list"
                                onClick={() => onRemove(item)}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                                  <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      )) : null}
                    </tbody>
                  )
                })}
              </table>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
