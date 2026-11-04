'use client'
import { useCallback, useRef, useState, type ReactNode } from 'react'

import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'

type ConfirmDialogProps = {
  isOpen: boolean
  title: string
  message: ReactNode
  confirmLabel?: string // default "Continue"
  cancelLabel?: string // default "Cancel"
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation as a bottom sheet (centred dialog on desktop).
 * Focus starts on the safe button so a stray Enter never confirms a destructive action; Esc cancels.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Sheet
      open={isOpen}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" size="lg" className="sm:min-h-11" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} size="lg" className="sm:min-h-11" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}

type ConfirmRequest = Omit<ConfirmDialogProps, 'isOpen' | 'onConfirm' | 'onCancel'>

/**
 * Promise-based replacement for window.confirm:
 *   const [confirm, confirmElement] = useConfirm()
 *   if (!(await confirm({ title: 'Delete?', message: '…', variant: 'danger' }))) return
 * Render `confirmElement` once in the component.
 */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmRequest) => {
    resolverRef.current?.(false)
    setRequest(next)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = (value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setRequest(null)
  }

  const element = (
    <ConfirmDialog
      isOpen={request !== null}
      title={request?.title ?? ''}
      message={request?.message ?? ''}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      variant={request?.variant}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return [confirm, element]
}
