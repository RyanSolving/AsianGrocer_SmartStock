'use client'

import { sectionLabel, type SectionChoice } from '../../lib/sections'

const allChoices: SectionChoice[] = ['fruit', 'vegies', 'both']

/**
 * Fruit / Vegies / Both, as one row of buttons. Entry screens leave out Both when a record
 * can only belong to one section (Stock Check).
 */
export function SectionPicker({
  value,
  onChange,
  choices = allChoices,
  label = 'Section',
  counts,
  className = '',
}: {
  value: SectionChoice
  onChange: (choice: SectionChoice) => void
  choices?: SectionChoice[]
  label?: string
  /** Item count shown beside each choice. */
  counts?: Partial<Record<SectionChoice, number>>
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={`flex gap-2 ${className}`}>
      {choices.map((choice) => {
        const on = value === choice
        return (
          <button
            key={choice}
            type="button"
            onClick={() => onChange(choice)}
            aria-pressed={on}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control border px-4 text-[15px] font-medium transition-colors duration-150 sm:flex-none sm:min-w-28 ${on ? 'border-forest bg-forest text-white' : 'border-line bg-surface text-ink hover:bg-slate-50'}`}
          >
            {sectionLabel[choice]}
            {counts?.[choice] !== undefined ? <span className="tabular opacity-70">{counts[choice]}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
