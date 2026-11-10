import { sectionLabel, type SectionChoice } from './sections'

type SectionAnswer = { value: SectionChoice; label: string; description: string; primary: boolean }

const descriptions: Record<'count' | 'receive', Record<SectionChoice, string>> = {
  count: {
    fruit: 'Count the fruit and nuts',
    vegies: 'Count the vegies',
    both: '',
  },
  receive: {
    fruit: 'Fruit and nuts that arrived',
    vegies: 'Vegies that arrived',
    both: 'One delivery, saved as a fruit record and a vegies record',
  },
}

/**
 * The pop-up asked before Stock Close or Stock In entry starts. Stock Close is one section at a
 * time (two people count separately); Stock In can also be Both (one person enters the delivery).
 * The current choice is highlighted.
 */
export function sectionQuestion(kind: 'count' | 'receive', current: SectionChoice) {
  const choices: SectionChoice[] = kind === 'receive' ? ['fruit', 'vegies', 'both'] : ['fruit', 'vegies']
  return {
    title: kind === 'count' ? 'What are you counting?' : 'What arrived?',
    choices: choices.map((value): SectionAnswer => ({
      value,
      label: sectionLabel[value],
      description: descriptions[kind][value],
      primary: value === current,
    })),
  }
}
