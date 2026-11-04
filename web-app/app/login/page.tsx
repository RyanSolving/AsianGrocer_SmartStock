'use client'

import { FormEvent, useMemo, useState } from 'react'

import { createSupabaseBrowserClient } from '../../lib/supabase/client'
import { BrandLogo } from '../components/BrandMark'
import { Button } from '../components/ui/Button'
import { fieldClass, inputClass } from '../components/ui/Input'

export default function LoginPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <main className="flex min-h-dvh flex-col bg-forest">
      <div className="safe-top flex flex-1 flex-col justify-end px-6 pb-10 pt-16 sm:items-center sm:justify-center sm:pb-16">
        <div className="w-full sm:max-w-sm">
          <BrandLogo className="w-72" />
          <p className="mt-6 text-[15px] leading-relaxed text-white/70">
            Stock in, closing counts and the daily report, in one place.
          </p>
        </div>
      </div>

      <div className="safe-bottom rounded-t-[24px] bg-surface px-6 pb-8 pt-7 sm:mx-auto sm:mb-16 sm:w-full sm:max-w-sm sm:rounded-card sm:pb-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Sign in</h1>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
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
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`${fieldClass} min-h-12`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[14px] font-medium text-ink" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${fieldClass} min-h-12`}
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-[14px] text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" block loading={isSubmitting} loadingLabel="Signing in…">
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-[13px] text-muted">Accounts are created by the store admin.</p>
      </div>
    </main>
  )
}
