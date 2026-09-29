// Atmosphere Fresnel shader: an outer transparent sphere slightly larger
// than Earth that renders a soft blue glow around Earth's rim. The Fresnel
// effect uses dot(viewDirection, normal): near 0 at glancing angles (rim),
// near 1 head-on (center), producing the "atmosphere thicker at the edge"
// look photographs from orbit have.
//
// The atmosphere shell is rendered with BackSide so we see the inside surface;
// combined with additive blending, this produces a bright halo around Earth's
// silhouette without darkening the sphere itself.

import * as THREE from 'three';

const ATMOSPHERE_RADIUS = 1.03;
const ATMOSPHERE_COLOR = new THREE.Color(0x4a9eff);

export function buildAtmosphere() {
    const geometry = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 96);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uAtmosphereColor: { value: ATMOSPHERE_COLOR },
            uIntensity: { value: 1.1 },
            uPower: { value: 3.5 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vViewPosition;

            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uAtmosphereColor;
            uniform float uIntensity;
            uniform float uPower;

            varying vec3 vNormal;
            varying vec3 vViewPosition;

            void main() {
                vec3 viewDir = normalize(vViewPosition);
                // BackSide rendering flips the normal, so we invert to get
                // the outward-facing surface normal.
                vec3 n = -normalize(vNormal);
                float rim = pow(1.0 - max(dot(viewDir, n), 0.0), uPower);
                gl_FragColor = vec4(uAtmosphereColor * rim * uIntensity, rim);
            }
        `,
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    return new THREE.Mesh(geometry, material);
}
