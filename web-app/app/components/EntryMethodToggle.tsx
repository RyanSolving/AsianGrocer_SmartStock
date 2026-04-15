type EntryMode = 'manual' | 'photo'

type EntryMethodToggleProps = {
  value: EntryMode
  onManual: () => void
  onPhoto: () => void
  manualLabel?: string
  photoLabel?: string
  manualHelpText: string
  photoHelpText: string
}

export function EntryMethodToggle({
  value,
  onManual,
  onPhoto,
  manualLabel = 'Manual',
  photoLabel = 'Parse from Photo',
  manualHelpText,
  photoHelpText,
}: EntryMethodToggleProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold  tracking-[0.16em] text-slate-500">Entry Method</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onManual}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${value === 'manual'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
        >
          {manualLabel}
        </button>
        <button
          type="button"
          onClick={onPhoto}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${value === 'photo'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
        >
          {photoLabel}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{value === 'manual' ? manualHelpText : photoHelpText}</p>
    </div>
  )
}
