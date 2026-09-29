// Moon surface — what the Moon actually looks like, not just a gray ball.
//
// Three things were wrong with the plain MeshStandardMaterial sphere:
//
//   1. It was never turned. The real Moon is tidally locked (the same face
//      always looks at Earth), but the sphere just sat there with a random
//      side toward you — most of the time the nearly featureless far side.
//      orientMoon() turns the texture's centre (the near side, with the big
//      dark maria that make the "face") toward Earth, north pole up.
//
//   2. Lambert lighting made it look like a ball. A real full Moon is a flat,
//      evenly bright disc with no limb darkening, and it has a razor-sharp
//      terminator. This uses a Lunar-Lambert blend (Lommel–Seeliger-style
//      term + a little Lambert) which gives exactly that.
//
//   3. No relief. Craters only read as craters when the light rakes across
//      them. The colour map has crater rims and floors in it, so a high-pass
//      of its brightness is a decent stand-in for terrain height; it is turned
//      into a per-pixel normal, and it fades out on its own when the Moon is
//      small on screen (mip levels average the detail away — no shimmer).
//
// Plus earthshine: the dark part of a crescent Moon is faintly lit by sunlight
// bouncing off Earth, strongest at new moon (Earth is "full" from the Moon).
//
// Artistic license, same spirit as the rest of the scene: exposure is boosted
// (the real Moon is as dark as worn asphalt) and the relief is exaggerated so
// it reads at the size the Moon has on screen.

import * as THREE from 'three';

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vPosW;
varying float vSinLat;

void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vSinLat = normal.y; // the poles lie on the sphere's local Y axis
    // Direction of increasing longitude (u) at this point, in world space.
    // From SphereGeometry's own parametrisation (x = -cos(phi) sin(theta),
    // z = sin(phi) sin(theta), phi = 2*pi*u) — unlike cross(Y, normal), it stays
    // well-defined at the poles instead of collapsing to NaN there.
    float phi = uv.x * 6.28318531;
    vEastW = normalize(mat3(modelMatrix) * vec3(sin(phi), 0.0, cos(phi)));
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;        // world space, unit, points from the Moon toward the Sun
uniform vec3 uEarthDir;      // world space, unit, points from the Moon toward Earth
uniform float uEarthshine;   // 0..1 — how "full" Earth looks from the Moon
uniform float uExposure;
uniform float uRelief;       // terrain height, as a fraction of the Moon's radius, per unit of brightness
uniform float uLambertMix;   // 0 = pure Lommel–Seeliger (flat disc), 1 = pure Lambert
uniform float uSaturation;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vPosW;
varying float vSinLat;

const float PI = 3.14159265;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Rolls the brightest values off toward 1.0 so ejecta rays glow gently
// instead of blowing out to white and flaring in the bloom pass.
vec3 shoulder(vec3 c) {
    float m = max(max(c.r, c.g), c.b);
    if (m <= 0.7) return c;
    return c * ((0.7 + 0.3 * (1.0 - exp(-(m - 0.7) / 0.3))) / m);
}

// Terrain height at a texture coordinate: brightness with the broad
// maria/highland pattern taken out, leaving crater rims, floors and ejecta.
float terrain(vec2 uv) {
    float fine = luma(texture2D(uMap, uv).rgb);
    float broad = luma(texture2D(uMap, uv, 3.0).rgb);
    return fine - broad;
}

void main() {
    vec3 albedo = texture2D(uMap, vUv).rgb;

    vec3 geoN = normalize(vNormalW);
    vec3 east = normalize(vEastW - geoN * dot(vEastW, geoN));
    vec3 north = cross(geoN, east);

    // Slope of the terrain along east and north, measured across roughly one
    // screen pixel (or one texel when magnified) so it never shimmers.
    vec2 texSize = vec2(textureSize(uMap, 0));
    float stepV = clamp(fwidth(vUv.y), 1.0 / texSize.y, 0.02);
    float stepU = 2.0 * stepV; // the map is 2:1 — one step in u is half the arc of one in v
    float dhdu = (terrain(vUv + vec2(stepU, 0.0)) - terrain(vUv - vec2(stepU, 0.0))) / (2.0 * stepU);
    float dhdv = (terrain(vUv + vec2(0.0, stepV)) - terrain(vUv - vec2(0.0, stepV))) / (2.0 * stepV);

    // uv units → distance across the surface, in Moon radii (1 radius = 1 unit).
    // The map is smeared and streaky toward the poles (it's stretched there),
    // so the relief fades out rather than turning the streaks into washboard.
    float cosLat = sqrt(max(1.0 - vSinLat * vSinLat, 0.0));
    float relief = uRelief * smoothstep(0.28, 0.5, cosLat);
    vec2 slope = relief * vec2(dhdu / (2.0 * PI * max(cosLat, 0.25)), dhdv / PI);
    vec3 N = normalize(geoN - slope.x * east - slope.y * north);

    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = normalize(uSunDir);

    // Peaks and rims catch light a hair past the true terminator, but not the
    // salt-and-pepper speckle raw bump mapping would give there.
    float terminator = smoothstep(-0.05, 0.06, dot(geoN, L));
    float mu0 = max(dot(N, L), 0.0) * terminator; // sunlight incidence (with relief)
    float mu = max(dot(geoN, V), 0.0);            // emission angle (true surface)

    // Lunar-Lambert: Lommel–Seeliger keeps a full Moon flat, Lambert adds form.
    // The LS term climbs toward 2 at a sunlit limb; capped, that stays a soft
    // even brightness instead of a glare.
    float ls = min(2.0 * mu0 / (mu0 + mu + 0.0001), 1.3);
    float lit = mix(ls, mu0, uLambertMix);

    // Slightly punchier, slightly more colourful than the raw map.
    vec3 base = albedo;
    base = mix(vec3(luma(base)), base, uSaturation);

    vec3 color = base * uExposure * lit;

    // Earthshine — blue-white light from Earth on the night side.
    float earthLit = max(dot(N, normalize(uEarthDir)), 0.0);
    color += base * uExposure * 0.06 * uEarthshine * earthLit * vec3(0.62, 0.78, 1.0);

    gl_FragColor = vec4(shoulder(color), 1.0);
}
`;

// Stand-in until the real texture arrives, so the Moon isn't a black disc.
function makePlaceholderTexture() {
    const tex = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255]), 1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/**
 * The Moon's material. Swap the colour map with
 * `material.uniforms.uMap.value = texture` (see textureUpgrade.js).
 */
export function buildMoonMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: makePlaceholderTexture() },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uEarthDir: { value: new THREE.Vector3(-1, 0, 0) },
            uEarthshine: { value: 0 },
            uExposure: { value: 1.55 },
            uRelief: { value: 0.018 },
            uLambertMix: { value: 0.35 },
            uSaturation: { value: 1.25 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
    });
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const SCENE_NORTH = new THREE.Vector3(0, 1, 0); // +Y = ecliptic north (see astronomy.js)

/**
 * Tidal lock: turn the Moon so the centre of its texture (0° longitude — the
 * middle of the near side) faces Earth, with lunar north toward scene north.
 * `moonDirection` is the unit vector from Earth to the Moon, in scene space.
 *
 * (The real lunar axis is tilted 1.5° to the ecliptic and the disc librates
 * a few degrees — both ignored; they'd be invisible at this scale.)
 */
export function orientMoon(moon, moonDirection) {
    _x.set(-moonDirection.x, -moonDirection.y, -moonDirection.z).normalize();
    _y.copy(SCENE_NORTH).addScaledVector(_x, -SCENE_NORTH.dot(_x)).normalize();
    _z.crossVectors(_x, _y);
    moon.quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));
}

/**
 * Per-update refresh of the lighting inputs: orientation plus the Sun and
 * Earth directions the shader lights with. Cheap enough to call every frame.
 *
 * @param moonDirection unit vector Earth → Moon (scene space)
 * @param sunDirection  unit vector Earth → Sun  (scene space)
 */
export function updateMoonSurface(moon, material, moonDirection, sunDirection) {
    orientMoon(moon, moonDirection);

    const u = material.uniforms;
    u.uSunDir.value.set(sunDirection.x, sunDirection.y, sunDirection.z).normalize();
    u.uEarthDir.value.set(-moonDirection.x, -moonDirection.y, -moonDirection.z).normalize();

    // Earth seen from the Moon is "full" when the Moon is new (Sun and Moon on
    // the same side of Earth) and "new" when the Moon is full:
    // illuminated fraction = (1 + cos(elongation)) / 2.
    const cosElongation =
        sunDirection.x * moonDirection.x + sunDirection.y * moonDirection.y + sunDirection.z * moonDirection.z;
    // Squared: earthshine is obvious on a thin crescent and all but invisible by
    // first quarter, as in the real sky.
    const earthFull = 0.5 * (1 + cosElongation);
    u.uEarthshine.value = earthFull * earthFull;
}
