'use client'

import { FormEvent, useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { createSupabaseBrowserClient } from '../../lib/supabase/client'
import { BrandTile } from '../components/BrandMark'
import { Button } from '../components/ui/Button'
import { fieldClass } from '../components/ui/Input'

export default function LoginPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setIsSubmitting(true)
    setError(null)

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) throw loginError
      const nextPath = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null
      window.location.href = nextPath && nextPath.startsWith('/') ? nextPath : '/'
    } catch (submitError) {
      const raw = submitError instanceof Error ? submitError.message : ''
      setError(/invalid login credentials/i.test(raw) ? 'Email or password is not right.' : raw || 'Could not sign in. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-forest-900 md:grid md:grid-cols-2">
      {/* Brand field: the shop's own name, set large like its sign. */}
      <section className="safe-top relative flex flex-1 flex-col justify-end overflow-hidden px-6 pb-14 pt-16 md:min-h-dvh md:px-14 md:pb-16">
        <span
          aria-hidden="true"
          lang="zh-Hant"
          className="pointer-events-none absolute -right-4 top-10 select-none whitespace-pre text-[104px] font-medium leading-[1.08] text-white/[0.06] [font-family:'Noto_Sans_TC','PingFang_TC','Microsoft_JhengHei',sans-serif] md:right-8 md:top-12 md:text-[160px]"
        >
          {'新興\n雜貨'}
        </span>

        <div className="relative max-w-md">
          <BrandTile size="lg" className="rounded-[18px]" />
          <p className="mt-8 text-[36px] font-semibold leading-[1.05] tracking-[-0.02em] text-white md:text-[48px]">
            Asian Grocer
          </p>
          <p className="mt-3 max-w-[22rem] text-[16px] leading-relaxed text-forest-100/80 md:text-[18px]">
            Stock in, stock close and the daily report, in one place.
          </p>
        </div>
      </section>

      <section className="safe-bottom relative -mt-6 animate-sheet-in rounded-t-[28px] bg-surface px-6 pb-8 pt-8 md:mt-0 md:flex md:min-h-dvh md:items-center md:justify-center md:rounded-none md:px-14">
        <div className="w-full md:max-w-sm">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">Sign in</h1>
          <p className="mt-1.5 text-[15px] text-muted">Use the account your store admin set up for you.</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5">
            <div className="space-y-1.5">
              <label className="block text-[14px] font-medium text-ink" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={`${fieldClass} min-h-12 bg-ground/60 focus:bg-surface`}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[14px] font-medium text-ink" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${fieldClass} min-h-12 bg-ground/60 pr-12 focus:bg-surface`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-control text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600/30"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-control bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" block loading={isSubmitting} loadingLabel="Signing in…" className="!mt-7">
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </main>
  )
}
