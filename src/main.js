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
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { getEarthState } from './astronomy.js';
import { buildLatLonGrid } from './grid.js';
import { buildEarthMaterial } from './earthMaterial.js';
import { buildClouds } from './clouds.js';
import { buildStars } from './stars.js';
import { buildAtmosphere } from './atmosphere.js';
import { shouldAutoUpgrade, upgradeToHighRes } from './textureUpgrade.js';

const canvas = document.getElementById('canvas');
const hudTilt = document.getElementById('hud-tilt');
const hudRotation = document.getElementById('hud-rotation');
const hudTime = document.getElementById('hud-time');
const hudSunLon = document.getElementById('hud-sun-lon');
const hudSubLat = document.getElementById('hud-sub-lat');
const hudSubLon = document.getElementById('hud-sub-lon');
const hudMoonPhase = document.getElementById('hud-moon-phase');
const hudMoonDist = document.getElementById('hud-moon-dist');

// Format a signed decimal degree as "12.34° N" / "12.34° S" etc.
function formatLat(deg) {
    const sign = deg >= 0 ? 'N' : 'S';
    return Math.abs(deg).toFixed(3) + '° ' + sign;
}
function formatLon(deg) {
    const sign = deg >= 0 ? 'E' : 'W';
    return Math.abs(deg).toFixed(3) + '° ' + sign;
}

// --- Scene, camera, renderer -------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
);
camera.position.set(0, 1.5, 6.5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// OrbitControls — click-drag to orbit, scroll to zoom. Panning disabled so
// Earth stays centered as the reference point. Damping for a smoother feel.
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 25;

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

// Track loaded materials so the progressive-upgrade path can swap textures.
// moonMaterial is populated below once the Moon is created.
const materialRefs = {
    earthMaterial: null,
    cloudMaterial: null,
    moonMaterial: null,
};

// Asynchronously load the shader material and swap it in.
let updateEarthShader = null;
buildEarthMaterial(earth).then(({ material, updateShader }) => {
    earth.material.dispose();
    earth.material = material;
    materialRefs.earthMaterial = material;
    updateEarthShader = updateShader;
    console.log('Earth textures loaded — shader material active.');
    maybeStartHighResUpgrade();
}).catch((err) => {
    console.error('Failed to load Earth textures:', err);
});

// Cloud layer — asynchronously loaded, added to earthSpin so it stays tied
// to Earth's tilt but rotates independently on its own +Y (see clouds.js).
let setCloudSunDirection = null;
let tickClouds = null;
buildClouds().then(({ mesh, setSunDirection, tick }) => {
    earthSpin.add(mesh);
    materialRefs.cloudMaterial = mesh.material;
    setCloudSunDirection = setSunDirection;
    tickClouds = tick;
    console.log('Cloud layer loaded.');
    maybeStartHighResUpgrade();
}).catch((err) => {
    console.error('Failed to load cloud texture:', err);
});

// --- Progressive HD upgrade --------------------------------------------------
// Kick off once all 2K materials are ready. Auto-triggers on capable devices;
// manual override via the HD button in the UI.

const hdButton = document.getElementById('hd-toggle');
const hdStatus = document.getElementById('hd-status');
let hdUpgradeStarted = false;

function maybeStartHighResUpgrade() {
    if (hdUpgradeStarted) return;
    if (!materialRefs.earthMaterial || !materialRefs.cloudMaterial) return;
    if (shouldAutoUpgrade()) {
        startHighResUpgrade('auto');
    }
}

function startHighResUpgrade(trigger) {
    if (hdUpgradeStarted) return;
    hdUpgradeStarted = true;
    hdButton.setAttribute('data-loading', '1');
    hdStatus.textContent = 'HD loading…';
    console.log(`[HD] upgrade started (${trigger})`);

    upgradeToHighRes(materialRefs, (which) => {
        console.log('[HD] loaded:', which);
    })
        .then(() => {
            hdButton.setAttribute('data-loaded', '1');
            hdButton.removeAttribute('data-loading');
            hdStatus.textContent = 'HD';
            console.log('[HD] upgrade complete.');
        })
        .catch((err) => {
            hdUpgradeStarted = false;
            hdButton.removeAttribute('data-loading');
            hdStatus.textContent = 'HD failed';
            console.error('[HD] upgrade failed:', err);
        });
}

hdButton.addEventListener('click', () => startHighResUpgrade('manual'));

// Lat/lon grid — meridians every 30°, parallels every 30°, equator and
// prime meridian highlighted. Sits as a child of earthSpin so it rotates
// with Earth. Replaces the Phase 4 prime-meridian marker (now redundant
// since the prime meridian is drawn as a full amber line).
const latLonGrid = buildLatLonGrid();
earthSpin.add(latLonGrid);

// Atmosphere glow — slightly larger transparent shell around Earth,
// child of earthGroup so it stays with Earth even under the axial tilt.
const atmosphere = buildAtmosphere();
earthGroup.add(atmosphere);

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

// --- Moon --------------------------------------------------------------------
// Positioned at artistic scale — real Moon distance is ~60 Earth radii;
// we compress to ~5 units so it's visible next to Earth (scale disclaimer
// covers this). Real Moon:Earth radius ratio is 0.273; we use 0.15 for
// visual balance at the compressed distance.
//
// The Moon uses MeshStandardMaterial so the Sun's DirectionalLight illuminates
// it naturally — lunar phase emerges from the same lighting that gives Earth
// its day/night terminator, no extra shader needed.

const MOON_SCENE_DISTANCE = 5;
const moonGeometry = new THREE.SphereGeometry(0.15, 64, 64);
const moonMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95, // slight variation so craters catch grazing highlights
    metalness: 0,
});
const moon = new THREE.Mesh(moonGeometry, moonMaterial);
scene.add(moon);

// Register the moon material with the HD-upgrade path (declared earlier).
materialRefs.moonMaterial = moonMaterial;

// Load moon texture asynchronously; assigns to the existing material once ready.
new THREE.TextureLoader().load('/textures/moon_2k.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    moonMaterial.map = tex;
    moonMaterial.needsUpdate = true;
});

// --- Stars -------------------------------------------------------------------
const stars = buildStars();
scene.add(stars);

// --- Post-processing: bloom --------------------------------------------------
// Bright pixels (Sun marker, city lights on Earth's night side) glow softly.
// EffectComposer replaces the direct renderer.render() call in the loop.

const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,   // strength
    0.5,   // radius
    0.85,  // threshold — only pixels above this brightness bloom
);
composer.addPass(bloomPass);

// OutputPass handles tone mapping + color space conversion cleanly at the end
// of the chain — without it, colors can look washed out after bloom.
const outputPass = new OutputPass();
composer.addPass(outputPass);

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

function applyMoonState(moonState) {
    moon.position.set(
        moonState.direction.x * MOON_SCENE_DISTANCE,
        moonState.direction.y * MOON_SCENE_DISTANCE,
        moonState.direction.z * MOON_SCENE_DISTANCE,
    );
}

// Slow updates: values that change over minutes / hours / days.
function updateSlow() {
    const state = getEarthState();
    applyAxialTilt(state.axialTilt);
    applySunDirection(state.sunDirection);
    applyMoonState(state.moon);
    hudTilt.textContent = state.axialTilt.toFixed(4) + '°';
    hudSubLat.textContent = formatLat(state.subsolarPoint.latitude);
    hudSubLon.textContent = formatLon(state.subsolarPoint.longitude);
    hudSunLon.textContent = state.sunEclipticLongitude.toFixed(3) + '°';
    hudMoonPhase.textContent = (state.moon.phaseFraction * 100).toFixed(1) + '%';
    hudMoonDist.textContent = Math.round(state.moon.distanceKm).toLocaleString() + ' km';
}

updateSlow();
setInterval(updateSlow, 1000);

// --- Resize handling ---------------------------------------------------------

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloomPass.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop -------------------------------------------------------------

let lastFrameMs = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const nowMs = performance.now();
    const dtSec = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;

    const now = new Date();
    const state = getEarthState(now);
    applyEarthSpin(state.rotationAngle);

    // Feed world-space Sun direction (and camera position for Earth's specular)
    // into the Earth + cloud shaders. Each handles world→local transforms.
    if (updateEarthShader) updateEarthShader(state.sunDirection, camera);
    if (setCloudSunDirection) setCloudSunDirection(state.sunDirection);
    if (tickClouds) tickClouds(dtSec);

    hudRotation.textContent = state.rotationAngle.toFixed(3) + '°';
    hudTime.textContent = formatUTC(now);

    controls.update();
    composer.render();
}

animate();

console.log('Earth Project — Phase 5 scene initialized');
