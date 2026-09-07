export const DMS_ACCORDIONS_KEY = 'stapp.dms.accordions'

export function loadDmsAccordions(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(DMS_ACCORDIONS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveDmsAccordion(serverKey: string, collapsed: boolean): void {
  try {
    const current = loadDmsAccordions()
    current[serverKey] = collapsed
    localStorage.setItem(DMS_ACCORDIONS_KEY, JSON.stringify(current))
  } catch {
    // Ignore storage errors
  }
}
