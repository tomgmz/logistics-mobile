import MapboxGL from '@rnmapbox/maps'

/**
 * Mapbox's base map style.
 *
 * Kept here rather than in theme/navigation.theme.ts on purpose: that theme is
 * shared with the Google path and the provider-neutral components, and an import
 * of @rnmapbox/maps at the top of it dragged the Mapbox native module into every
 * screen that wanted a colour. Google is the active provider; Mapbox stays
 * linked and switchable, but only the files under this folder should reach for
 * it.
 */
export const MAPBOX_STYLE = MapboxGL.StyleURL.Street
