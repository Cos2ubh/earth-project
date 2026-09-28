// Aurora — a stylized green/magenta glow band near each pole, sized and
// brightened by the real-time planetary Kp geomagnetic index from NOAA's
// Space Weather Prediction Center. Higher Kp (more geomagnetic disturbance)
// pushes the auroral oval equatorward and brightens it, same as a real
// aurora forecast.
//
// Honesty note (same spirit as meteorShowers.js): the oval-boundary-by-Kp
// mapping below is a coarse, widely-cited rule of thumb (roughly what
// NOAA's OVATION-lite public guidance implies), not a magnetospheric model.
// It's tuned for "does the sky look active tonight," not auroral forecasting.
// The band also ignores the ~11° offset between the geomagnetic and
// geographic poles — negligible at this stylized scale.
//
// Data fetch: NOAA's planetary Kp JSON is public, unauthenticated, and
// CORS-enabled — fits the project's "no server, no API keys" rule the same
// way historicalTexture.js's NASA GIBS fetch does. If the fetch fails
// (offline, blocked), the effect falls back to a quiet default (Kp 2) rather
// than disappearing or throwing — a stale-but-plausible sky beats a broken one.

import * as THREE from 'three';

const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const REFRESH_MS = 10 * 60 * 1000; // NOAA updates this feed roughly every 3h; 10min is plenty
const FETCH_TIMEOUT_MS = 10_000;
const FALLBACK_KP = 2;

// Equatorward boundary of the visible auroral oval, in geomagnetic latitude,
// by Kp (0-9). Interpolated linearly between entries.
const OVAL_BOUNDARY_LAT_BY_KP = [67, 65, 63, 61, 58, 55, 52, 48, 44, 40];

const KP_LEVELS = [
    { max: 3.99, label: 'Quiet' },
    { max: 4.99, label: 'Active' },
    { max: 5.99, label: 'Minor storm (G1)' },
    { max: 6.99, label: 'Moderate storm (G2)' },
    { max: 7.99, label: 'Strong storm (G3)' },
    { max: 8.99, label: 'Severe storm (G4)' },
    { max: Infinity, label: 'Extreme storm (G5)' },
];

export function describeKp(kp) {
    return KP_LEVELS.find((l) => kp <= l.max).label;
}

function boundaryLatForKp(kp) {
    const clamped = THREE.MathUtils.clamp(kp, 0, 9);
    const lo = Math.floor(clamped);
    const hi = Math.min(lo + 1, 9);
    const frac = clamped - lo;
    return THREE.MathUtils.lerp(OVAL_BOUNDARY_LAT_BY_KP[lo], OVAL_BOUNDARY_LAT_BY_KP[hi], frac);
}

/**
 * Fetch the current planetary Kp index. Resolves to a number 0-9, or
 * FALLBACK_KP on any failure (network, timeout, malformed response) — this
 * is live-decoration data, not something worth surfacing an error UI for.
 */
export async function fetchCurrentKp() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(KP_URL, { signal: controller.signal });
        if (!res.ok) throw new Error(`NOAA Kp fetch failed: ${res.status}`);
        const rows = await res.json();
        // rows[0] is the header; each data row is [time_tag, Kp, a_running, station_count].
        const last = rows[rows.length - 1];
        const kp = parseFloat(last[1]);
        if (Number.isNaN(kp)) throw new Error('NOAA Kp response malformed');
        return kp;
    } catch {
        return FALLBACK_KP;
    } finally {
        clearTimeout(timer);
    }
}

// Colatitude range each band's geometry spans (generous — the shader masks
// the actual visible band within it so Kp changes never need a rebuild).
const BAND_COLAT_MIN_DEG = 15; // latitude 75°
const BAND_COLAT_MAX_DEG = 60; // latitude 30°
const BAND_RADIUS = 1.016; // just above the cloud layer (1.008), below atmosphere (1.03)

function buildBandMesh(hemisphere) {
    const thetaStart = THREE.MathUtils.degToRad(BAND_COLAT_MIN_DEG);
    const thetaLength = THREE.MathUtils.degToRad(BAND_COLAT_MAX_DEG - BAND_COLAT_MIN_DEG);
    const geometry = hemisphere === 'south'
        ? new THREE.SphereGeometry(BAND_RADIUS, 128, 48, 0, Math.PI * 2, Math.PI - thetaStart - thetaLength, thetaLength)
        : new THREE.SphereGeometry(BAND_RADIUS, 128, 48, 0, Math.PI * 2, thetaStart, thetaLength);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uEdgeV: { value: 0.4 },
            uBandWidth: { value: 0.1 },
            uIntensity: { value: 0.5 },
            uFlip: { value: hemisphere === 'south' ? 1.0 : 0.0 },
        },
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uEdgeV;
            uniform float uBandWidth;
            uniform float uIntensity;
            uniform float uFlip;
            varying vec2 vUv;

            void main() {
                // South band's geometry is built mirrored, but sphere UV.v
                // still runs pole-to-equator the same way as north once
                // uFlip corrects the sense — keeps one shared shader.
                float v = mix(vUv.y, 1.0 - vUv.y, uFlip);

                float inner = uEdgeV - uBandWidth;
                float outer = uEdgeV + uBandWidth;
                float band = smoothstep(inner, mix(inner, uEdgeV, 0.4), v)
                           * (1.0 - smoothstep(uEdgeV, outer, v));

                // Curtain-like shimmer: a few overlapping sine waves along
                // longitude, drifting slowly over time.
                float shimmer = 0.55
                    + 0.25 * sin(vUv.x * 40.0 + uTime * 0.6)
                    + 0.20 * sin(vUv.x * 97.0 - uTime * 0.9 + v * 12.0);
                shimmer = clamp(shimmer, 0.15, 1.0);

                // Green dominates the lower (equatorward) edge; a magenta
                // fringe creeps in toward the poleward inner edge, echoing
                // real high-altitude oxygen/nitrogen emission layering.
                vec3 green = vec3(0.25, 1.0, 0.55);
                vec3 magenta = vec3(0.85, 0.25, 0.95);
                float fringe = smoothstep(inner, uEdgeV, v);
                vec3 color = mix(magenta, green, fringe);

                float alpha = band * shimmer * uIntensity;
                gl_FragColor = vec4(color * alpha * 1.6, alpha);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    return new THREE.Mesh(geometry, material);
}

/**
 * Build the aurora effect: two polar bands plus live NOAA Kp polling.
 * Returns { group, tick(dtSec), getState() }. `group` should be added as a
 * child of earthSpin (like the lat/lon grid) so it corotates with the
 * surface — the auroral oval is fixed to the geomagnetic pole, which turns
 * with the planet, not with the stars.
 */
export function buildAurora() {
    const group = new THREE.Group();
    group.name = 'aurora';

    const north = buildBandMesh('north');
    const south = buildBandMesh('south');
    group.add(north, south);

    let currentKp = FALLBACK_KP;
    let clockMs = 0;
    let msUntilRefresh = 0; // fetch immediately on first tick

    function applyKp(kp) {
        currentKp = kp;
        const edgeLat = boundaryLatForKp(kp);
        const edgeV = (90 - edgeLat - BAND_COLAT_MIN_DEG) / (BAND_COLAT_MAX_DEG - BAND_COLAT_MIN_DEG);
        const clampedEdgeV = THREE.MathUtils.clamp(edgeV, 0.05, 0.95);
        const bandWidth = THREE.MathUtils.lerp(0.05, 0.2, THREE.MathUtils.clamp(kp / 9, 0, 1));
        const intensity = THREE.MathUtils.lerp(0.35, 1.4, THREE.MathUtils.clamp(kp / 9, 0, 1));

        for (const mesh of [north, south]) {
            mesh.material.uniforms.uEdgeV.value = clampedEdgeV;
            mesh.material.uniforms.uBandWidth.value = bandWidth;
            mesh.material.uniforms.uIntensity.value = intensity;
        }
    }

    async function refreshKp() {
        const kp = await fetchCurrentKp();
        applyKp(kp);
    }

    applyKp(FALLBACK_KP); // sane visuals before the first fetch resolves

    function tick(dtSec) {
        clockMs += dtSec * 1000;
        north.material.uniforms.uTime.value = clockMs / 1000;
        south.material.uniforms.uTime.value = clockMs / 1000;

        msUntilRefresh -= dtSec * 1000;
        if (msUntilRefresh <= 0) {
            msUntilRefresh = REFRESH_MS;
            refreshKp();
        }
    }

    function getState() {
        return { kp: currentKp, label: describeKp(currentKp) };
    }

    return { group, tick, getState };
}
