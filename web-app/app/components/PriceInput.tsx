'use client'

import { useEffect, useState } from 'react'

import { parsePriceInput, roundPrice } from '../../lib/stock-price'

type PriceInputProps = {
  /** The saved price; null when there is none. */
  value: number | null
  onChange: (value: number | null) => void
  'aria-label': string
  /** A different price from the catalog's: drawn with the highlight colour. */
  changed?: boolean
  rowIndex?: number
  /** Called when the box is left, so a list can save the price then. */
  onCommit?: (value: number | null) => void
  /** Called on Enter (the list moves to the next price). */
  onEnter?: () => void
}

/** The resting text of the box: dollars and cents, so every price lines up ("24.50"). */
function restingText(value: number | null) {
  return value === null ? '' : roundPrice(value).toFixed(2)
}

/**
 * Price box of a Stock In row. It keeps what is being typed ("24." stays "24.") and passes on
 * a price only when the text is a valid amount; on leaving the box it shows the saved price.
 */
export function PriceInput({ value, onChange, onCommit, onEnter, changed = false, rowIndex, 'aria-label': ariaLabel }: PriceInputProps) {
  const [text, setText] = useState(restingText(value))
  const [focused, setFocused] = useState(false)

  // The price can change under the box (undo, another row's reset): follow it unless typing.
  useEffect(() => {
    if (!focused) setText(restingText(value))
  }, [value, focused])

  return (
    <span className={`stock-price-field${changed ? ' is-changed' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        data-price-row-index={rowIndex}
        className="stock-price-input"
        aria-label={ariaLabel}
        placeholder="0.00"
        value={text}
        onFocus={(event) => {
          setFocused(true)
          // The whole price is selected, so the first digit typed replaces it. The text itself
          // must not change here: a change after focus would swallow the first keystrokes.
          event.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          setText(restingText(value))
          onCommit?.(value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault()
            onEnter()
          }
        }}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsed = parsePriceInput(next)
          if (parsed.ok) onChange(parsed.value)
        }}
      />
    </span>
  )
}
