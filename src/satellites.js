// Live ISS tracking: real Celestrak orbital elements propagated with
// satellite.js (SGP4, the same algorithm ground-tracking software uses).
//
// What you see: a bright pulsing dot with an "ISS" label, and a 30-minute
// comet trail behind it that fades into nothing. The side panel adds what it
// is flying over, its altitude, its speed and whether it is in sunlight.
//
// Honesty notes (same spirit as the project's other "label the artistic
// license" habits):
//   - Altitude is exaggerated 1.5x (a real ~420 km orbit is only ~6.6% of
//     Earth's radius, which would sit almost on top of the atmosphere glow).
//     Latitude, longitude, speed and the sunlight test all use true values.
//   - TLEs are a snapshot that degrades over days, so the ISS is shown ONLY in
//     live mode. Scrubbing to another date hides it rather than propagating
//     today's orbital elements to a date they don't describe; that would look
//     precise while being fiction.
//   - The trail is the real ground track: the satellite's position over the
//     last 30 minutes, expressed in the Earth-fixed frame, so it draws the
//     diagonal path over the continents that ground stations see.
//   - "In sunlight" is computed from real geometry: the satellite's orbital
//     position against the true Sun direction, both in the same equatorial
//     frame, with a simple cylindrical Earth shadow (no penumbra, no
//     atmosphere). Good enough for a low orbit like the ISS, and it does not
//     depend on how the 3D scene happens to orient the globe.
//
// Structure note: the trail lives at the tracker's origin, NOT inside the
// moving marker group. An earlier version parented the trail to the marker,
// which translated the whole path by the satellite's position and left it
// floating off the globe.

import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { regionAt } from './regionLookup.js';
import { getSunEquatorialDirection } from './astronomy.js';

const EARTH_RADIUS_KM = 6371;
const ALTITUDE_EXAGGERATION = 1.5;

const TRAIL_MINUTES = 30;
const TRAIL_VERTICES = 91; // one vertex every 20 s
const TRAIL_REFRESH_MS = 2000;
const TRAIL_LINE_WIDTH = 2.2; // CSS pixels

const FETCH_TIMEOUT_MS = 10_000;
// Celestrak refreshes its element sets about every 2 hours and asks clients
// not to poll faster, so a fetched TLE is cached in localStorage. That also
// means reloading the page while developing doesn't hammer their server.
const CACHE_FRESH_MS = 2 * 60 * 60 * 1000;
const CACHE_MAX_STALE_MS = 3 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

const TRACKED = [
    { label: 'ISS', catnr: 25544, color: 0x73e5ff },
];

function tleUrl(catnr) {
    return `https://celestrak.org/NORAD/elements/gp.php?CATNR=${catnr}&FORMAT=TLE`;
}

function parseTleBlocks(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const records = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
        const [name, line1, line2] = [lines[i], lines[i + 1], lines[i + 2]];
        if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
        records.push({ name, line1, line2 });
    }
    return records;
}

async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Celestrak fetch failed: ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

function readCache(key) {
    try {
        return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
    } catch {
        return null;
    }
}

function writeCache(key, value) {
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
        // storage full or blocked: caching is a courtesy, not a requirement
    }
}

/**
 * Get a satrec for one tracked satellite: fresh cache → network → stale
 * cache (better a slightly old orbit than none) → null. Never throws.
 */
async function loadSatrec(entry) {
    const key = `earth-project:tle:${entry.catnr}`;
    const now = Date.now();
    const cached = readCache(key);

    let text = null;
    if (cached && now - cached.fetchedAt < CACHE_FRESH_MS) {
        text = cached.text;
    } else {
        try {
            const fetched = await fetchText(tleUrl(entry.catnr));
            if (parseTleBlocks(fetched).length > 0) {
                text = fetched;
                writeCache(key, { fetchedAt: now, text: fetched });
            }
        } catch {
            // fall through to stale cache
        }
        if (text === null && cached && now - cached.fetchedAt < CACHE_MAX_STALE_MS) {
            text = cached.text;
        }
    }
    if (text === null) return null;

    const block = parseTleBlocks(text)[0];
    if (!block) return null;
    const satrec = satellite.twoline2satrec(block.line1, block.line2);
    return satrec.error ? null : satrec;
}

// Same convention as grid.js / locationPin.js: local +Z = prime meridian,
// +Y = north pole, +X = 90°E. Each file owns this one small conversion.
function geodeticToVec3(latRad, lonRad, r, target = new THREE.Vector3()) {
    const cosLat = Math.cos(latRad);
    return target.set(
        cosLat * Math.sin(lonRad) * r,
        Math.sin(latRad) * r,
        cosLat * Math.cos(lonRad) * r,
    );
}

function radiusForAltitudeKm(altitudeKm) {
    return 1 + (altitudeKm / EARTH_RADIUS_KM) * ALTITUDE_EXAGGERATION;
}

/** Propagate to `date`; returns null when SGP4 fails (e.g. a decayed orbit). */
function propagate(satrec, date) {
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
    const v = pv.velocity;
    return {
        positionKm: pv.position,
        latRad: geo.latitude,
        lonRad: geo.longitude,
        altitudeKm: geo.height,
        speedKmS: v && typeof v !== 'boolean' ? Math.hypot(v.x, v.y, v.z) : 0,
    };
}

/**
 * True unless the satellite is inside Earth's shadow. Cylindrical shadow
 * model: behind the Earth relative to the Sun AND closer to the Earth-Sun
 * axis than one Earth radius.
 *
 * @param positionKm    satellite position from the geocentre, km, any frame
 * @param sunDirection  unit vector from Earth toward the Sun, SAME frame
 */
export function isSunlit(positionKm, sunDirection) {
    const along = positionKm.x * sunDirection.x + positionKm.y * sunDirection.y + positionKm.z * sunDirection.z;
    if (along >= 0) return true;
    const distanceSq = positionKm.x ** 2 + positionKm.y ** 2 + positionKm.z ** 2;
    const perpendicular = Math.sqrt(Math.max(0, distanceSq - along * along));
    return perpendicular > EARTH_RADIUS_KM;
}

/** True if the sphere of radius `radius` at the origin blocks camera → point. */
function blockedByGlobe(cameraPosition, point, radius = 1) {
    const toPoint = point.clone().sub(cameraPosition);
    const distance = toPoint.length();
    if (distance === 0) return false;
    toPoint.divideScalar(distance);
    const b = cameraPosition.dot(toPoint);
    const discriminant = b * b - (cameraPosition.lengthSq() - radius * radius);
    if (discriminant < 0) return false;
    const nearHit = -b - Math.sqrt(discriminant);
    return nearHit > 0 && nearHit < distance;
}

// --- Sprite textures (skipped when there is no DOM, e.g. in Node tests) ----

function makeGlowTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.12, 'rgba(200, 244, 255, 0.9)');
    gradient.addColorStop(0.3, 'rgba(100, 210, 255, 0.34)');
    gradient.addColorStop(0.6, 'rgba(50, 150, 255, 0.08)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const LABEL_CANVAS = { width: 256, height: 96 };

function makeLabelTexture(text) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_CANVAS.width;
    canvas.height = LABEL_CANVAS.height;
    const ctx = canvas.getContext('2d');
    ctx.font = '600 46px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(205, 236, 255, 0.92)';
    ctx.fillText(text, 10, LABEL_CANVAS.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// --- One tracked satellite -----------------------------------------------------

function buildTrackedSatellite(entry, satrec, resolution) {
    const baseColor = new THREE.Color(entry.color); // linear working-space values

    // Everything below is a child of `root`, which the caller parents to
    // earthSpin, so positions here are Earth-fixed (they corotate).
    const root = new THREE.Group();
    root.name = `satellite:${entry.label}`;

    // Trail (fat line). Vertex 0 is the oldest point, the last vertex is "now".
    const positions = new Float32Array(TRAIL_VERTICES * 3);
    const colors = new Float32Array(TRAIL_VERTICES * 3);
    for (let k = 0; k < TRAIL_VERTICES; k++) {
        const fade = Math.pow(k / (TRAIL_VERTICES - 1), 1.8);
        colors[k * 3] = baseColor.r * fade;
        colors[k * 3 + 1] = baseColor.g * fade;
        colors[k * 3 + 2] = baseColor.b * fade;
    }
    const trailGeometry = new LineGeometry();
    trailGeometry.setPositions(positions);
    trailGeometry.setColors(colors);
    const trailMaterial = new LineMaterial({
        color: 0xffffff,
        linewidth: TRAIL_LINE_WIDTH,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        resolution: resolution.clone(),
    });
    const trail = new Line2(trailGeometry, trailMaterial);
    trail.frustumCulled = false; // vertices move in place; the cached bounds would go stale
    root.add(trail);

    // The fat line stores each segment as [start xyz, end xyz], so vertex k
    // lives in two places (end of segment k-1, start of segment k).
    const segmentData = trailGeometry.attributes.instanceStart.data;
    function setTrailVertex(k, x, y, z) {
        const a = segmentData.array;
        if (k < TRAIL_VERTICES - 1) {
            const o = k * 6;
            a[o] = x; a[o + 1] = y; a[o + 2] = z;
        }
        if (k > 0) {
            const o = (k - 1) * 6 + 3;
            a[o] = x; a[o + 1] = y; a[o + 2] = z;
        }
    }

    // Marker: bright core + soft pulsing halo + camera-facing label.
    const marker = new THREE.Group();
    root.add(marker);

    const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.016, 20, 20),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.7, 2.0) }),
    );
    marker.add(core);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: baseColor,
        transparent: true,
        depthTest: false, // drawn like UI; occlusion by the globe is handled by `presence` below
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: false, // constant on-screen size at any zoom
    }));
    halo.renderOrder = 10;
    marker.add(halo);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(entry.label),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false,
    }));
    label.renderOrder = 11;
    const labelHeight = 0.0354;
    label.scale.set(labelHeight * (LABEL_CANVAS.width / LABEL_CANVAS.height), labelHeight, 1);
    label.center.set(-0.2, 0.5); // sit to the right of the dot, vertically centred
    marker.add(label);

    // Live state
    const localPosition = new THREE.Vector3();
    const worldPosition = new THREE.Vector3();
    let lastTrailMs = -Infinity;
    let lastDate = new Date();
    let presence = 0; // 0..1 fade for the label/halo (hidden behind the globe)
    let info = null;
    let sunAtMs = -Infinity;
    let sunDirection = { x: 1, y: 0, z: 0 };

    function rebuildTrail(date) {
        const spanMs = TRAIL_MINUTES * 60 * 1000;
        const p = new THREE.Vector3();
        for (let k = 0; k < TRAIL_VERTICES - 1; k++) {
            const t = date.getTime() - spanMs * (1 - k / (TRAIL_VERTICES - 1));
            const geo = propagate(satrec, new Date(t));
            if (!geo) continue;
            geodeticToVec3(geo.latRad, geo.lonRad, radiusForAltitudeKm(geo.altitudeKm), p);
            setTrailVertex(k, p.x, p.y, p.z);
        }
        lastTrailMs = date.getTime();
    }

    function update(date, ctx) {
        lastDate = date;
        const geo = propagate(satrec, date);
        if (!geo) {
            root.visible = false;
            info = null;
            return;
        }
        root.visible = true;

        geodeticToVec3(geo.latRad, geo.lonRad, radiusForAltitudeKm(geo.altitudeKm), localPosition);
        marker.position.copy(localPosition);

        if (Math.abs(date.getTime() - lastTrailMs) > TRAIL_REFRESH_MS) rebuildTrail(date);
        setTrailVertex(TRAIL_VERTICES - 1, localPosition.x, localPosition.y, localPosition.z);
        segmentData.needsUpdate = true;

        // World-frame position (needs the parent chain's current transforms).
        worldPosition.copy(localPosition);
        if (root.parent) {
            root.parent.updateWorldMatrix(true, false);
            worldPosition.applyMatrix4(root.parent.matrixWorld);
        }

        // The Sun moves ~0.04°/min against the stars; once a second is plenty.
        if (Math.abs(date.getTime() - sunAtMs) > 1000) {
            sunDirection = getSunEquatorialDirection(date);
            sunAtMs = date.getTime();
        }
        const sunlit = isSunlit(geo.positionKm, sunDirection);

        // Fade the label/halo out while the globe is between camera and ISS.
        const hidden = ctx.cameraPosition && blockedByGlobe(ctx.cameraPosition, worldPosition);
        const dt = ctx.dtSec ?? 0.016;
        presence += ((hidden ? 0 : 1) - presence) * (1 - Math.exp(-dt * 8));

        const pulse = 1 + 0.09 * Math.sin((performance.now() / 1000) * (Math.PI * 2 / 2.4));
        const brightness = (sunlit ? 1 : 0.5) * presence;
        halo.scale.setScalar(0.04 * pulse);
        halo.material.opacity = brightness;
        label.material.opacity = presence * (sunlit ? 1 : 0.7);
        core.visible = presence > 0.02;

        info = {
            name: entry.label,
            latDeg: THREE.MathUtils.radToDeg(geo.latRad),
            lonDeg: THREE.MathUtils.radToDeg(geo.lonRad),
            altitudeKm: geo.altitudeKm,
            speedKmh: geo.speedKmS * 3600,
            sunlit,
        };
    }

    /** World-space position and direction of travel, for the follow camera. */
    function getFocus() {
        if (!info) return null;
        const ahead = propagate(satrec, new Date(lastDate.getTime() + 2000));
        if (!ahead) return null;
        const nextLocal = geodeticToVec3(ahead.latRad, ahead.lonRad, radiusForAltitudeKm(ahead.altitudeKm));
        const nextWorld = nextLocal.clone();
        if (root.parent) nextWorld.applyMatrix4(root.parent.matrixWorld);
        return {
            worldPosition: worldPosition.clone(),
            worldTangent: nextWorld.sub(worldPosition).normalize(),
        };
    }

    return {
        root,
        update,
        getFocus,
        getInfo: () => info,
        setSatrec(next) {
            satrec = next;
            lastTrailMs = -Infinity;
        },
        setResolution(size) {
            trailMaterial.resolution.copy(size);
        },
    };
}

/**
 * Build the ISS tracking layer. Returns { group, tick, getInfo, getFocus,
 * getLoadState, setResolution }. `group` goes under earthSpin (like the
 * lat/lon grid) because positions are Earth-fixed.
 *
 * tick(date, isLive, ctx): ctx = { dtSec, cameraPosition: Vector3 (world) }.
 */
export function buildSatelliteTracker() {
    const group = new THREE.Group();
    group.name = 'satellites';
    group.visible = false;

    const resolution = new THREE.Vector2(
        typeof window === 'undefined' ? 1600 : window.innerWidth,
        typeof window === 'undefined' ? 1000 : window.innerHeight,
    );

    const tracked = new Map(); // catnr → tracked satellite
    let loadState = 'loading';
    let loading = false;
    let nextLoadAtMs = 0;

    async function load() {
        loading = true;
        let anyFailed = false;
        try {
            for (const entry of TRACKED) {
                const satrec = await loadSatrec(entry);
                if (!satrec) {
                    anyFailed = true;
                    continue;
                }
                const existing = tracked.get(entry.catnr);
                if (existing) {
                    existing.setSatrec(satrec);
                } else {
                    const built = buildTrackedSatellite(entry, satrec, resolution);
                    tracked.set(entry.catnr, built);
                    group.add(built.root);
                }
            }
        } catch (err) {
            anyFailed = true;
            console.error('[ISS] tracker setup failed:', err);
        } finally {
            loadState = tracked.size > 0 ? 'ok' : 'unavailable';
            nextLoadAtMs = Date.now() + (anyFailed ? RETRY_AFTER_FAILURE_MS : CACHE_FRESH_MS + 60_000);
            loading = false;
        }
    }

    function first() {
        return tracked.values().next().value ?? null;
    }

    function tick(date, isLive, ctx = {}) {
        group.visible = isLive && tracked.size > 0;
        if (!loading && Date.now() >= nextLoadAtMs) load();
        if (!isLive) return;
        for (const t of tracked.values()) t.update(date, ctx);
    }

    return {
        group,
        tick,
        getLoadState: () => loadState,
        getInfo() {
            const t = first();
            const info = t?.getInfo();
            if (!info) return null;
            return { ...info, region: regionAt(info.latDeg, info.lonDeg) };
        },
        getFocus() {
            return first()?.getFocus() ?? null;
        },
        setResolution(width, height) {
            resolution.set(width, height);
            for (const t of tracked.values()) t.setResolution(resolution);
        },
    };
}
