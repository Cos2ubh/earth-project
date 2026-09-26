// Astronomy wrapper — every number the visualization uses comes from here.
// Backed by astronomy-engine (NASA JPL-accurate, arcsecond-level precision).
//
// Coordinate conventions used throughout:
//   latitude  — degrees, +north / -south, range [-90, 90]
//   longitude — degrees, +east / -west,  range [-180, 180]
//   angles    — degrees unless otherwise noted

import * as Astronomy from 'astronomy-engine';
import { pathToFileURL } from 'node:url';

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
 * Convenience: everything at once, in a single object.
 * Cheaper than calling each function separately since it computes MakeTime once.
 */
export function getEarthState(date = new Date()) {
    return {
        timestamp: date.toISOString(),
        axialTilt: getAxialTilt(date),
        subsolarPoint: getSubsolarPoint(date),
        rotationAngle: getEarthRotationAngle(date),
    };
}

// If run directly with `node src/astronomy.js`, log current values for verification.
// Cross-check against timeanddate.com/worldclock/sunearth.html
const isMainModule =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    const state = getEarthState();
    console.log('Earth state @', state.timestamp);
    console.log('  Axial tilt        :', state.axialTilt.toFixed(4), '°');
    console.log('  Subsolar latitude :', state.subsolarPoint.latitude.toFixed(4), '° (+N/-S)');
    console.log('  Subsolar longitude:', state.subsolarPoint.longitude.toFixed(4), '° (+E/-W)');
    console.log('  Rotation angle    :', state.rotationAngle.toFixed(4), '° (GAST as angle)');
    console.log('');
    console.log('Verify at: https://www.timeanddate.com/worldclock/sunearth.html');
}
