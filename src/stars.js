// Real star field from the Yale Bright Star Catalog (~9,000 stars, all visible
// naked-eye stars mag ≤ ~6.5). Positions are J2000 equatorial (RA/Dec), which
// we convert into the scene's ecliptic frame — the same coordinate system Earth
// and Sun live in — so constellations sit in the sky where they actually do.
//
// Size = f(magnitude), color = f(spectral type) so hot O/B stars read blue,
// cool M stars read red — the same way real stars look in a long exposure.

import * as THREE from 'three';

const STAR_SPHERE_RADIUS = 300;
const OBLIQUITY_DEG = 23.4381;

// Spectral class → approximate color. Maps the first letter of the spectral
// type (O, B, A, F, G, K, M) to a representative RGB color.
const SPECTRAL_COLORS = {
    O: new THREE.Color(0x9bb0ff), // blue
    B: new THREE.Color(0xaabfff),
    A: new THREE.Color(0xcad7ff), // white
    F: new THREE.Color(0xf8f7ff), // yellow-white
    G: new THREE.Color(0xfff4ea), // yellow (Sun-like)
    K: new THREE.Color(0xffd2a1), // orange
    M: new THREE.Color(0xffcc6f), // red-orange
};
const DEFAULT_COLOR = new THREE.Color(0xffffff);

// "HH:MM:SS.SS" → hours (float)
function parseRaHours(s) {
    const [h, m, sec] = s.split(':').map(parseFloat);
    return h + m / 60 + sec / 3600;
}

// "±DD:MM:SS.SS" → degrees (signed float)
function parseDecDegrees(s) {
    const sign = s.trim()[0] === '-' ? -1 : 1;
    const cleaned = s.replace(/^[+-]/, '');
    const [d, m, sec] = cleaned.split(':').map(parseFloat);
    return sign * (d + m / 60 + sec / 3600);
}

// Extract first alphabetic character from spectral type strings like "K0III",
// "gG9", "A1Vn", "M1.5V" — used for color lookup.
function firstSpectralLetter(spectralType) {
    if (!spectralType) return null;
    const m = spectralType.match(/[OBAFGKM]/i);
    return m ? m[0].toUpperCase() : null;
}

/**
 * Convert equatorial (RA, Dec) unit vector → scene ecliptic frame:
 *   scene +Y = ecliptic north
 *   scene +X = vernal equinox
 *   scene +Z = 90° east on ecliptic plane
 */
function equatorialToScene(raRad, decDeg, radius) {
    const decRad = decDeg * Math.PI / 180;
    const cosDec = Math.cos(decRad);
    // J2000 equatorial cartesian
    const xEq = cosDec * Math.cos(raRad);
    const yEq = cosDec * Math.sin(raRad);
    const zEq = Math.sin(decRad);
    // Rotate around +X by -obliquity, then swap Y↔Z to match scene convention.
    const obl = OBLIQUITY_DEG * Math.PI / 180;
    const cosO = Math.cos(obl);
    const sinO = Math.sin(obl);
    const yEcl = yEq * cosO + zEq * sinO;
    const zEcl = -yEq * sinO + zEq * cosO;
    // Scene axes: our +Y = ecliptic north (was zEcl above); our +Z = perpendicular.
    return {
        x: xEq * radius,
        y: zEcl * radius,
        z: yEcl * radius,
    };
}

/**
 * Load BSC JSON, build a Points geometry with real positions/sizes/colors.
 */
export async function buildStars() {
    const response = await fetch('/data/bsc.json');
    const stars = await response.json();

    // Filter out stars we can't place (missing RA/Dec) and dim-beyond-plot stars.
    const usable = stars.filter((s) => {
        if (!s.RA || !s.DEC) return false;
        const mag = parseFloat(s.MAG);
        return Number.isFinite(mag) && mag <= 7.5;
    });

    const positions = new Float32Array(usable.length * 3);
    const colors = new Float32Array(usable.length * 3);
    const sizes = new Float32Array(usable.length);

    for (let i = 0; i < usable.length; i++) {
        const s = usable[i];
        const raRad = parseRaHours(s.RA) * 15 * Math.PI / 180;
        const decDeg = parseDecDegrees(s.DEC);
        const mag = parseFloat(s.MAG);

        const pos = equatorialToScene(raRad, decDeg, STAR_SPHERE_RADIUS);
        positions[i * 3 + 0] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;

        const letter = firstSpectralLetter(s['Title HD']);
        const color = (letter && SPECTRAL_COLORS[letter]) || DEFAULT_COLOR;
        colors[i * 3 + 0] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        // Size: brighter stars (lower mag) get bigger points, on a curve.
        // Vega (mag 0) → ~3.2 px, mag 3 → ~1.4 px, mag 6.5 → ~0.3 px.
        const brightness = Math.max(0, 6.5 - mag);
        sizes[i] = 0.3 + Math.pow(brightness / 6.5, 1.4) * 3.0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        },
        vertexShader: /* glsl */ `
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            uniform float uPixelRatio;

            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = size * uPixelRatio;
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vColor;

            void main() {
                vec2 c = gl_PointCoord - vec2(0.5);
                float d = length(c);
                if (d > 0.5) discard;
                float alpha = smoothstep(0.5, 0.05, d);
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    console.log(`Star field loaded: ${usable.length} stars from Yale BSC.`);
    return new THREE.Points(geometry, material);
}
