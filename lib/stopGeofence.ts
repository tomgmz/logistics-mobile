import * as Location from 'expo-location'

/**
 * How close the driver has to be to confirm a stop.
 *
 * The server enforces this too and is the authority — this copy exists because
 * the server's answer arrives far too late to be useful. Confirmations queue
 * offline and may not reach the server for hours, by which time the driver is
 * somewhere else entirely; worse, the queue drops a refusal on the floor, so a
 * stop refused at drain time would simply vanish. The check has to happen here,
 * while the driver is standing at the stop and can do something about it.
 *
 * Keep `STOP_PROOF_RADIUS_M` in step with the backend's constant of the same
 * name — if this one is looser, drivers get through here and are refused later
 * by a queue that will not tell them.
 */
export const STOP_PROOF_RADIUS_M = 100

const EARTH_RADIUS_M = 6_371_008.8
const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export interface Coordinates {
  latitude:  number
  longitude: number
}

/** Great-circle distance in metres. Mirrors the backend's haversine exactly. */
export function distanceInMetres(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude))

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export interface StopFix {
  latitude:   number
  longitude:  number
  accuracy_m: number | null
}

/**
 * The driver's position right now, or null if it can't be read.
 *
 * Null is a real answer, not a failure to handle later: GPS dies inside most
 * warehouse docks, and the confirmation flow has to keep working there — it
 * asks the driver for a reason instead.
 */
export async function readCurrentFix(): Promise<StopFix | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') {
      const asked = await Location.requestForegroundPermissionsAsync()
      if (asked.status !== 'granted') return null
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    })

    return {
      latitude:   position.coords.latitude,
      longitude:  position.coords.longitude,
      accuracy_m: position.coords.accuracy ?? null,
    }
  } catch {
    return null
  }
}

export interface ProximityCheck {
  /** Whether the stop can be confirmed without the driver giving a reason. */
  withinRadius: boolean
  /** Null when there was no fix, or the stop has no coordinates to measure to. */
  distanceM:    number | null
  fix:          StopFix | null
  /** What to tell the driver when `withinRadius` is false. */
  message:      string | null
}

/**
 * Measure the driver against the stop they are confirming.
 *
 * A stop with no coordinates of its own cannot be measured and is allowed
 * through — the same call the backend makes. Refusing a delivery because the
 * office never geocoded the address punishes the wrong person.
 */
export async function checkStopProximity(
  stop: Coordinates | null | undefined,
  stopLabel: string,
): Promise<ProximityCheck> {
  const fix = await readCurrentFix()

  if (!fix) {
    return {
      withinRadius: false,
      distanceM:    null,
      fix:          null,
      message:      `Your location could not be read, so we can't confirm you're at the ${stopLabel}. Turn location on and try again, or confirm anyway with a reason.`,
    }
  }

  if (!stop || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) {
    return { withinRadius: true, distanceM: null, fix, message: null }
  }

  const distanceM = Math.round(distanceInMetres(stop, fix))
  if (distanceM <= STOP_PROOF_RADIUS_M) {
    return { withinRadius: true, distanceM, fix, message: null }
  }

  return {
    withinRadius: false,
    distanceM,
    fix,
    message: `You're about ${distanceM} m from the ${stopLabel}. Move within ${STOP_PROOF_RADIUS_M} m to confirm it, or confirm anyway with a reason.`,
  }
}

/**
 * A stop's coordinates off a navigation leg, or null when it has none.
 *
 * Both navigation screens keep their own Leg shape but agree on these two
 * optional fields, so the proof popup takes either without caring which SDK
 * drew the map.
 */
export function legCoordinates(
  leg: { latitude?: number | null; longitude?: number | null } | null | undefined,
): Coordinates | null {
  const lat = leg?.latitude
  const lon = leg?.longitude
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { latitude: lat, longitude: lon }
}
