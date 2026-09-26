// Astronomy wrapper — every number the visualization uses comes from here.
// Backed by astronomy-engine (NASA JPL-accurate, arcsecond-level precision).
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
    };
}
