type CatalogVisibilityLike = {
  is_visible?: boolean | null
}

export function isCatalogItemVisible<T extends CatalogVisibilityLike>(item: T) {
  return item.is_visible !== false
}

export function filterVisibleCatalogItems<T extends CatalogVisibilityLike>(items: T[] | null | undefined) {
  return (items ?? []).filter(isCatalogItemVisible)
}
