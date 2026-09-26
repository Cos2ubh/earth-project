// Earth Project — entry point.
//
// Coordinate convention (locked in Phase 3):
//   world +Y = ecliptic north (perpendicular to Earth's orbital plane)
//   world +X = vernal equinox direction
//   Ecliptic longitude increases counterclockwise around +Y (viewed from above)
//   Earth's rotation axis tilts from +Y toward +X by the current obliquity
//
// Scene graph:
//   scene
//     ├─ earthGroup       ← holds axial tilt (rotation.z)
//     │    ├─ earthSpin   ← rotates on local +Y at sidereal rate
//     │    │    ├─ earth mesh (Standard material, receives light)
//     │    │    └─ prime-meridian marker (temporary, until textures land)
//     │    └─ axisLine    ← fixed in tilted frame, doesn't spin
//     ├─ sunLight         ← DirectionalLight at Sun's direction
//     ├─ ambientLight     ← tiny fill so night side isn't pure black
//     └─ sunMarker        ← visible sphere at sunDirection × distance

import * as THREE from 'three';
import { getEarthState } from './astronomy.js';
import { buildLatLonGrid } from './grid.js';
import { buildEarthMaterial } from './earthMaterial.js';

const canvas = document.getElementById('canvas');
const hudTilt = document.getElementById('hud-tilt');
const hudRotation = document.getElementById('hud-rotation');
const hudTime = document.getElementById('hud-time');
const hudSunLon = document.getElementById('hud-sun-lon');

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

const earthGeometry = new THREE.SphereGeometry(1, 96, 96);
// Placeholder material — swapped for the shader material once textures load.
// Keeps the sphere visible during the async texture fetch (typically < 200ms).
const placeholderMaterial = new THREE.MeshBasicMaterial({ color: 0x1a2a3a });
const earth = new THREE.Mesh(earthGeometry, placeholderMaterial);
earthSpin.add(earth);

// Asynchronously load the shader material and swap it in.
let setEarthSunDirection = null;
buildEarthMaterial(earth).then(({ material, setSunDirection }) => {
    earth.material.dispose();
    earth.material = material;
    setEarthSunDirection = setSunDirection;
    console.log('Earth textures loaded — shader material active.');
}).catch((err) => {
    console.error('Failed to load Earth textures:', err);
});

// Lat/lon grid — meridians every 30°, parallels every 30°, equator and
// prime meridian highlighted. Sits as a child of earthSpin so it rotates
// with Earth. Replaces the Phase 4 prime-meridian marker (now redundant
// since the prime meridian is drawn as a full amber line).
const latLonGrid = buildLatLonGrid();
earthSpin.add(latLonGrid);

// Rotation axis — sits in the tilted frame, doesn't spin.
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

// --- Lighting ----------------------------------------------------------------

// Directional light from the Sun. Position gets updated every frame.
// Intensity 3.0 keeps the day side well-lit against our near-black background.
const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
sunLight.position.set(1, 0, 0); // placeholder — overwritten each frame
scene.add(sunLight);

// A whisper of ambient so the night side isn't dead black — helps the sphere
// read as a globe even at extreme phase angles. Keep this very low; the whole
// point of the visualization is that the terminator is visible.
const ambientLight = new THREE.AmbientLight(0xffffff, 0.04);
scene.add(ambientLight);

// --- Sun marker --------------------------------------------------------------
// A visible yellow sphere placed in the Sun's direction, at a distance chosen
// for visual clarity — NOT to scale (per the disclaimer). Phase 9 will add
// bloom for a proper glow.

const sunMarkerDistance = 8;
const sunMarkerGeometry = new THREE.SphereGeometry(0.35, 32, 32);
const sunMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffdd66 });
const sunMarker = new THREE.Mesh(sunMarkerGeometry, sunMarkerMaterial);
scene.add(sunMarker);

// --- Apply orientations ------------------------------------------------------

function applyAxialTilt(tiltDegrees) {
    earthGroup.rotation.z = THREE.MathUtils.degToRad(tiltDegrees);
}

function applyEarthSpin(rotationDegrees) {
    earthSpin.rotation.y = THREE.MathUtils.degToRad(rotationDegrees);
}

function applySunDirection(sunDir) {
    // Directional light: position sets the direction light comes FROM
    // (light shines toward its target, default (0,0,0)).
    sunLight.position.set(
        sunDir.x * 10,
        sunDir.y * 10,
        sunDir.z * 10,
    );

    // Sun marker sits along the same direction, at a visible distance.
    sunMarker.position.set(
        sunDir.x * sunMarkerDistance,
        sunDir.y * sunMarkerDistance,
        sunDir.z * sunMarkerDistance,
    );
}

// --- HUD update --------------------------------------------------------------

function formatUTC(date) {
    const iso = date.toISOString();
    return iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
}

// Slow updates: values that change over minutes / hours / days.
function updateSlow() {
    const state = getEarthState();
    applyAxialTilt(state.axialTilt);
    applySunDirection(state.sunDirection);
    hudTilt.textContent = state.axialTilt.toFixed(4) + '°';
    hudSunLon.textContent = state.sunEclipticLongitude.toFixed(3) + '°';
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

    const now = new Date();
    const state = getEarthState(now);
    applyEarthSpin(state.rotationAngle);

    // Feed world-space Sun direction into the Earth shader — the material
    // handles the world→local transform internally.
    if (setEarthSunDirection) {
        setEarthSunDirection(state.sunDirection);
    }

    hudRotation.textContent = state.rotationAngle.toFixed(3) + '°';
    hudTime.textContent = formatUTC(now);

    renderer.render(scene, camera);
}

animate();

console.log('Earth Project — Phase 5 scene initialized');
