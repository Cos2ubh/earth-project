// Earth Project — entry point.
//
// Coordinate convention (locked in Phase 3):
//   world +Y = ecliptic north (perpendicular to Earth's orbital plane)
//   world +X, +Z lie in the ecliptic plane
//   Earth's rotation axis is tilted from +Y by the current obliquity,
//   leaning toward +X. This is a fixed direction in world space —
//   what changes over the year is the Sun's position around Earth.
//
// Scene graph:
//   scene
//     └─ earthGroup     ← holds the axial tilt (rotation.z)
//          ├─ earthSpin ← rotates on local +Y at sidereal rate
//          │    ├─ earth mesh
//          │    ├─ wireframe overlay
//          │    └─ prime-meridian marker (temporary, until textures land)
//          └─ axisLine  ← doesn't spin; sits fixed in the tilted frame

import * as THREE from 'three';
import { getEarthState } from './astronomy.js';

const canvas = document.getElementById('canvas');
const hudTilt = document.getElementById('hud-tilt');
const hudRotation = document.getElementById('hud-rotation');
const hudTime = document.getElementById('hud-time');

// --- Scene, camera, renderer -------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
);
camera.position.set(0, 0.6, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// --- Earth hierarchy ---------------------------------------------------------

const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earthSpin = new THREE.Group();
earthGroup.add(earthSpin);

const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
const earthMaterial = new THREE.MeshBasicMaterial({ color: 0x4a6a8a });
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
earthSpin.add(earth);

const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0x2a4a6a,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
});
const earthWireframe = new THREE.Mesh(earthGeometry, wireframeMaterial);
earthSpin.add(earthWireframe);

// Temporary reference marker at "prime meridian, equator" so the rotation is
// visible before textures land in Phase 7. Convention: prime meridian sits at
// local +Z in the earthSpin frame. When textures arrive we align UVs to match.
const markerGeometry = new THREE.SphereGeometry(0.04, 16, 16);
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff8c42 });
const primeMeridianMarker = new THREE.Mesh(markerGeometry, markerMaterial);
primeMeridianMarker.position.set(0, 0, 1.001); // just above the surface
earthSpin.add(primeMeridianMarker);

// Rotation axis — child of earthGroup, NOT earthSpin. The axis is what
// Earth spins around; it doesn't rotate itself.
const axisPoints = [
    new THREE.Vector3(0, -1.35, 0),
    new THREE.Vector3(0, 1.35, 0),
];
const axisGeometry = new THREE.BufferGeometry().setFromPoints(axisPoints);
const axisMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
});
const axisLine = new THREE.Line(axisGeometry, axisMaterial);
earthGroup.add(axisLine);

// --- Apply the axial tilt ----------------------------------------------------
// Recomputed once per second — obliquity changes on geologic timescales.

function applyAxialTilt(tiltDegrees) {
    const tiltRad = THREE.MathUtils.degToRad(tiltDegrees);
    earthGroup.rotation.z = tiltRad;
}

// --- Apply the Earth spin ----------------------------------------------------
// Recomputed every frame so the rotation reads smoothly. astronomy-engine
// returns GAST as an angle in [0, 360) — the amount Earth has rotated relative
// to the vernal equinox at Greenwich. We spin around the local +Y axis
// (Earth's north pole in the tilted frame). Positive rotation makes Earth turn
// eastward (west-to-east) — the correct real-world direction.

function applyEarthSpin(rotationDegrees) {
    earthSpin.rotation.y = THREE.MathUtils.degToRad(rotationDegrees);
}

// --- HUD update --------------------------------------------------------------

function formatUTC(date) {
    // "2026-09-26 14:32:17 UTC"
    const iso = date.toISOString();
    return iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
}

function updateSlow() {
    const state = getEarthState();
    applyAxialTilt(state.axialTilt);
    hudTilt.textContent = state.axialTilt.toFixed(4) + '°';
}

updateSlow();
setInterval(updateSlow, 1000);

// --- Resize handling ---------------------------------------------------------

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop -------------------------------------------------------------

function animate() {
    requestAnimationFrame(animate);

    // Per-frame updates: rotation angle + time display.
    const now = new Date();
    const state = getEarthState(now);
    applyEarthSpin(state.rotationAngle);

    // HUD numbers that need to look "live" every frame.
    hudRotation.textContent = state.rotationAngle.toFixed(3) + '°';
    hudTime.textContent = formatUTC(now);

    renderer.render(scene, camera);
}

animate();

console.log('Earth Project — Phase 4 scene initialized');
