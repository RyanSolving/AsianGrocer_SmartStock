export function sectionFromQuery(section: unknown) {
  switch (section) {
    case 'data-entry':
    case 'stock-check':
    case 'daily-report':
    case 'dashboard':
    case 'catalog':
      return section
    default:
      return 'home'
  }
}
