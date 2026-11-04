'use client'

import { useState, type ReactNode } from 'react'
import { BarChart3, ClipboardList, Database, History, LogIn, LogOut, Menu, PackagePlus, ScanSearch } from 'lucide-react'

import { BrandMark } from './BrandMark'
import { IconButton } from './ui/Button'
import { Sheet } from './ui/Sheet'

export type ShellSection = 'data-entry' | 'stock-check' | 'daily-report' | 'dashboard' | 'catalog'

type NavItem = { id: ShellSection; label: string; short: string; icon: typeof BarChart3 }

export const NAV_ITEMS: NavItem[] = [
  { id: 'data-entry', label: 'Stock In', short: 'Stock In', icon: PackagePlus },
  { id: 'stock-check', label: 'Check Stock', short: 'Check', icon: ScanSearch },
  { id: 'daily-report', label: 'Daily Report', short: 'Report', icon: ClipboardList },
  { id: 'dashboard', label: 'Dashboard', short: 'Dashboard', icon: BarChart3 },
]

const MANAGEMENT_ITEMS: NavItem[] = [{ id: 'catalog', label: 'Catalog', short: 'Catalog', icon: Database }]

export type SyncState = {
  isOnline: boolean
  pendingCount: number
  isSyncing: boolean
}

type AppShellProps = {
  active: ShellSection
  onNavigate: (section: ShellSection) => void
  sync: SyncState
  account: { email: string | null; roles: string[] } | null
  isAuthLoading: boolean
  onSignOut: () => void
  /** Shown as a History button in the header when set (Stock In and Check Stock). */
  onOpenHistory?: () => void
  historyLabel?: string
  children: ReactNode
}

function syncLabel({ isOnline, pendingCount, isSyncing }: SyncState) {
  if (!isOnline) return pendingCount > 0 ? `Offline · ${pendingCount} waiting` : 'Offline'
  if (isSyncing) return 'Syncing…'
  if (pendingCount > 0) return `${pendingCount} waiting to sync`
  return 'Online'
}

function SyncDot({ sync, onDark = false }: { sync: SyncState; onDark?: boolean }) {
  const color = !sync.isOnline ? 'bg-[#f5a524]' : sync.isSyncing || sync.pendingCount > 0 ? 'bg-[#7cc4ff]' : 'bg-accent'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${onDark ? 'text-white/80' : 'text-muted'}`}>
      <span className={`h-2 w-2 rounded-full ${color} ${sync.isSyncing ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span className={onDark ? 'sr-only sm:not-sr-only' : ''}>{syncLabel(sync)}</span>
    </span>
  )
}

function AccountBlock({ account, isAuthLoading, onSignOut }: Pick<AppShellProps, 'account' | 'isAuthLoading' | 'onSignOut'>) {
  if (isAuthLoading) return <p className="text-[14px] text-muted">Checking sign-in…</p>
  if (!account) {
    return (
      <a href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-[15px] font-medium text-ink hover:bg-slate-100">
        <LogIn className="h-5 w-5" aria-hidden="true" />
        Sign in
      </a>
    )
  }
  return (
    <div className="space-y-2">
      <div className="min-w-0 px-3">
        <p className="truncate text-[14px] font-medium text-ink">{account.email ?? 'Signed in'}</p>
        <p className="text-[13px] capitalize text-muted">{account.roles.join(', ') || 'Staff'}</p>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] text-ink hover:bg-slate-100"
      >
        <LogOut className="h-5 w-5 text-muted" aria-hidden="true" />
        Sign out
      </button>
    </div>
  )
}

export function AppShell({ active, onNavigate, sync, account, isAuthLoading, onSignOut, onOpenHistory, historyLabel = 'History', children }: AppShellProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const activeItem = [...NAV_ITEMS, ...MANAGEMENT_ITEMS].find((item) => item.id === active)

  const railButton = (item: NavItem) => {
    const Icon = item.icon
    const selected = item.id === active
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onNavigate(item.id)}
        aria-current={selected ? 'page' : undefined}
        className={`relative flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] transition-colors duration-150 ${
          selected ? 'bg-white/10 font-semibold text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
        }`}
      >
        {selected ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" aria-hidden="true" /> : null}
        <Icon className="h-5 w-5" aria-hidden="true" />
        {item.label}
      </button>
    )
  }

  return (
    <div className="min-h-dvh bg-ground md:flex">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-forest-900 px-3 py-5 md:flex">
        <div className="px-2 pb-6">
          <BrandMark size="md" withWordmark onDark eyebrow="Stock" title="Asian Grocer" />
        </div>
        <nav className="space-y-1" aria-label="Main">
          {NAV_ITEMS.map(railButton)}
          <p className="px-3 pb-1 pt-5 text-[13px] text-white/50">Manage</p>
          {MANAGEMENT_ITEMS.map(railButton)}
        </nav>
        <div className="mt-auto space-y-3 border-t border-white/10 px-1 pt-4">
          <div className="px-2">
            <SyncDot sync={sync} onDark />
          </div>
          {account ? (
            <div className="px-2">
              <p className="truncate text-[13px] text-white/80">{account.email ?? 'Signed in'}</p>
              <button type="button" onClick={onSignOut} className="mt-1 inline-flex min-h-9 items-center gap-2 text-[14px] text-white/70 hover:text-white">
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
              </button>
            </div>
          ) : !isAuthLoading ? (
            <a href="/login" className="mx-2 inline-flex min-h-9 items-center gap-2 text-[14px] text-white hover:underline">
              <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
            </a>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phone top bar */}
        <header className="safe-top sticky top-0 z-40 bg-forest-900 text-white md:hidden">
          <div className="flex h-14 items-center gap-2 pl-4 pr-1">
            <BrandMark size="sm" withWordmark onDark title={activeItem?.label ?? 'Asian Grocer'} className="flex-1" />
            <SyncDot sync={sync} onDark />
            {onOpenHistory ? (
              <IconButton label={historyLabel} tone="onDark" onClick={onOpenHistory}>
                <History className="h-5 w-5" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        </header>

        {/* Desktop page header with the contextual history action */}
        {onOpenHistory ? (
          <div className="mx-auto hidden max-w-6xl justify-end px-8 pt-5 md:flex">
            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line bg-surface px-3 text-[14px] font-medium text-ink hover:bg-slate-100"
            >
              <History className="h-4 w-4" aria-hidden="true" /> {historyLabel}
            </button>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl px-3 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+20px)] pt-3 sm:px-4 md:px-8 md:pb-10 md:pt-4">
          {children}
        </main>
      </div>

      {/* Phone tab bar */}
      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur md:hidden"
      >
        <div className="grid h-[var(--tabbar-h)] grid-cols-5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const selected = item.id === active
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={selected ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 text-[12px] ${selected ? 'font-semibold text-forest-900' : 'text-muted'}`}
              >
                {selected ? <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" aria-hidden="true" /> : null}
                <Icon className="h-[22px] w-[22px]" strokeWidth={selected ? 2.25 : 1.75} aria-hidden="true" />
                {item.short}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            aria-current={active === 'catalog' ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 text-[12px] ${active === 'catalog' ? 'font-semibold text-forest-900' : 'text-muted'}`}
          >
            {active === 'catalog' ? <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" aria-hidden="true" /> : null}
            <Menu className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
            More
          </button>
        </div>
      </nav>

      <Sheet open={isMoreOpen} onClose={() => setIsMoreOpen(false)} title="More" size="sm">
        <div className="space-y-4">
          <div className="space-y-1">
            {MANAGEMENT_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onNavigate(item.id)
                    setIsMoreOpen(false)
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-left text-[16px] text-ink hover:bg-slate-100"
                >
                  <Icon className="h-5 w-5 text-muted" aria-hidden="true" />
                  {item.label}
                </button>
              )
            })}
          </div>
          <div className="rounded-control bg-slate-50 px-3 py-2.5">
            <SyncDot sync={sync} />
          </div>
          <div className="border-t border-line pt-3">
            <AccountBlock account={account} isAuthLoading={isAuthLoading} onSignOut={onSignOut} />
          </div>
        </div>
      </Sheet>
    </div>
  )
}
