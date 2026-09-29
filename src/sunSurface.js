// The Sun: a boiling, spotted, limb-darkened star instead of a flat yellow disc.
//
// Two pieces, both procedural (no textures, so it stays sharp at any zoom):
//
//   photosphere: the visible surface. Three layers of animated cellular noise
//     give the granulation (bright convection cells with dark lanes between
//     them, from huge slow "supergranules" down to fine grain that fades out
//     when it would shimmer at the current size), sunspots with a dark umbra
//     and a streaky penumbra, bright faculae around them, and limb darkening:
//     the edge of the disc is dimmer and redder than the middle, which is
//     what makes a sphere of light read as a *sphere*.
//
//   corona: a camera-facing additive glow behind the disc, made of a thin red
//     chromosphere fringe at the limb, a hot inner halo, and faint streamers.
//     Its inner edge is bright enough to catch the bloom pass.
//
// What is real and what is stylised: the granulation is stylised (real granules
// are ~1,000 km, about 1,400 across the disc, and live for minutes), and so is
// the sunspot pattern: spots are pseudo-random per simulated date, they grow
// and fade over weeks like real groups do, and they are carried around the Sun
// with the real *differential rotation* law (the equator turns in ~25 days,
// high latitudes slower), but they are not NOAA's actual sunspot data.
// Scrub time and you will watch them drift across the disc at the right pace.

import * as THREE from 'three';

const SPOT_SLOTS = 6;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 86400000;
const DEG = Math.PI / 180;

// Sidereal rotation rate at solar latitude φ (Snodgrass & Ulrich 1990), °/day.
function rotationRateDegPerDay(latRad) {
    const s2 = Math.sin(latRad) ** 2;
    return 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
}

// Deterministic 0..1 hash so the same simulated date always shows the same Sun.
function hash01(a, b) {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * Where the pseudo-random sunspot groups are at a given simulated time.
 * Writes (x, y, z, angularRadius) into `out` (one Vector4 per slot).
 * Direction is in scene space, with +Y the Sun's rotation axis and longitude
 * increasing the same way the scene's ecliptic longitude does.
 */
function computeSpots(simMs, out) {
    const days = (simMs - J2000_MS) / DAY_MS;
    for (let i = 0; i < SPOT_SLOTS; i++) {
        const period = 34 + i * 9.5; // each slot's groups live a few weeks
        const clock = days / period + hash01(i, 0.5) * 17;
        const cycle = Math.floor(clock);
        const age = clock - cycle; // 0 → newborn, 1 → gone

        const r1 = hash01(cycle + 1, i + 3.1);
        const r2 = hash01(cycle + 7, i + 9.7);
        const r3 = hash01(cycle + 13, i + 21.3);

        const hemisphere = r1 < 0.5 ? -1 : 1;
        const lat = hemisphere * (6 + 22 * r2) * DEG; // activity belts, 6° to 28°
        const lon0 = r3 * Math.PI * 2;

        // Grows quickly, lingers, decays, and is absent at both ends.
        const envelope = Math.pow(Math.sin(Math.PI * age), 0.4);
        const size = (0.055 + 0.11 * hash01(cycle + 19, i + 5.3)) * envelope;

        const lon = lon0 + rotationRateDegPerDay(lat) * DEG * days;
        const cosLat = Math.cos(lat);
        out[i].set(cosLat * Math.cos(lon), Math.sin(lat), cosLat * Math.sin(lon), size);
    }
}

// ---------------------------------------------------------------------------
// Photosphere shader
// ---------------------------------------------------------------------------

const DISC_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;

void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const DISC_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec4 uSpots[${SPOT_SLOTS}];
// Loop bounds are uniforms on purpose: constant bounds get unrolled, and on
// Windows (ANGLE → Direct3D) a hundred unrolled noise cells can stall shader
// compilation for seconds. Real loops compile instantly and cost the same.
uniform int uCellSpan;   // 1 → search a 3×3×3 block of cells
uniform int uSpotCount;

varying vec3 vNormalW;
varying vec3 vPosW;

// --- hashing / noise (sin-free, stable on mobile GPUs) ----------------------
vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
            mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
            mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
        f.z);
}

float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        sum += amp * valueNoise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        amp *= 0.5;
    }
    return sum / 0.875; // the 3 octaves sum to at most 0.875, so this keeps the 0..1 range
}

// Cellular noise with feature points that wander over time, so cells slowly
// swell, shrink and re-form. Returns (distance to nearest point, distance to
// second nearest, random value of the nearest cell).
vec3 cells(vec3 p, float t) {
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float f1 = 9.0;
    float f2 = 9.0;
    float id = 0.0;
    for (int k = -uCellSpan; k <= uCellSpan; k++) {
        for (int j = -uCellSpan; j <= uCellSpan; j++) {
            for (int i = -uCellSpan; i <= uCellSpan; i++) {
                vec3 g = vec3(float(i), float(j), float(k));
                vec3 h = hash33(ip + g);
                // Feature point drifting on a smoothed triangle wave (three sin()s
                // per neighbour, times a hundred neighbours, was the shader's cost).
                vec3 wave = abs(fract(t * 0.15915494 + h) * 2.0 - 1.0);
                wave = wave * wave * (3.0 - 2.0 * wave);
                vec3 o = 0.5 + 0.42 * (2.0 * wave - 1.0);
                vec3 r = g + o - fp;
                float d = dot(r, r);
                if (d < f1) {
                    f2 = f1;
                    f1 = d;
                    id = h.x;
                } else if (d < f2) {
                    f2 = d;
                }
            }
        }
    }
    return vec3(sqrt(f1), sqrt(f2), id);
}

// One granulation layer: rounded bright cells with thin dark lanes between
// them. Returns brightness around 0 (mean-centred, roughly -0.5..+0.5).
// 'detail' (0..1) is how much of it survives at the current on-screen size.
float granulation(vec3 p, float scale, float speed, float laneWidth, float detail) {
    vec3 c = cells(p * scale, uTime * speed);
    float dome = 1.0 - smoothstep(0.0, 0.85, c.x);                // hot in the middle of a cell
    float lane = smoothstep(0.0, laneWidth, c.y - c.x);           // 0 exactly on a border
    float bright = 0.80 + 0.40 * c.z;                             // some cells run hotter
    float value = (0.40 + 0.60 * dome) * mix(0.66, 1.0, lane) * bright;
    return (value - 0.58) * detail;
}

// Temperature ramp: dark red lane → orange → yellow → hot white-yellow.
vec3 ramp(float t) {
    const vec3 c0 = vec3(0.30, 0.045, 0.005);
    const vec3 c1 = vec3(0.92, 0.33, 0.045);
    const vec3 c2 = vec3(1.12, 0.66, 0.16);
    const vec3 c3 = vec3(1.24, 0.94, 0.46);
    const vec3 c4 = vec3(1.36, 1.14, 0.78);
    t = clamp(t, 0.0, 1.2);
    if (t < 0.3) return mix(c0, c1, t / 0.3);
    if (t < 0.6) return mix(c1, c2, (t - 0.3) / 0.3);
    if (t < 0.9) return mix(c2, c3, (t - 0.6) / 0.3);
    return mix(c3, c4, (t - 0.9) / 0.3);
}

void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float mu = clamp(dot(N, V), 0.0, 1.0);

    // Direction on the Sun's surface. The mesh never rotates, so the noise is
    // fixed to the sphere and the camera is free to move around it.
    vec3 p = N;

    // How many pixels one unit of p spans → fade out detail that would alias.
    float pixelStep = length(fwidth(p));
    float detailMain = 1.0 - smoothstep(0.16, 0.55, pixelStep * 15.0);
    float detailFine = 1.0 - smoothstep(0.16, 0.55, pixelStep * 42.0);

    // Warp the cell lattice with slow noise so cell edges curve like plasma
    // instead of running in straight polygon lines.
    vec3 warp = vec3(
        fbm(p * 2.6 + vec3(0.0, uTime * 0.012, 0.0)),
        fbm(p * 2.6 + vec3(11.7, 0.0, uTime * 0.012)),
        fbm(p * 2.6 + vec3(23.1, uTime * 0.012, 5.0))
    ) - 0.5;
    vec3 pw = p + warp * 0.34;

    float t = 0.70;
    t += granulation(pw, 4.4, 0.10, 0.35, 1.0) * 0.34;       // supergranules: big, slow
    // Layers that would be sub-pixel are skipped outright: most of the time the
    // Sun is small on screen, and this is where the cost is.
    if (detailMain > 0.02) t += granulation(pw, 15.0, 0.42, 0.30, detailMain) * 0.46; // granules
    if (detailFine > 0.02) t += granulation(pw + 3.7, 41.0, 0.70, 0.35, detailFine) * 0.22; // fine grain

    // Slow, large-scale mottling so the disc is never uniform.
    t += (fbm(p * 3.0 + vec3(0.0, uTime * 0.01, 0.0)) - 0.5) * 0.15;

    // --- sunspots ---
    float spotDark = 1.0;
    float faculae = 0.0;
    for (int i = 0; i < uSpotCount; i++) {
        vec4 s = uSpots[i];
        if (s.w < 0.004) continue;
        vec3 c = s.xyz;
        float cosAng = dot(p, c);
        if (cosAng < cos(min(s.w * 3.6, 3.0))) continue; // beyond the faculae, skip the noise work
        float ang = acos(clamp(cosAng, -1.0, 1.0));

        // Ragged edges and radial filaments in the penumbra.
        float ragged = (fbm(p * 26.0 + float(i) * 7.3) - 0.5) * 0.55 * s.w;
        float d = ang + ragged;
        vec3 tangent = normalize(p - c * dot(p, c) + 1e-5);
        vec3 ref = normalize(cross(c, vec3(0.0, 1.0, 0.0)) + 1e-4);
        float around = atan(dot(tangent, cross(c, ref)), dot(tangent, ref));
        float filaments = 0.72 + 0.28 * valueNoise(vec3(around * 3.2, d * 55.0, float(i) * 3.7));

        float penumbra = 1.0 - smoothstep(s.w * 0.52, s.w, d);
        float umbra = 1.0 - smoothstep(s.w * 0.30, s.w * 0.55, d);
        spotDark *= 1.0 - 0.62 * penumbra * filaments - 0.40 * umbra;
        faculae += (1.0 - smoothstep(s.w * 1.3, s.w * 3.4, ang)) * (1.0 - penumbra);
    }
    t *= max(spotDark, 0.03);

    // Faculae are brighter toward the limb, where you see them at an angle.
    t += faculae * 0.11 * (1.0 - mu * 0.6);

    // --- limb darkening: dimmer AND redder toward the edge ---
    float edge = 1.0 - mu;
    t *= mix(1.0, 0.42, pow(edge, 1.15));
    vec3 color = ramp(t);
    color *= vec3(1.0) - vec3(0.06, 0.20, 0.40) * pow(edge, 1.5);

    gl_FragColor = vec4(color, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Corona shader (camera-facing quad, additive)
// ---------------------------------------------------------------------------

const CORONA_VERTEX = /* glsl */ `
uniform float uHalfSize;
varying vec2 vP;

void main() {
    vP = position.xy; // -1..1 across the quad
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uHalfSize;
    gl_Position = projectionMatrix * mv;
    // Park the glow at the far plane of the depth buffer, in front of nothing
    // but behind everything: the Sun's disc, Earth and Moon all hide it where
    // they should, with no z-fighting. (Pushing it back in *view* space instead
    // shifts it sideways by perspective and leaves a black crescent.)
    gl_Position.z = gl_Position.w * 0.99999;
}
`;

const CORONA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uCore;     // solar radius as a fraction of the quad's half size
varying vec2 vP;

void main() {
    float r = length(vP) / uCore; // distance from the centre in solar radii
    if (r < 0.9 || r > 3.6) discard;
    float ang = atan(vP.y, vP.x);

    // Streamers: a few broad, slowly drifting lobes.
    float streamers = 0.55
        + 0.22 * sin(ang * 3.0 + uTime * 0.045 + 1.3)
        + 0.14 * sin(ang * 5.0 - uTime * 0.070 + 4.1)
        + 0.09 * sin(ang * 9.0 + uTime * 0.030 + 2.2);

    float inner = exp(-(r - 1.0) * 6.0);                 // hot halo hugging the limb
    float outer = pow(1.0 / r, 3.4) * streamers;         // faint extended corona
    float chromosphere = 1.0 - smoothstep(1.0, 1.05, r); // thin red fringe

    vec3 color = vec3(1.00, 0.50, 0.14) * inner * 0.55
               + vec3(1.00, 0.80, 0.55) * outer * 0.34
               + vec3(1.00, 0.20, 0.08) * chromosphere * 0.45;

    float fade = 1.0 - smoothstep(2.2, 3.6, r);
    gl_FragColor = vec4(color * fade, 1.0);
}
`;

/**
 * @param radius  the Sun marker's radius in scene units
 * @returns {{ group: THREE.Group, disc: THREE.Mesh, corona: THREE.Mesh,
 *             update: (timeSec: number, simMs: number) => void }}
 *   `group` is what you position. Call `update` once per frame: `timeSec` drives
 *   the boiling surface (real time), `simMs` the sunspots (simulated time).
 */
export function buildSun(radius = 0.35) {
    const group = new THREE.Group();

    const spots = Array.from({ length: SPOT_SLOTS }, () => new THREE.Vector4());

    const discMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uSpots: { value: spots },
            uCellSpan: { value: 1 },
            uSpotCount: { value: SPOT_SLOTS },
        },
        vertexShader: DISC_VERTEX,
        fragmentShader: DISC_FRAGMENT,
    });
    const disc = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), discMaterial);
    group.add(disc);

    const halfSize = radius * 3.6;
    const coronaMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uHalfSize: { value: halfSize },
            uCore: { value: radius / halfSize },
        },
        vertexShader: CORONA_VERTEX,
        fragmentShader: CORONA_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMaterial);
    corona.frustumCulled = false; // the vertex shader moves it; its bounds are meaningless
    corona.renderOrder = 2;
    group.add(corona);

    computeSpots(Date.now(), spots);

    return {
        group,
        disc,
        corona,
        update(timeSec, simMs) {
            discMaterial.uniforms.uTime.value = timeSec;
            coronaMaterial.uniforms.uTime.value = timeSec;
            computeSpots(simMs, spots);
        },
    };
}
