import Image from 'next/image'

type LogoSize = 'sm' | 'md' | 'lg'

const tileSize = { sm: 32, md: 48, lg: 72 }

export function BrandTile({ size = 'md', className = '' }: { size?: LogoSize; className?: string }) {
  return (
    <Image
      src="/icon-192.png"
      alt=""
      width={tileSize[size]}
      height={tileSize[size]}
      unoptimized
      className={`shrink-0 ${className}`}
    />
  )
}

export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <Image
      src="/asian-grocer-logo.svg"
      alt="Asian Grocer"
      width={800}
      height={200}
      unoptimized
      className={`h-auto max-w-full rounded-md ${className}`}
    />
  )
}
