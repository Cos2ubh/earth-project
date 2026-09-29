// CLI harness: logs the current Earth state to the terminal so we can
// cross-check the numbers against a reference (timeanddate.com etc).
// Run with: node scripts/verify-astronomy.js

import { getEarthState } from '../src/astronomy.js';

const state = getEarthState();
console.log('Earth state @', state.timestamp);
console.log('  Axial tilt        :', state.axialTilt.toFixed(4), '°');
console.log('  Subsolar latitude :', state.subsolarPoint.latitude.toFixed(4), '° (+N/-S)');
console.log('  Subsolar longitude:', state.subsolarPoint.longitude.toFixed(4), '° (+E/-W)');
console.log('  Rotation angle    :', state.rotationAngle.toFixed(4), '° (GAST as angle)');
console.log('  Sun ecl. longitude:', state.sunEclipticLongitude.toFixed(4), '° (0=vernal eq, 90=summer, 180=autumnal, 270=winter)');
console.log('  Sun direction     :',
    'x=' + state.sunDirection.x.toFixed(4),
    'y=' + state.sunDirection.y.toFixed(4),
    'z=' + state.sunDirection.z.toFixed(4));
console.log('  Moon direction    :',
    'x=' + state.moon.direction.x.toFixed(4),
    'y=' + state.moon.direction.y.toFixed(4),
    'z=' + state.moon.direction.z.toFixed(4));
console.log('  Moon distance     :', Math.round(state.moon.distanceKm).toLocaleString(), 'km');
console.log('  Moon phase        :', (state.moon.phaseFraction * 100).toFixed(1) + '% illuminated');
console.log('');
console.log('Verify at: https://www.timeanddate.com/worldclock/sunearth.html');
console.log('           https://www.timeanddate.com/moon/phases/');
