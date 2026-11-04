import type { ReactNode } from 'react'

/**
 * The Asian Grocer mark: a green tile with 新興 over 雜貨.
 * The `md` size is the exact badge used on the Daily summary photo, so the export is unchanged.
 */

export const BRAND_GREEN = '#2bb673'

type BrandMarkSize = 'sm' | 'md' | 'lg'

const TILE: Record<BrandMarkSize, string> = {
  sm: 'h-8 w-8 rounded-md text-[9.5px] leading-[1.1]',
  md: 'h-12 w-12 rounded-lg text-[13px] leading-[1.15]',
  lg: 'h-[72px] w-[72px] rounded-[14px] text-[19px] leading-[1.15]',
}

type BrandMarkProps = {
  size?: BrandMarkSize
  /** Adds the "Asian Grocer" wordmark (or custom title block) next to the tile. */
  withWordmark?: boolean
  /** Replaces the default wordmark text. */
  title?: ReactNode
  /** Small line above the title. */
  eyebrow?: ReactNode
  /** Light text for use on the dark green app bar. */
  onDark?: boolean
  className?: string
}

export function BrandTile({ size = 'md', className = '' }: { size?: BrandMarkSize; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center font-bold text-white ${TILE[size]} ${className}`}
      style={{ backgroundColor: BRAND_GREEN }}
    >
      <span>新興</span>
      <span>雜貨</span>
    </div>
  )
}

export function BrandMark({ size = 'md', withWordmark = false, title, eyebrow, onDark = false, className = '' }: BrandMarkProps) {
  if (!withWordmark && !title) {
    return <BrandTile size={size} className={className} />
  }

  const titleClass = size === 'lg' ? 'text-[28px]' : size === 'md' ? 'text-[20px]' : 'text-[16px]'

  return (
    <div className={`flex min-w-0 items-center ${size === 'sm' ? 'gap-2.5' : 'gap-3'} ${className}`}>
      <BrandTile size={size} />
      <div className="min-w-0">
        {eyebrow ? (
          <p className={`text-[13px] font-medium ${onDark ? 'text-white/70' : 'text-muted'}`}>{eyebrow}</p>
        ) : null}
        <p className={`truncate font-semibold leading-tight tracking-[-0.01em] ${titleClass} ${onDark ? 'text-white' : 'text-ink'}`}>
          {title ?? 'Asian Grocer'}
        </p>
      </div>
    </div>
  )
}
