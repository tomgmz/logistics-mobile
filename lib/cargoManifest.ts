/**
 * What comes off at which stop.
 *
 * A booking's cargo lines now carry the drop-off they are bound for
 * (`booking_cargo_items.destination_id`). Before that they did not, and the
 * driver app worked around it: the assignment screen could name a drop-off for a
 * cargo block only when the booking had exactly one drop-off to name, and on a
 * two- or three-stop run it showed an undifferentiated list of everything on the
 * truck. That is precisely the information a driver needs at the second stop,
 * and precisely where they had none of it.
 *
 * Lines with no destination — every booking taken before the column existed —
 * are not guessed at. They are returned separately as "for the whole trip", so
 * an old booking reads honestly instead of appearing to belong to stop 1.
 */

export interface ManifestCargoItem {
  item_id:         string
  destination_id?: string | null
  product_text?:   string | null
  commodity_text?: string | null
  products?:       { name: string; unit?: string | null } | null
  commodities?:    { name: string; category?: string | null } | null
  quantity?:       number | null
  weight_kg?:      number | null
  volume_cbm?:     number | null
}

/** Prefer the catalogue name, fall back to what the client typed. */
export function itemName(item: ManifestCargoItem): string {
  return (
    item.products?.name ??
    item.product_text ??
    item.commodities?.name ??
    item.commodity_text ??
    'Cargo'
  )
}

/** "12 x Sardines" / "Sardines" when there is no count. */
export function itemLine(item: ManifestCargoItem): string {
  const name = itemName(item)
  return item.quantity != null && item.quantity > 0
    ? `${item.quantity} x ${name}`
    : name
}

export interface StopManifest {
  /** Cargo bound for this specific drop-off. */
  items:      ManifestCargoItem[]
  totalQty:   number
  totalWeight: number
}

export function emptyManifest(): StopManifest {
  return { items: [], totalQty: 0, totalWeight: 0 }
}

function summarise(items: ManifestCargoItem[]): StopManifest {
  return {
    items,
    totalQty:    items.reduce((n, c) => n + (c.quantity  ?? 0), 0),
    totalWeight: items.reduce((n, c) => n + (c.weight_kg ?? 0), 0),
  }
}

/**
 * Group a booking's cargo by drop-off.
 *
 * `byDestination` is keyed on `destination_id`; `unassigned` holds lines that
 * name no drop-off and therefore belong to the trip as a whole.
 */
export function groupCargoByDestination(items: ManifestCargoItem[] | null | undefined): {
  byDestination: Map<string, StopManifest>
  unassigned:    StopManifest
} {
  const buckets = new Map<string, ManifestCargoItem[]>()
  const loose:   ManifestCargoItem[] = []

  for (const item of items ?? []) {
    if (item.destination_id) {
      const bucket = buckets.get(item.destination_id)
      if (bucket) bucket.push(item)
      else buckets.set(item.destination_id, [item])
    } else {
      loose.push(item)
    }
  }

  const byDestination = new Map<string, StopManifest>()
  for (const [destinationId, bucket] of buckets) {
    byDestination.set(destinationId, summarise(bucket))
  }

  return { byDestination, unassigned: summarise(loose) }
}

/** The manifest for one drop-off, or an empty one when nothing is bound to it. */
export function manifestFor(
  grouped: ReturnType<typeof groupCargoByDestination>,
  destinationId: string | null | undefined,
): StopManifest {
  if (!destinationId) return emptyManifest()
  return grouped.byDestination.get(destinationId) ?? emptyManifest()
}
