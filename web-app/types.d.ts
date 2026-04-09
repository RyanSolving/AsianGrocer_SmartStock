declare module '*.css'

// Stock Check Types
type StockCheckItem = {
  code: string
  product: string
  category: string
  location: string
  sub_location: string
  official_name: string
  stocklist_name: string
  quantity: number | null
  red_marked: boolean
  notes: string | null
}

type StockCheckUnknownItem = {
  user_input: string
  quantity: number | null
  red_marked: boolean
  notes: string | null
}

type StockCheckPayload = {
  date: string
  items: StockCheckItem[]
  unknown_items: StockCheckUnknownItem[]
  validated: boolean
  export_format?: 'csv' | 'pdf' | 'image'
}
