// CLI harness — logs the current Earth state to the terminal so we can
// cross-check the numbers against a reference (timeanddate.com etc).
// Run with: node scripts/verify-astronomy.js

import { getEarthState } from '../src/astronomy.js';

const state = getEarthState();
console.log('Earth state @', state.timestamp);
console.log('  Axial tilt        :', state.axialTilt.toFixed(4), '°');
console.log('  Subsolar latitude :', state.subsolarPoint.latitude.toFixed(4), '° (+N/-S)');
console.log('  Subsolar longitude:', state.subsolarPoint.longitude.toFixed(4), '° (+E/-W)');
console.log('  Rotation angle    :', state.rotationAngle.toFixed(4), '° (GAST as angle)');
console.log('');
console.log('Verify at: https://www.timeanddate.com/worldclock/sunearth.html');
