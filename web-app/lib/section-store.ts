'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { parseSectionChoice, type SectionChoice } from './sections'

/**
 * The Fruit / Vegies / Both choice, remembered on this device and shared by every screen
 * (Stock In, Stock Check, Daily Report, Dashboard, Home). It is a preference of the person
 * using the phone, not a store setting.
 */

const STORAGE_KEY = 'asiangrocer.section'
const DEFAULT_CHOICE: SectionChoice = 'both'
const listeners = new Set<() => void>()

function read(): SectionChoice {
  if (typeof window === 'undefined') return DEFAULT_CHOICE
  try {
    return parseSectionChoice(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_CHOICE
  } catch {
    return DEFAULT_CHOICE
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setSectionChoice(choice: SectionChoice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Private mode: the choice then lasts until the page closes (listeners still update below).
  }
  listeners.forEach((listener) => listener())
}

export function useSectionChoice(): [SectionChoice, (choice: SectionChoice) => void] {
  const choice = useSyncExternalStore(subscribe, read, () => DEFAULT_CHOICE)
  return [choice, useCallback((next: SectionChoice) => setSectionChoice(next), [])]
}
