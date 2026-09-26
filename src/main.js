// Earth Project — entry point.
//
// Coordinate convention (locked in Phase 3):
//   world +Y = ecliptic north (perpendicular to Earth's orbital plane)
//   world +X, +Z lie in the ecliptic plane
//   Earth's rotation axis is tilted from +Y by the current obliquity,
//   leaning toward +X. This is a fixed direction in world space —
//   what changes over the year is the Sun's position around Earth.

import * as THREE from 'three';
import { getEarthState } from './astronomy.js';

const canvas = document.getElementById('canvas');
const hudTilt = document.getElementById('hud-tilt');

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

// --- Earth group -------------------------------------------------------------
// Everything Earth-related lives inside earthGroup. Applying the axial tilt
// to the group rotates the mesh, axis line, and eventually the lat/long grid
// as one unit. Earth's diurnal spin (Phase 4) will be applied to a nested
// child of this group so the tilt stays fixed in world space.

const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
const earthMaterial = new THREE.MeshBasicMaterial({ color: 0x4a6a8a });
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
earthGroup.add(earth);

const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0x2a4a6a,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
});
const earthWireframe = new THREE.Mesh(earthGeometry, wireframeMaterial);
earthGroup.add(earthWireframe);

// Rotation axis — thin white line through the poles, extended past the surface
// so it's visible above and below Earth. Sits in the group's local frame so it
// tilts with Earth automatically.
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
// Rotation around world +Z tips the local +Y axis (Earth's pole) toward +X.
// The exact angle comes from astronomy.js — updated once per second below,
// since obliquity changes so slowly it doesn't need to be recomputed per frame.

function applyAxialTilt(tiltDegrees) {
    const tiltRad = THREE.MathUtils.degToRad(tiltDegrees);
    earthGroup.rotation.z = tiltRad;
}

// --- HUD update --------------------------------------------------------------

function updateHud() {
    const state = getEarthState();
    applyAxialTilt(state.axialTilt);
    hudTilt.textContent = state.axialTilt.toFixed(4) + '°';
}

updateHud();
setInterval(updateHud, 1000);

// --- Resize handling ---------------------------------------------------------

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop -------------------------------------------------------------

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

animate();

console.log('Earth Project — Phase 3 scene initialized');
