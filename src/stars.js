// Procedural star field. 5000 points uniformly distributed on a large distant
// sphere. Colors weighted toward white with subtle blue/yellow tints to hint at
// real stellar temperatures. Additive blending so stars look luminous against
// the black background.
//
// Not real Yale Bright Star Catalog positions (would need an asset download).
// Visually convincing for a portfolio piece; can be swapped later.

import * as THREE from 'three';

const STAR_COUNT = 5000;
const STAR_SPHERE_RADIUS = 300;

// Slightly randomized color per star, biased toward pure white with rare
// pale-blue (hotter stars) and pale-yellow (cooler stars) tints.
function pickStarColor(rand) {
    const t = rand();
    if (t < 0.7) return new THREE.Color(0xffffff);
    if (t < 0.85) return new THREE.Color(0xdde6ff); // pale blue
    return new THREE.Color(0xfff2cc); // pale yellow
}

// Uniform random point on a unit sphere via Marsaglia's method.
function randomPointOnSphere(rand) {
    let u, v, s;
    do {
        u = rand() * 2 - 1;
        v = rand() * 2 - 1;
        s = u * u + v * v;
    } while (s >= 1);
    const factor = 2 * Math.sqrt(1 - s);
    return {
        x: u * factor,
        y: v * factor,
        z: 1 - 2 * s,
    };
}

export function buildStars() {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);

    // Deterministic-ish seed so the star pattern is stable across reloads.
    let seed = 42;
    const rand = () => {
        // Cheap LCG — fine for visual variety.
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    for (let i = 0; i < STAR_COUNT; i++) {
        const p = randomPointOnSphere(rand);
        positions[i * 3 + 0] = p.x * STAR_SPHERE_RADIUS;
        positions[i * 3 + 1] = p.y * STAR_SPHERE_RADIUS;
        positions[i * 3 + 2] = p.z * STAR_SPHERE_RADIUS;

        const color = pickStarColor(rand);
        colors[i * 3 + 0] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        // Long tail toward small — few bright stars, many dim.
        const brightness = Math.pow(rand(), 3.5);
        sizes[i] = 0.4 + brightness * 2.2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Custom point material — supports per-star size + color via attributes,
    // renders each point as a soft round dot (not a hard square).
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
                // Soft round dot — falls off toward the edge of gl_PointCoord.
                vec2 c = gl_PointCoord - vec2(0.5);
                float d = length(c);
                if (d > 0.5) discard;
                float alpha = smoothstep(0.5, 0.15, d);
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    return new THREE.Points(geometry, material);
}
