import type { ReactNode } from 'react'

type IndexableRow = {
  index: number
}

type SplitRows<T extends IndexableRow> = {
  left: T[]
  right: T[]
  single: T[]
}

type Section<T extends IndexableRow> = {
  title: string
  rows: SplitRows<T>
}

type ThreeColumns<T extends IndexableRow> = {
  left: T[]
  middle: T[]
  right: T[]
}

type StockPaperSectionTableProps<T extends IndexableRow> = {
  section: Section<T>
  keyPrefix: string
  getCellClass?: (index?: number) => string
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  renderLabelCell: (item: T, className: string) => ReactNode
  renderQuantityCell: (item: T) => ReactNode
}

type StockPaperThreeColumnTableProps<T extends IndexableRow> = {
  columns: ThreeColumns<T>
  keyPrefix: string
  getCellClass?: (index?: number) => string
  renderLabelCell: (item: T, className: string) => ReactNode
  renderQuantityCell: (item: T) => ReactNode
}

type StockPaperCardSectionProps<T extends IndexableRow> = {
  title: string
  items: T[]
  keyPrefix: string
  getCardClass?: (index?: number) => string
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  onPressRow?: (item: T) => void
  renderLabelCell: (item: T, className: string) => ReactNode
  renderQuantityCell: (item: T) => ReactNode
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function StockPaperSectionTable<T extends IndexableRow>({
  section,
  keyPrefix,
  getCellClass,
  isCollapsed = false,
  onToggleCollapse,
  renderLabelCell,
  renderQuantityCell,
}: StockPaperSectionTableProps<T>) {
  const maxRows = Math.max(section.rows.left.length, section.rows.right.length)

  return (
    <div>
      {onToggleCollapse ? (
        <button
          type="button"
          className="stock-sub-hdr stock-sub-hdr-btn"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
        >
          <span>{section.title}</span>
          <span className="stock-collapse-indicator" aria-hidden="true">{isCollapsed ? '+' : '-'}</span>
        </button>
      ) : (
        <div className="stock-sub-hdr">{section.title}</div>
      )}
      {isCollapsed ? null : (
      <table className="stock-pt">
        <colgroup>
          <col style={{ width: '34%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <tbody>
          {Array.from({ length: maxRows }).map((_, i) => {
            const left = section.rows.left[i]
            const right = section.rows.right[i]
            return (
              <tr key={`${keyPrefix}-${section.title}-pair-${i}`}>
                <td className={joinClasses('stock-lbl', getCellClass?.(left?.index))}>
                  {left ? renderLabelCell(left, 'stock-input') : null}
                </td>
                <td className={joinClasses('stock-qty', getCellClass?.(left?.index))}>
                  {left ? renderQuantityCell(left) : null}
                </td>
                <td className={joinClasses('stock-lbl', getCellClass?.(right?.index))}>
                  {right ? renderLabelCell(right, 'stock-input') : null}
                </td>
                <td className={joinClasses('stock-qty', getCellClass?.(right?.index))}>
                  {right ? renderQuantityCell(right) : null}
                </td>
              </tr>
            )
          })}

          {section.rows.single.map((single, i) => (
            <tr key={`${keyPrefix}-${section.title}-single-${i}`} className="stock-hw-row">
              <td className={joinClasses('stock-lbl', getCellClass?.(single.index))} colSpan={3}>
                {renderLabelCell(single, 'stock-input stock-input-hw')}
              </td>
              <td className={joinClasses('stock-qty', getCellClass?.(single.index))}>{renderQuantityCell(single)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </div>
  )
}

export function StockPaperThreeColumnTable<T extends IndexableRow>({
  columns,
  keyPrefix,
  getCellClass,
  renderLabelCell,
  renderQuantityCell,
}: StockPaperThreeColumnTableProps<T>) {
  return (
    <div className="stock-outside-grid">
      <div className="stock-oc-col">
        <table className="stock-pt">
          <colgroup>
            <col style={{ width: '70%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
          <tbody>
            {columns.left.map((item, i) => (
              <tr key={`${keyPrefix}-left-${i}`}>
                <td className={joinClasses('stock-lbl', getCellClass?.(item.index))}>{renderLabelCell(item, 'stock-input')}</td>
                <td className={joinClasses('stock-qty', getCellClass?.(item.index))}>{renderQuantityCell(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stock-oc-col">
        <table className="stock-pt">
          <colgroup>
            <col style={{ width: '70%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
          <tbody>
            {columns.middle.map((item, i) => (
              <tr key={`${keyPrefix}-middle-${i}`}>
                <td className={joinClasses('stock-lbl', getCellClass?.(item.index))}>{renderLabelCell(item, 'stock-input')}</td>
                <td className={joinClasses('stock-qty', getCellClass?.(item.index))}>{renderQuantityCell(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stock-oc-col">
        <table className="stock-pt">
          <colgroup>
            <col style={{ width: '70%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
          <tbody>
            {columns.right.map((item, i) => (
              <tr key={`${keyPrefix}-right-${i}`}>
                <td className={joinClasses('stock-lbl', getCellClass?.(item.index))}>{renderLabelCell(item, 'stock-input')}</td>
                <td className={joinClasses('stock-qty', getCellClass?.(item.index))}>{renderQuantityCell(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function StockPaperCardSection<T extends IndexableRow>({
  title,
  items,
  keyPrefix,
  getCardClass,
  isCollapsed = false,
  onToggleCollapse,
  onPressRow,
  renderLabelCell,
  renderQuantityCell,
}: StockPaperCardSectionProps<T>) {
  if (items.length === 0) return null

  return (
    <div className="space-y-1">
      {onToggleCollapse ? (
        <button
          type="button"
          className="stock-mobile-section-hdr stock-mobile-section-hdr-btn"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
        >
          <span>{title}</span>
          <span className="stock-collapse-indicator" aria-hidden="true">{isCollapsed ? '+' : '-'}</span>
        </button>
      ) : (
        <div className="stock-mobile-section-hdr">{title}</div>
      )}
      {isCollapsed ? null : <div className="space-y-1">
        {items.map((item, i) => (
          <div
            key={`${keyPrefix}-${title}-card-${i}`}
            role={onPressRow ? 'button' : undefined}
            tabIndex={onPressRow ? 0 : undefined}
            onClick={() => onPressRow?.(item)}
            onKeyDown={(event) => {
              if (!onPressRow) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onPressRow(item)
              }
            }}
            className={joinClasses('stock-mobile-card text-left', getCardClass?.(item.index))}
          >
            <div className="stock-mobile-card-grid">
              <div className="stock-mobile-card-label">{renderLabelCell(item, 'stock-input')}</div>
              <div className="stock-mobile-card-qty-wrap">
                <span className="stock-mobile-qty-label">Qty</span>
                <div className="stock-mobile-card-qty">{renderQuantityCell(item)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>}
    </div>
  )
}
