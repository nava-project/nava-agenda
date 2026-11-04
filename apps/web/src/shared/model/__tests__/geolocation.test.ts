import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GOOD_ACCURACY_METERS,
  isGeolocationSupported,
  locateUser,
  zoomForAccuracy,
} from '../geolocation'

type Geo = Pick<Geolocation, 'getCurrentPosition'>

function geoOk(latitude: number, longitude: number, accuracy: number): Geo {
  return {
    getCurrentPosition: vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude, longitude, accuracy } } as GeolocationPosition),
    ),
  }
}

function geoFails(code: number): Geo {
  return {
    getCurrentPosition: vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
      fail?.({ code } as GeolocationPositionError),
    ),
  }
}

describe('isGeolocationSupported', () => {
  it('needs a getCurrentPosition function', () => {
    expect(isGeolocationSupported(geoOk(1, 1, 1))).toBe(true)
    expect(isGeolocationSupported({} as Geo)).toBe(false)
  })
})

describe('locateUser', () => {
  it('returns the rounded point and the accuracy', async () => {
    const geo = geoOk(4.6124421999, -74.0694181111, 18.4)
    const result = await locateUser(geo)

    expect(result).toEqual({
      kind: 'success',
      point: { latitude: 4.612442, longitude: -74.069418 },
      accuracyMeters: 18,
    })
  })

  it('asks for a fresh high-accuracy fix with a timeout (CA-138-05)', async () => {
    const geo = geoOk(4.6, -74, 5)
    await locateUser(geo, 7000)

    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 0,
      },
    )
  })

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [99, 'unavailable'],
  ])('maps error code %i to %s', async (code, kind) => {
    expect(await locateUser(geoFails(code))).toEqual({ kind })
  })

  it('is unsupported without the API, without throwing', async () => {
    expect(await locateUser({} as Geo)).toEqual({ kind: 'unsupported' })
  })

  it('treats an impossible position as unavailable', async () => {
    expect(await locateUser(geoOk(120, -74, 5))).toEqual({ kind: 'unavailable' })
  })

  it('reports an unknown accuracy as null', async () => {
    const result = await locateUser(geoOk(4.6, -74, Number.NaN))
    expect(result).toMatchObject({ kind: 'success', accuracyMeters: null })
  })
})

// Un dispositivo que entrega lecturas con el tiempo (la primera, por red, es gruesa).
function watchingGeo() {
  let onOk: PositionCallback = () => {}
  let onFail: PositionErrorCallback = () => {}
  const clearWatch = vi.fn()
  const geo = {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      onOk = ok
      onFail = fail ?? (() => {})
      return 7
    }),
    clearWatch,
  }
  return {
    geo,
    reading: (latitude: number, longitude: number, accuracy: number) =>
      onOk({ coords: { latitude, longitude, accuracy } } as GeolocationPosition),
    fail: (code: number) => onFail({ code } as GeolocationPositionError),
  }
}

describe('locateUser afinando la posición (DEC-155)', () => {
  afterEach(() => vi.useRealTimers())

  it('espera una lectura buena y descarta la gruesa del principio', async () => {
    vi.useFakeTimers()
    const device = watchingGeo()
    const promise = locateUser(device.geo)

    device.reading(4.711, -74.0721, 3200) // por red: cae «al centro»
    device.reading(4.5701, -74.1102, 12) // GPS: la casa de verdad

    await expect(promise).resolves.toEqual({
      kind: 'success',
      point: { latitude: 4.5701, longitude: -74.1102 },
      accuracyMeters: 12,
    })
    expect(device.geo.clearWatch).toHaveBeenCalledWith(7)
    expect(12).toBeLessThanOrEqual(GOOD_ACCURACY_METERS)
  })

  it('al agotar el tiempo de afinar entrega la mejor lectura que haya', async () => {
    vi.useFakeTimers()
    const device = watchingGeo()
    const promise = locateUser(device.geo, 12_000, 8_000)

    device.reading(4.7, -74.0, 900)
    device.reading(4.6, -74.1, 140)
    device.reading(4.65, -74.05, 400) // peor: no reemplaza a la mejor
    await vi.advanceTimersByTimeAsync(8_000)

    await expect(promise).resolves.toMatchObject({
      kind: 'success',
      point: { latitude: 4.6, longitude: -74.1 },
      accuracyMeters: 140,
    })
    expect(device.geo.clearWatch).toHaveBeenCalledWith(7)
  })

  it('sin ninguna lectura devuelve el último error al cumplirse el tiempo', async () => {
    vi.useFakeTimers()
    const device = watchingGeo()
    const promise = locateUser(device.geo, 12_000, 8_000)

    device.fail(2)
    device.fail(3)
    await vi.advanceTimersByTimeAsync(12_000)

    await expect(promise).resolves.toEqual({ kind: 'timeout' })
  })

  it('un permiso negado termina de inmediato', async () => {
    vi.useFakeTimers()
    const device = watchingGeo()
    const promise = locateUser(device.geo)

    device.fail(1)

    await expect(promise).resolves.toEqual({ kind: 'denied' })
    expect(device.geo.clearWatch).toHaveBeenCalledWith(7)
  })

  it('ignora lecturas con coordenadas imposibles', async () => {
    vi.useFakeTimers()
    const device = watchingGeo()
    const promise = locateUser(device.geo, 12_000, 8_000)

    device.reading(999, 0, 5)
    await vi.advanceTimersByTimeAsync(12_000)

    await expect(promise).resolves.toEqual({ kind: 'unavailable' })
  })
})

describe('zoomForAccuracy', () => {
  it('acerca más cuanto más precisa es la posición', () => {
    expect(zoomForAccuracy(10)).toBe(17)
    expect(zoomForAccuracy(null)).toBe(17)
    expect(zoomForAccuracy(120)).toBe(16)
    expect(zoomForAccuracy(400)).toBe(15)
    expect(zoomForAccuracy(5000)).toBe(14)
  })
})
