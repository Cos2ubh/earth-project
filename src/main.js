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
import { buildMoonOrbit, updateMoonOrbit } from './moonOrbit.js';
import { buildLocationPin } from './locationPin.js';
import { resolveQuery } from './search.js';
import { fetchHistoricalEarthTexture, isDateInGibsRange } from './historicalTexture.js';
import { shouldAutoUpgrade, upgradeToHighRes } from './textureUpgrade.js';
import { playIntro } from './intro.js';
import {
    getSimulatedTime,
    setLive,
    setPaused,
    setScrubbing,
    setSpeedMultiplier,
    getMode,
    getSpeedMultiplier,
    jumpTo,
} from './timeControl.js';
import { getNextEclipses } from './astronomy.js';

const canvas = document.getElementById('canvas');
const hudTilt = document.getElementById('hud-tilt');
const hudRotation = document.getElementById('hud-rotation');
const hudTime = document.getElementById('hud-time');
const hudSunLon = document.getElementById('hud-sun-lon');
const hudSubLat = document.getElementById('hud-sub-lat');
const hudSubLon = document.getElementById('hud-sub-lon');
const hudMoonPhase = document.getElementById('hud-moon-phase');
const hudMoonDist = document.getElementById('hud-moon-dist');
const hudEclipseSolar = document.getElementById('hud-eclipse-solar');
const hudEclipseLunar = document.getElementById('hud-eclipse-lunar');
const hudYouSection = document.getElementById('hud-you');
const hudYouCoord = document.getElementById('hud-you-coord');
const hudYouTz = document.getElementById('hud-you-tz');
const hudYouWallTime = document.getElementById('hud-you-wall-time');
const hudYouLocalTime = document.getElementById('hud-you-local-time');
const hudYouSeason = document.getElementById('hud-you-season');

// Browser's IANA time zone (e.g. "Asia/Kolkata", "America/New_York").
// This is the user's system-configured zone — matches their phone / watch.
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Formatter for wall-clock time in the user's zone, including short zone name.
const wallClockFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: userTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
});

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
// Save the initial camera state so the recenter button can restore it.
controls.saveState();

document.getElementById('recenter-btn').addEventListener('click', () => {
    controls.reset();
});

// --- Cinematic intro ----------------------------------------------------------
// Disable orbit input for the dolly-in so a drag mid-flight can't fight the
// tween; playIntro re-enables it (via introActive flag below) once it's done
// or skipped. See src/intro.js for the full rationale.
let introActive = true;
controls.enabled = false;
playIntro(camera, { x: 0, y: 1.5, z: 6.5 }, () => {
    introActive = false;
    controls.enabled = true;
});

// --- Earth hierarchy ---------------------------------------------------------

const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earthSpin = new THREE.Group();
earthGroup.add(earthSpin);

// Higher subdivisions for smooth terrain displacement — 256×256 = ~65k
// vertices, well within modern GPU headroom. Reduce for low-end mobile if
// framerate suffers.
const earthGeometry = new THREE.SphereGeometry(1, 256, 256);
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
    // Called by textureUpgrade when the 8K day texture is ready.
    // Updates baseDayTexture, and only swaps the uniform if no historical
    // GIBS overlay is active.
    onEarthDayReady: (newTex) => {
        const oldBase = baseDayTexture;
        baseDayTexture = newTex;
        if (!historicalDayTexture) {
            materialRefs.earthMaterial.uniforms.uDayTexture.value = newTex;
            materialRefs.earthMaterial.needsUpdate = true;
        }
        // Only dispose the old base if it isn't the currently-displayed uniform
        // (edge case: user set historical then triggered HD before reset).
        if (oldBase && oldBase !== materialRefs.earthMaterial.uniforms.uDayTexture.value) {
            oldBase.dispose();
        }
    },
};

// Asynchronously load the shader material and swap it in.
// Tracking baseDayTexture separately from the active uniform lets us layer
// historical NASA GIBS imagery on top and pop back to base cleanly.
let updateEarthShader = null;
let baseDayTexture = null;         // reference to the current 2K or 8K base
let historicalDayTexture = null;   // active GIBS image, if any
buildEarthMaterial(earth).then(({ material, updateShader }) => {
    earth.material.dispose();
    earth.material = material;
    materialRefs.earthMaterial = material;
    baseDayTexture = material.uniforms.uDayTexture.value;
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
    }).then(({ succeeded, failed }) => {
        // Partial success is still success — only the textures that actually
        // failed get retried; the ones that loaded stay loaded.
        hdButton.removeAttribute('data-loading');
        if (failed.length === 0) {
            hdButton.setAttribute('data-loaded', '1');
            hdStatus.textContent = 'HD';
            console.log('[HD] upgrade complete.');
        } else if (succeeded.length === 0) {
            hdUpgradeStarted = false;
            hdStatus.textContent = 'HD failed';
            console.error('[HD] upgrade failed — no textures loaded:', failed);
        } else {
            // Some textures upgraded, some didn't — allow retrying just the
            // failed ones rather than reporting total failure.
            hdUpgradeStarted = false;
            hdStatus.textContent = `HD partial (${failed.length} failed)`;
            console.warn('[HD] partial upgrade — failed:', failed.map((f) => f.name));
        }
    });
}

hdButton.addEventListener('click', () => startHighResUpgrade('manual'));

// --- Time-scrub controls -----------------------------------------------------
// Slider spans ± 180 days from "now at page load." Speed presets let you
// watch a day, a month, or a year sweep past.

const scrubSlider = document.getElementById('scrub-slider');
const scrubLabel = document.getElementById('scrub-label');
const playPauseBtn = document.getElementById('play-pause');
const liveBtn = document.getElementById('live-btn');
const speedButtons = document.querySelectorAll('.speed-btn');

const pageLoadMs = Date.now();
const SCRUB_RANGE_DAYS = 180;

function msFromSliderValue(v) {
    // v is [-1, 1]; map to ± SCRUB_RANGE_DAYS relative to page load
    return pageLoadMs + v * SCRUB_RANGE_DAYS * 86400 * 1000;
}

function updateScrubLabel() {
    const t = getSimulatedTime();
    const iso = t.toISOString();
    const mode = getMode();
    const modeTag =
        mode === 'live' ? 'LIVE' :
        mode === 'paused' ? 'PAUSED' :
        `× ${getSpeedMultiplier().toLocaleString()}`;
    scrubLabel.textContent = `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC · ${modeTag}`;
}

function syncSliderFromSimulatedTime() {
    const simMs = getSimulatedTime().getTime();
    const v = (simMs - pageLoadMs) / (SCRUB_RANGE_DAYS * 86400 * 1000);
    scrubSlider.value = String(Math.max(-1, Math.min(1, v)));
}

scrubSlider.addEventListener('input', () => {
    const v = parseFloat(scrubSlider.value);
    jumpTo(msFromSliderValue(v));
    playPauseBtn.setAttribute('data-state', 'paused');
    liveBtn.removeAttribute('data-active');
    updateScrubLabel();
});

playPauseBtn.addEventListener('click', () => {
    const mode = getMode();
    if (mode === 'scrubbing') {
        setPaused(getSimulatedTime());
        playPauseBtn.setAttribute('data-state', 'paused');
    } else {
        // Resume scrubbing from current position at last-picked speed
        const currentSpeed = parseInt(
            document.querySelector('.speed-btn[data-active]')?.dataset.speed || '3600',
            10,
        );
        setScrubbing(getSimulatedTime(), currentSpeed);
        playPauseBtn.setAttribute('data-state', 'playing');
        liveBtn.removeAttribute('data-active');
    }
});

liveBtn.addEventListener('click', () => {
    setLive();
    liveBtn.setAttribute('data-active', '1');
    playPauseBtn.setAttribute('data-state', 'paused');
});

speedButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        const alreadyActive = btn.hasAttribute('data-active');
        // Always clear all first — makes the group behave like a toggle set.
        speedButtons.forEach((b) => b.removeAttribute('data-active'));

        if (alreadyActive) {
            // Click on the already-active speed = deselect + pause at current time.
            setPaused(getSimulatedTime());
            playPauseBtn.setAttribute('data-state', 'paused');
            return;
        }

        // New speed picked — activate visually and start / update scrubbing.
        btn.setAttribute('data-active', '1');
        const speed = parseInt(btn.dataset.speed, 10);
        if (getMode() === 'scrubbing') {
            setSpeedMultiplier(speed);
        } else {
            setScrubbing(getSimulatedTime(), speed);
            playPauseBtn.setAttribute('data-state', 'playing');
            liveBtn.removeAttribute('data-active');
        }
    });
});

// Default states.
liveBtn.setAttribute('data-active', '1');
document.querySelector('.speed-btn[data-speed="3600"]').setAttribute('data-active', '1');
playPauseBtn.setAttribute('data-state', 'paused');

// Refresh the scrub UI on its own tick — every 200ms is plenty for reading.
setInterval(() => {
    if (getMode() !== 'paused') syncSliderFromSimulatedTime();
    updateScrubLabel();
}, 200);

// --- Location pin + You section ---------------------------------------------

const locateBtn = document.getElementById('locate-btn');
let userLocation = null;  // { lat, lon }
let locationPin = null;

function seasonFor(sunEclipticLon, latitude) {
    // Astronomical seasons in the northern hemisphere:
    //   λ ∈ [ 0°, 90°) — spring
    //   λ ∈ [90°, 180°) — summer
    //   λ ∈ [180°, 270°) — autumn
    //   λ ∈ [270°, 360°) — winter
    // Southern hemisphere: swap summer↔winter and spring↔autumn.
    const northern = latitude >= 0;
    const λ = ((sunEclipticLon % 360) + 360) % 360;
    if (λ < 90) return northern ? 'spring' : 'autumn';
    if (λ < 180) return northern ? 'summer' : 'winter';
    if (λ < 270) return northern ? 'autumn' : 'spring';
    return northern ? 'winter' : 'summer';
}

function localSolarTime(date, longitudeDeg) {
    // Mean local solar time: UTC + longitude/15 hours.
    // Doesn't include the equation of time (up to ±16 min), which is fine
    // for a HUD readout — accurate to within a quarter hour of true solar noon.
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    let lst = utcHours + longitudeDeg / 15;
    lst = ((lst % 24) + 24) % 24;
    const h = Math.floor(lst);
    const m = Math.floor((lst - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} solar`;
}

function updateYouSection() {
    if (!userLocation) return;
    const now = getSimulatedTime();
    const eclipticLon = getEarthState(now).sunEclipticLongitude;
    hudYouLocalTime.textContent = localSolarTime(now, userLocation.lon);
    hudYouWallTime.textContent = wallClockFormatter.format(now);
    hudYouSeason.textContent = seasonFor(eclipticLon, userLocation.lat);
}

locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
        locateBtn.textContent = 'no geo';
        return;
    }
    locateBtn.setAttribute('data-loading', '1');
    locateBtn.textContent = 'locating…';
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            locationPin = buildLocationPin(userLocation.lat, userLocation.lon);
            earthSpin.add(locationPin);
            hudYouSection.style.display = '';
            hudYouCoord.textContent =
                `${Math.abs(userLocation.lat).toFixed(2)}° ${userLocation.lat >= 0 ? 'N' : 'S'} · ` +
                `${Math.abs(userLocation.lon).toFixed(2)}° ${userLocation.lon >= 0 ? 'E' : 'W'}`;
            hudYouTz.textContent = userTimeZone;
            locateBtn.removeAttribute('data-loading');
            locateBtn.setAttribute('data-active', '1');
            locateBtn.textContent = 'located';
            updateYouSection();
        },
        (err) => {
            locateBtn.removeAttribute('data-loading');
            locateBtn.textContent = 'denied';
            console.warn('Geolocation denied:', err.message);
        },
        { timeout: 10_000, maximumAge: 600_000 },
    );
});

setInterval(updateYouSection, 1000);

// --- Search bar --------------------------------------------------------------

const searchInput = document.getElementById('search-input');
const searchResult = document.getElementById('search-result');

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function renderResultEvent(event, date) {
    searchResult.innerHTML =
        `<div><span class="r-title">${escapeHtml(event.name)}</span> · ` +
        `<span class="r-date">${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC</span></div>` +
        `<div class="r-desc">${escapeHtml(event.description)}</div>`;
    searchResult.setAttribute('data-visible', '1');
}

function renderResultDate(date, matchedText) {
    searchResult.innerHTML =
        `<div><span class="r-title">Jumped to</span> · ` +
        `<span class="r-date">${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC</span></div>` +
        `<div class="r-desc">Parsed from “${escapeHtml(matchedText)}”</div>`;
    searchResult.setAttribute('data-visible', '1');
}

function renderResultMiss(query) {
    searchResult.innerHTML =
        `<div class="r-miss">No match for “${escapeHtml(query)}” — try a specific date like ` +
        `<em>August 29 2005</em> or a named event like <em>Apollo 11</em>.</div>`;
    searchResult.setAttribute('data-visible', '1');
}

function applyHistoricalImagery(date, resultRenderer) {
    if (!materialRefs.earthMaterial || !isDateInGibsRange(date)) {
        return; // Nothing to do (pre-satellite era or material not ready)
    }
    // Show loading state inline in the result panel.
    resultRenderer.setStatus('Fetching MODIS imagery…');
    fetchHistoricalEarthTexture(date).then(({ texture, dateStr }) => {
        // Dispose any previous historical texture we swapped in.
        if (historicalDayTexture) historicalDayTexture.dispose();
        historicalDayTexture = texture;
        materialRefs.earthMaterial.uniforms.uDayTexture.value = texture;
        materialRefs.earthMaterial.needsUpdate = true;
        resultRenderer.setStatus(`Showing MODIS imagery for ${dateStr}`, true);
    }).catch((err) => {
        console.warn('GIBS fetch failed:', err);
        resultRenderer.setStatus('Historical imagery unavailable for this date.');
    });
}

function resetHistoricalImagery() {
    if (!historicalDayTexture || !materialRefs.earthMaterial) return;
    materialRefs.earthMaterial.uniforms.uDayTexture.value = baseDayTexture;
    materialRefs.earthMaterial.needsUpdate = true;
    historicalDayTexture.dispose();
    historicalDayTexture = null;
}

function performSearch(query) {
    const result = resolveQuery(query, getSimulatedTime());

    // Reusable renderer for the search-result panel status line.
    const statusRenderer = {
        setStatus(text, showResetBtn = false) {
            const existing = searchResult.querySelector('.r-imagery');
            const btn = showResetBtn
                ? ` <button class="r-reset" type="button">reset view</button>`
                : '';
            const html = `<div class="r-imagery">${escapeHtml(text)}${btn}</div>`;
            if (existing) existing.outerHTML = html;
            else searchResult.insertAdjacentHTML('beforeend', html);
            if (showResetBtn) {
                searchResult.querySelector('.r-reset').addEventListener('click', () => {
                    resetHistoricalImagery();
                    const el = searchResult.querySelector('.r-imagery');
                    if (el) el.remove();
                });
            }
        },
    };

    if (result.kind === 'event') {
        jumpTo(result.date);
        setPaused(result.date);
        playPauseBtn.setAttribute('data-state', 'paused');
        liveBtn.removeAttribute('data-active');
        syncSliderFromSimulatedTime();
        updateScrubLabel();
        renderResultEvent(result.event, result.date);
        applyHistoricalImagery(result.date, statusRenderer);
    } else if (result.kind === 'date') {
        jumpTo(result.date);
        setPaused(result.date);
        playPauseBtn.setAttribute('data-state', 'paused');
        liveBtn.removeAttribute('data-active');
        syncSliderFromSimulatedTime();
        updateScrubLabel();
        renderResultDate(result.date, result.text);
        applyHistoricalImagery(result.date, statusRenderer);
    } else {
        renderResultMiss(query);
    }
}

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        performSearch(searchInput.value.trim());
    } else if (e.key === 'Escape') {
        searchInput.value = '';
        searchResult.removeAttribute('data-visible');
        searchInput.blur();
    }
});

// Focus search on "/" like GitHub / Slack — small quality-of-life shortcut.
window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

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

// Moon orbit ring — thin traced path showing where the Moon travels around
// Earth over one sidereal month. Uses the same astronomy engine so the 5.14°
// inclination and orbital plane orientation are exact.
const moonOrbit = buildMoonOrbit(MOON_SCENE_DISTANCE);
scene.add(moonOrbit);

// Load moon texture asynchronously; assigns to the existing material once ready.
new THREE.TextureLoader().load('/textures/moon_2k.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    moonMaterial.map = tex;
    moonMaterial.needsUpdate = true;
});

// --- Stars (real Yale Bright Star Catalog) -----------------------------------
buildStars().then((stars) => {
    scene.add(stars);
}).catch((err) => {
    console.error('Failed to load star catalog:', err);
});

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
let lastOrbitUpdateMs = 0;
function updateSlow() {
    const now = getSimulatedTime();
    const state = getEarthState(now);
    applyAxialTilt(state.axialTilt);
    applySunDirection(state.sunDirection);
    applyMoonState(state.moon);
    // Refresh the moon orbit ring occasionally (every ~1 sim-hour) so it
    // stays anchored around the current simulated time and shows the small
    // orbital-plane drift when scrubbing.
    if (Math.abs(now.getTime() - lastOrbitUpdateMs) > 3600 * 1000) {
        updateMoonOrbit(moonOrbit, MOON_SCENE_DISTANCE, now);
        lastOrbitUpdateMs = now.getTime();
    }
    hudTilt.textContent = state.axialTilt.toFixed(4) + '°';
    hudSubLat.textContent = formatLat(state.subsolarPoint.latitude);
    hudSubLon.textContent = formatLon(state.subsolarPoint.longitude);
    hudSunLon.textContent = state.sunEclipticLongitude.toFixed(3) + '°';
    hudMoonPhase.textContent = (state.moon.phaseFraction * 100).toFixed(1) + '%';
    hudMoonDist.textContent = Math.round(state.moon.distanceKm).toLocaleString() + ' km';
}

// Eclipse search is more expensive than the per-second state update, and the
// answers only change once every ~2 weeks — recompute every 30 seconds.
function formatEclipse(e) {
    if (!e) return '—';
    const iso = e.peakDate.toISOString().slice(0, 10);
    const days = Math.abs(e.daysAway).toFixed(0);
    return `${iso} · ${e.kind} · in ${days}d`;
}

function updateEclipses() {
    const now = getSimulatedTime();
    const eclipses = getNextEclipses(now);
    hudEclipseSolar.textContent = formatEclipse(eclipses.solar);
    hudEclipseLunar.textContent = formatEclipse(eclipses.lunar);
}
updateEclipses();
setInterval(updateEclipses, 30_000);

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

    const now = getSimulatedTime();
    const state = getEarthState(now);
    applyEarthSpin(state.rotationAngle);
    // Slow updates need to fire every frame in scrubbing mode too, otherwise
    // tilt/sun/moon lag behind while Earth spins fast. Cheap to recompute.
    if (getMode() !== 'live') {
        applyAxialTilt(state.axialTilt);
        applySunDirection(state.sunDirection);
        applyMoonState(state.moon);
    }

    // Feed world-space Sun direction (and camera position for Earth's specular)
    // into the Earth + cloud shaders. Each handles world→local transforms.
    if (updateEarthShader) updateEarthShader(state.sunDirection, camera);
    if (setCloudSunDirection) setCloudSunDirection(state.sunDirection);
    if (tickClouds) tickClouds(dtSec);

    hudRotation.textContent = state.rotationAngle.toFixed(3) + '°';
    hudTime.textContent = formatUTC(now);

    // Skip OrbitControls entirely while the intro dolly owns camera.position —
    // it's disabled for input already, but this also keeps it from touching
    // the camera at all until playIntro hands control back.
    if (!introActive) controls.update();
    composer.render();
}

animate();

console.log('Earth Project — Phase 5 scene initialized');
