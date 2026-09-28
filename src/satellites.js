// Live satellite tracking — a small set of notable satellites (ISS, the
// Chinese Space Station, Hubble), propagated from real Celestrak orbital
// elements via satellite.js (a full SGP4/SDP4 implementation, the same
// algorithm real ground-tracking software uses).
//
// Honesty notes (same spirit as the project's other "label the artistic
// license" habits):
//   - Altitude is exaggerated ~6x above the true Earth-radius ratio so a
//     ~400-450km orbit reads as visibly "above" the surface at this scene's
//     scale, instead of being indistinguishable from ground level. The
//     ground-track line and lat/lon math underneath are not exaggerated —
//     only the radial distance drawn for the marker.
//   - TLEs are a snapshot fetched once per session (refreshed hourly) and
//     degrade in accuracy over days, so satellites are shown ONLY in live
//     mode. Scrubbing to a past/future date hides them rather than showing
//     a real satellite propagated to a date its orbital elements don't
//     actually describe — that would look precise while being fiction.
//   - The rendered ground track is real: a satellite's sub-point traced over
//     one full orbital period genuinely draws the diagonal sine-wave path
//     ground stations see, because Earth keeps rotating underneath while we
//     sample — no artistic license needed there, it just falls out of the
//     real geometry.

import * as THREE from 'three';
import * as satellite from 'satellite.js';

const FETCH_TIMEOUT_MS = 10_000;
const REFRESH_MS = 60 * 60 * 1000; // TLEs are fine stale for hours; refresh hourly
const EARTH_RADIUS_KM = 6371;
const ALTITUDE_EXAGGERATION = 6; // see honesty note above
const GROUND_TRACK_SAMPLES = 90;

const SOURCES = [
    { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE' },
    { url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=20580&FORMAT=TLE' }, // Hubble
];

const MARKER_COLORS = [0x6ad4ff, 0xff9d5c, 0xd4a5ff, 0x8cff9d];

function parseTleBlocks(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const records = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i];
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
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

/**
 * Fetch and parse TLEs for the curated satellite set. Returns an array of
 * { name, satrec, periodMinutes } — empty on total failure (no network, all
 * sources blocked). Never throws; a missing satellite layer is a fine
 * degradation for a decorative feature.
 */
async function fetchSatelliteRecords() {
    const seen = new Map();
    for (const source of SOURCES) {
        try {
            const text = await fetchText(source.url);
            for (const { name, line1, line2 } of parseTleBlocks(text)) {
                if (seen.has(name)) continue;
                const satrec = satellite.twoline2satrec(line1, line2);
                if (satrec.error) continue;
                const periodMinutes = (2 * Math.PI) / satrec.no;
                seen.set(name, { name, satrec, periodMinutes });
            }
        } catch {
            // one source failing shouldn't take the others down with it
        }
    }
    return Array.from(seen.values());
}

// Same convention as grid.js / locationPin.js: local +Z = prime meridian,
// local +Y = north pole, local +X = 90°E. Kept local rather than imported —
// each of these files independently owns this one small conversion.
function geodeticToVec3(latRad, lonRad, r) {
    const cosLat = Math.cos(latRad);
    return new THREE.Vector3(
        cosLat * Math.sin(lonRad) * r,
        Math.sin(latRad) * r,
        cosLat * Math.cos(lonRad) * r,
    );
}

function sceneRadiusForAltitudeKm(altitudeKm) {
    const trueRatio = altitudeKm / EARTH_RADIUS_KM;
    return 1 + trueRatio * ALTITUDE_EXAGGERATION;
}

/** Propagate one satellite record to `date`; returns null if propagation fails. */
function propagate(record, date) {
    const posVel = satellite.propagate(record.satrec, date);
    if (!posVel || !posVel.position) return null;
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    return {
        latRad: geo.latitude,
        lonRad: geo.longitude,
        altitudeKm: geo.height,
    };
}

function buildTrackedSatellite(record, colorIndex) {
    const color = MARKER_COLORS[colorIndex % MARKER_COLORS.length];
    const group = new THREE.Group();
    group.name = `satellite:${record.name}`;

    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.011, 16, 16),
        new THREE.MeshBasicMaterial({ color }),
    );
    group.add(marker);

    const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    group.add(glow);

    const trackGeometry = new THREE.BufferGeometry().setFromPoints(
        new Array(GROUND_TRACK_SAMPLES).fill(0).map(() => new THREE.Vector3()),
    );
    const track = new THREE.Line(
        trackGeometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 }),
    );
    group.add(track);

    let lastTrackRebuildMs = 0;

    function updateTrack(date) {
        const periodMs = record.periodMinutes * 60 * 1000;
        const positions = track.geometry.attributes.position;
        for (let i = 0; i < GROUND_TRACK_SAMPLES; i++) {
            // Centered on "now": half the samples trail behind, half lead ahead.
            const t = (i / (GROUND_TRACK_SAMPLES - 1) - 0.5) * periodMs;
            const sampleDate = new Date(date.getTime() + t);
            const geo = propagate(record, sampleDate);
            if (!geo) continue;
            // Ground track sits just above the surface, not at the
            // (exaggerated) marker altitude — it's a sub-satellite path, not
            // the satellite itself.
            const p = geodeticToVec3(geo.latRad, geo.lonRad, 1.003);
            positions.setXYZ(i, p.x, p.y, p.z);
        }
        positions.needsUpdate = true;
    }

    function update(date) {
        const geo = propagate(record, date);
        if (!geo) {
            group.visible = false;
            return null;
        }
        group.visible = true;
        const r = sceneRadiusForAltitudeKm(geo.altitudeKm);
        const p = geodeticToVec3(geo.latRad, geo.lonRad, r);
        group.position.copy(p);

        if (date.getTime() - lastTrackRebuildMs > 30_000) {
            lastTrackRebuildMs = date.getTime();
            updateTrack(date);
        }

        return {
            name: record.name,
            latDeg: THREE.MathUtils.radToDeg(geo.latRad),
            lonDeg: THREE.MathUtils.radToDeg(geo.lonRad),
            altitudeKm: geo.altitudeKm,
        };
    }

    return { group, update };
}

/**
 * Build the satellite tracking layer. Returns { group, tick(date, isLive),
 * getTrackedInfo() }. `group` should be added as a child of earthSpin, like
 * the lat/lon grid and location pin — satellite ground position is Earth-
 * surface-fixed (via geodetic longitude), so it corotates with the planet.
 */
export function buildSatelliteTracker() {
    const group = new THREE.Group();
    group.name = 'satellites';
    group.visible = false;

    let tracked = [];
    let lastInfo = [];
    let loadAttempted = false;

    async function load() {
        loadAttempted = true;
        const records = await fetchSatelliteRecords();
        // Clear any previous instances (e.g. on refresh).
        for (const t of tracked) group.remove(t.group);
        tracked = records.map((record, i) => buildTrackedSatellite(record, i));
        for (const t of tracked) group.add(t.group);
    }

    function tick(date, isLive) {
        group.visible = isLive && tracked.length > 0;

        if (!loadAttempted) {
            tick._lastRefresh = Date.now();
            load();
            return;
        }
        if (Date.now() - tick._lastRefresh > REFRESH_MS) {
            tick._lastRefresh = Date.now();
            load();
        }

        if (!isLive) return;

        lastInfo = tracked
            .map((t) => t.update(date))
            .filter(Boolean);
    }

    function getTrackedInfo() {
        return lastInfo;
    }

    function getLoadState() {
        if (!loadAttempted) return 'loading';
        return tracked.length > 0 ? 'ok' : 'unavailable';
    }

    return { group, tick, getTrackedInfo, getLoadState };
}
