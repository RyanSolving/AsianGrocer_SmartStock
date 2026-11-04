import { redirect } from 'next/navigation'
import { sectionFromQuery } from '../lib/hub-navigation'
import { StockHub } from './StockHub'

export default function Page({ searchParams }: { searchParams: { section?: string | string[] } }) {
  const section = sectionFromQuery(searchParams.section)
  if (section === 'home') redirect('/welcome')
  return <StockHub initialSection={section} />
}
