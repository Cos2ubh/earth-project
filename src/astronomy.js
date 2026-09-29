// Astronomy wrapper — every number the visualization uses comes from here.
// Backed by astronomy-engine, which documents about one arcminute of accuracy
// against JPL Horizons and NOVAS.
//
// This module is browser-safe (no Node built-ins). For CLI verification, see
// scripts/verify-astronomy.js.
//
// Coordinate conventions used throughout:
//   latitude  — degrees, +north / -south, range [-90, 90]
//   longitude — degrees, +east / -west,  range [-180, 180]
//   angles    — degrees unless otherwise noted

import * as Astronomy from 'astronomy-engine';

/**
 * Earth's axial tilt (true obliquity of the ecliptic) at the given instant.
 * Slowly decreasing — ~23.44° today, was 23.4393° at J2000.
 */
export function getAxialTilt(date = new Date()) {
    const tilt = Astronomy.e_tilt(Astronomy.MakeTime(date));
    return tilt.tobl; // true obliquity in degrees
}

/**
 * Subsolar point: the lat/lon on Earth's surface where the Sun is directly overhead.
 * Latitude  = Sun's declination.
 * Longitude = -Greenwich Hour Angle of the Sun.
 */
export function getSubsolarPoint(date = new Date()) {
    const time = Astronomy.MakeTime(date);

    // Sun's geocentric equatorial coordinates (aberration corrected).
    // For subsolar point, geocentric is correct — the Sun is 149.6M km away,
    // so the parallax between geocentric and any surface point is negligible.
    const geoVec = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
    const equ = Astronomy.EquatorFromVector(geoVec);
    // equ.ra  — right ascension in hours [0, 24)
    // equ.dec — declination in degrees   [-90, 90]

    // Greenwich Apparent Sidereal Time, in hours
    const gast = Astronomy.SiderealTime(time);

    // Greenwich Hour Angle of the Sun, in hours
    let ghaHours = gast - equ.ra;
    // Normalize to [0, 24)
    ghaHours = ((ghaHours % 24) + 24) % 24;

    // Convert to degrees and flip sign convention:
    //   GHA is measured westward from Greenwich (0..360 west-positive).
    //   Subsolar longitude uses east-positive [-180, 180].
    let longitude = -ghaHours * 15;
    if (longitude < -180) longitude += 360;
    if (longitude > 180) longitude -= 360;

    return {
        latitude: equ.dec,
        longitude: longitude,
    };
}

/**
 * Earth's rotation angle at Greenwich, in degrees [0, 360).
 * This is the Greenwich Apparent Sidereal Time expressed as an angle —
 * i.e. how far Earth has rotated relative to the vernal equinox.
 *
 * Used to spin the Earth mesh in the 3D scene so its orientation
 * matches reality at the current moment.
 */
export function getEarthRotationAngle(date = new Date()) {
    const gastHours = Astronomy.SiderealTime(Astronomy.MakeTime(date));
    return (gastHours * 15) % 360;
}

/**
 * Sun's apparent ecliptic longitude at the given instant, in degrees [0, 360).
 * Reference points:
 *   0°   — vernal equinox   (~March 20)
 *   90°  — summer solstice  (~June 21)
 *   180° — autumnal equinox (~Sept 23)
 *   270° — winter solstice  (~Dec 21)
 * The Sun's ecliptic latitude is essentially zero (< 0.001°), ignored here.
 */
export function getSunEclipticLongitude(date = new Date()) {
    const sun = Astronomy.SunPosition(date);
    return sun.elon;
}

/**
 * Unit vector from Earth toward the Sun, in the scene's ecliptic frame.
 *
 * Scene convention (locked in Phase 3):
 *   +Y = ecliptic north (perpendicular to Earth's orbital plane)
 *   +X = vernal equinox direction
 *   Ecliptic longitude λ measured counterclockwise around +Y from +X
 *
 * Returned as { x, y, z } with x² + y² + z² = 1.
 */
export function getSunDirection(date = new Date()) {
    const lambda = getSunEclipticLongitude(date) * (Math.PI / 180);
    return {
        x: Math.cos(lambda),
        y: 0,
        z: Math.sin(lambda),
    };
}

/**
 * Unit vector from Earth toward the Sun in the true EQUATORIAL frame of date
 * (+Z = celestial pole) — the frame satellite orbits (TLE/SGP4, "TEME") live
 * in. Deliberately NOT the scene's frame: physical questions about a real
 * satellite (is it in Earth's shadow?) should be answered with real geometry
 * rather than by trusting how the scene happens to orient the globe.
 *
 * Difference between this frame (true equator + true equinox of date) and
 * TEME (true equator + mean equinox) is the nutation in longitude, ~0.005°.
 */
export function getSunEquatorialDirection(date = new Date()) {
    const time = Astronomy.MakeTime(date);
    const eqj = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
    const eqd = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(time), eqj);
    const length = Math.hypot(eqd.x, eqd.y, eqd.z);
    return { x: eqd.x / length, y: eqd.y / length, z: eqd.z / length };
}

// --- Sun and Moon detail readouts (for the HUD) --------------------------------
//
// Everything below is computed from astronomy-engine's real ephemerides and is
// independent of the 3D scene frame (see the note on getSunEquatorialDirection).

const AU_KM = 149597870.7;
const SPEED_OF_LIGHT_KM_S = 299792.458;
const SUN_RADIUS_KM = 695700;
const MOON_RADIUS_KM = 1737.4;
const RAD_TO_DEG = 180 / Math.PI;
const DAY_MS = 86400000;

// Angular diameter of a sphere of the given radius seen from `distanceKm`.
function angularDiameterDeg(radiusKm, distanceKm) {
    return 2 * Math.asin(radiusKm / distanceKm) * RAD_TO_DEG;
}

// Equinox/solstice instants per year, computed once.
const seasonCache = new Map();
function seasonEvents(year) {
    if (!seasonCache.has(year)) {
        const s = Astronomy.Seasons(year);
        seasonCache.set(year, [
            { name: 'Mar equinox', date: s.mar_equinox.date },
            { name: 'Jun solstice', date: s.jun_solstice.date },
            { name: 'Sep equinox', date: s.sep_equinox.date },
            { name: 'Dec solstice', date: s.dec_solstice.date },
        ]);
    }
    return seasonCache.get(year);
}

/** The next equinox or solstice after `date`: { name, date, daysAway }. */
export function getNextSeasonStart(date = new Date()) {
    const year = date.getUTCFullYear();
    const upcoming = [...seasonEvents(year), ...seasonEvents(year + 1)].find((e) => e.date > date);
    return { name: upcoming.name, date: upcoming.date, daysAway: (upcoming.date - date) / DAY_MS };
}

/**
 * Sun readouts: right ascension / declination (true equator and equinox of
 * date), distance, light travel time, apparent size, and the next season
 * boundary.
 */
export function getSunDetails(date = new Date()) {
    const time = Astronomy.MakeTime(date);
    const eqj = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
    const eqd = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(time), eqj);
    const equ = Astronomy.EquatorFromVector(eqd); // ra in hours, dec in degrees, dist in AU
    const distanceKm = equ.dist * AU_KM;
    return {
        raHours: equ.ra,
        decDeg: equ.dec,
        distanceAu: equ.dist,
        distanceKm,
        lightTimeSec: distanceKm / SPEED_OF_LIGHT_KM_S,
        angularDiameterDeg: angularDiameterDeg(SUN_RADIUS_KM, distanceKm),
        nextSeason: getNextSeasonStart(date),
    };
}

/**
 * Name for a lunar phase angle (0 = new, 90 = first quarter, 180 = full,
 * 270 = last quarter). The four principal phases get about a day of slack
 * (±6°, since the Moon gains ~12° of phase per day).
 */
export function moonPhaseName(phaseAngleDeg) {
    const a = ((phaseAngleDeg % 360) + 360) % 360;
    if (a < 6 || a >= 354) return 'New moon';
    if (a < 84) return 'Waxing crescent';
    if (a < 96) return 'First quarter';
    if (a < 174) return 'Waxing gibbous';
    if (a < 186) return 'Full moon';
    if (a < 264) return 'Waning gibbous';
    if (a < 276) return 'Last quarter';
    return 'Waning crescent';
}

/**
 * Moon readouts: phase name, illuminated fraction, age since the last new
 * moon, distance, apparent size, next full/new moon, and a supermoon flag
 * (a full moon at or inside ~360,000 km — the popular definition).
 */
export function getMoonDetails(date = new Date()) {
    const time = Astronomy.MakeTime(date);
    const phaseAngle = Astronomy.MoonPhase(time);
    const geo = Astronomy.GeoVector(Astronomy.Body.Moon, time, true);
    const distanceKm = Math.hypot(geo.x, geo.y, geo.z) * AU_KM;

    const previousNew = Astronomy.SearchMoonPhase(0, time, -32);
    const nextNew = Astronomy.SearchMoonPhase(0, time, 32);
    const nextFull = Astronomy.SearchMoonPhase(180, time, 32);
    const event = (t) => (t ? { date: t.date, daysAway: (t.date - date) / DAY_MS } : null);

    const nearFull = Math.abs(phaseAngle - 180) <= 18; // within ~1.5 days
    return {
        phaseAngle,
        phaseName: moonPhaseName(phaseAngle),
        illuminatedFraction: (1 - Math.cos(phaseAngle / RAD_TO_DEG)) / 2,
        ageDays: previousNew ? (date - previousNew.date) / DAY_MS : null,
        distanceKm,
        angularDiameterDeg: angularDiameterDeg(MOON_RADIUS_KM, distanceKm),
        nextFull: event(nextFull),
        nextNew: event(nextNew),
        supermoon: nearFull && distanceKm <= 360000,
    };
}

/**
 * Moon's position relative to Earth, in the scene's ecliptic frame.
 * Returns:
 *   direction — unit vector { x, y, z } from Earth toward Moon
 *   distanceKm — actual Earth-Moon distance in kilometers
 *   phaseFraction — 0.0 (new moon) to 1.0 (full moon), fraction of disk illuminated
 *
 * Uses astronomy-engine's full lunar theory (arcminute accurate), so the
 * 5.14° orbital inclination and lunar parallax are handled correctly —
 * the Moon does NOT sit in the ecliptic plane.
 *
 * Frame conversion:
 *   astronomy-engine returns positions in J2000 equatorial coords
 *     (+X = vernal equinox, +Z = celestial pole)
 *   We swap y↔z to match the scene's convention
 *     (+X = vernal equinox, +Y = ecliptic north, +Z = 90°E on ecliptic)
 */
export function getMoonState(date = new Date()) {
    const time = Astronomy.MakeTime(date);

    const equVec = Astronomy.GeoVector(Astronomy.Body.Moon, time, true);
    const ecl = Astronomy.Ecliptic(equVec); // { vec, elat, elon }

    // Magnitude of the ecliptic vector = Earth-Moon distance in AU.
    const distanceAu = Math.sqrt(
        ecl.vec.x * ecl.vec.x +
        ecl.vec.y * ecl.vec.y +
        ecl.vec.z * ecl.vec.z,
    );
    const AU_KM = 149597870.7;
    const distanceKm = distanceAu * AU_KM;

    // Unit vector in scene frame (swap y↔z, normalize).
    const direction = {
        x: ecl.vec.x / distanceAu,
        y: ecl.vec.z / distanceAu, // AE ecliptic +Z (north) → our +Y
        z: ecl.vec.y / distanceAu, // AE ecliptic +Y (90°E) → our +Z
    };

    // Illuminated fraction of Moon's disk as seen from Earth.
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, time);

    return {
        direction,
        distanceKm,
        phaseFraction: illum.phase_fraction,
    };
}

/**
 * Find the next solar and lunar eclipse after the given date.
 *
 * Returns:
 *   solar: { peakDate: Date, kind: 'total'|'annular'|'partial', daysAway }
 *   lunar: { peakDate: Date, kind: 'total'|'partial'|'penumbral', daysAway }
 *
 * Uses astronomy-engine's built-in eclipse search. The dates and kinds come
 * straight from the library and are only as accurate as it is.
 */
export function getNextEclipses(date = new Date()) {
    const solar = Astronomy.SearchGlobalSolarEclipse(date);
    const lunar = Astronomy.SearchLunarEclipse(date);

    return {
        solar: solar ? {
            peakDate: solar.peak.date,
            kind: solar.kind, // 'partial' | 'annular' | 'total' | 'hybrid'
            daysAway: (solar.peak.date - date) / (86400 * 1000),
        } : null,
        lunar: lunar ? {
            peakDate: lunar.peak.date,
            kind: lunar.kind, // 'penumbral' | 'partial' | 'total'
            daysAway: (lunar.peak.date - date) / (86400 * 1000),
        } : null,
    };
}

/**
 * Convenience: everything at once, in a single object.
 * Cheaper than calling each function separately since it computes MakeTime once.
 */
export function getEarthState(date = new Date()) {
    return {
        timestamp: date.toISOString(),
        axialTilt: getAxialTilt(date),
        subsolarPoint: getSubsolarPoint(date),
        rotationAngle: getEarthRotationAngle(date),
        sunEclipticLongitude: getSunEclipticLongitude(date),
        sunDirection: getSunDirection(date),
        moon: getMoonState(date),
    };
}
