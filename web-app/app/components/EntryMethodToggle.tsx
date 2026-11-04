import type { ReactNode } from 'react'
import { Camera, Keyboard } from 'lucide-react'

type EntryMode = 'manual' | 'photo'

type EntryMethodToggleProps = {
  value: EntryMode
  onManual: () => void
  onPhoto: () => void
  manualLabel?: string
  photoLabel?: string
  manualHelpText: string
  photoHelpText: string
  actionSlot?: ReactNode
}

/** Segmented switch between typing counts and parsing a photo of the paper sheet. */
export function EntryMethodToggle({
  value,
  onManual,
  onPhoto,
  manualLabel = 'Type',
  photoLabel = 'Photo',
  manualHelpText,
  photoHelpText,
  actionSlot,
}: EntryMethodToggleProps) {
  const option = (mode: EntryMode, label: string, Icon: typeof Camera, onSelect: () => void) => {
    const active = value === mode
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={active ? undefined : onSelect}
        className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-[15px] font-medium transition-colors duration-150 ${
          active ? 'cursor-default bg-surface text-ink shadow-[0_1px_2px_rgba(20,32,27,0.12)]' : 'text-muted hover:text-ink'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Entry method" className="flex flex-1 rounded-control bg-slate-100 p-1">
          {option('manual', manualLabel, Keyboard, onManual)}
          {option('photo', photoLabel, Camera, onPhoto)}
        </div>
        {actionSlot ? <div className="shrink-0">{actionSlot}</div> : null}
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{value === 'manual' ? manualHelpText : photoHelpText}</p>
    </div>
  )
}
