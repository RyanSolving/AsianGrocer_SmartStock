'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { Sheet } from './ui/Sheet'

export type Choice<T extends string> = {
  value: T
  label: string
  description?: string
  primary?: boolean
}

type Question<T extends string> = {
  title: string
  message?: ReactNode
  choices: Choice<T>[]
}

/**
 * Ask one question with a few labelled answers and wait for it:
 * `const answer = await ask({ title, choices })` gives the chosen value, or null when
 * the sheet is closed. Render `choiceSheet` once in the component.
 */
export function useChoiceSheet() {
  const [question, setQuestion] = useState<Question<string> | null>(null)
  const resolveRef = useRef<((value: string | null) => void) | null>(null)

  const answer = useCallback((value: string | null) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setQuestion(null)
  }, [])

  const ask = useCallback(<T extends string>(next: Question<T>) => {
    resolveRef.current?.(null)
    setQuestion(next as Question<string>)
    return new Promise<T | null>((resolve) => {
      resolveRef.current = resolve as (value: string | null) => void
    })
  }, [])

  const choiceSheet = (
    <Sheet open={question !== null} onClose={() => answer(null)} title={question?.title ?? ''} description={question?.message} size="sm">
      <div className="space-y-2">
        {question?.choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            onClick={() => answer(choice.value)}
            className={`flex min-h-14 w-full items-center gap-3 rounded-control px-4 py-3 text-left transition-colors duration-150 ${
              choice.primary
                ? 'bg-forest text-white hover:bg-forest-700'
                : 'border border-line bg-surface text-ink hover:bg-slate-50'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">{choice.label}</span>
              {choice.description ? (
                <span className={`mt-0.5 block text-[13px] ${choice.primary ? 'text-white/80' : 'text-muted'}`}>{choice.description}</span>
              ) : null}
            </span>
            <ChevronRight className={`h-5 w-5 shrink-0 ${choice.primary ? 'text-white/80' : 'text-muted'}`} aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => answer(null)}
          className="flex min-h-12 w-full items-center justify-center rounded-control text-[15px] font-medium text-muted hover:bg-slate-50"
        >
          Go back
        </button>
      </div>
    </Sheet>
  )

  return { ask, choiceSheet }
}
