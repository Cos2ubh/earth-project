// Cloud layer — a transparent sphere slightly outside Earth's surface, rendered
// with a custom shader that:
//   - Uses the cloud texture's luminance as alpha (white pixels = opaque clouds,
//     black = clear sky)
//   - Fades clouds on the night side so we don't get a "gray fog" over the
//     city lights (real clouds ARE dark at night, but visually it reads poorly)
//   - Uses the same UV offset (+0.25) as the Earth shader so clouds line up
//     with the continents underneath
//
// Cloud sphere sits just above Earth (radius 1.008 vs Earth's 1.0). Rotates
// slowly and independently — real clouds don't co-rotate with the surface,
// they drift with the atmospheric circulation at ~100 km/h.

import * as THREE from 'three';

const CLOUD_RADIUS = 1.008;

const VERTEX_SHADER = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormalLocal;

    void main() {
        vUv = uv;
        vNormalLocal = normalize(normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform sampler2D uCloudTexture;
    uniform vec3 uSunDirectionLocal;
    uniform float uOpacity;

    varying vec2 vUv;
    varying vec3 vNormalLocal;

    void main() {
        // Same UV offset as the Earth shader so clouds line up with continents.
        vec2 sampleUv = vec2(fract(vUv.x + 0.25), vUv.y);

        // Cloud texture is greyscale (clouds white, gaps black); take one channel.
        float cloudDensity = texture2D(uCloudTexture, sampleUv).r;

        // Fade on the night side. Full opacity where sun hits directly,
        // ~10% at the terminator, fully invisible on the dark side.
        float lightIntensity = dot(vNormalLocal, uSunDirectionLocal);
        float dayFade = smoothstep(-0.1, 0.35, lightIntensity);

        // Slight color tint so clouds read as bright rather than pure white.
        vec3 cloudColor = vec3(1.0, 1.0, 1.0);

        gl_FragColor = vec4(cloudColor, cloudDensity * dayFade * uOpacity);
    }
`;

/**
 * Build the cloud layer. Returns { mesh, setSunDirection(vec3), tick(dt) }.
 *   setSunDirection — call every frame with the WORLD-space sun direction;
 *     the material transforms into local frame internally.
 *   tick — call every frame with elapsed seconds; advances the cloud layer's
 *     independent slow rotation.
 */
export async function buildClouds() {
    const loader = new THREE.TextureLoader();
    const cloudTexture = await loader.loadAsync('/textures/earth_clouds_2k.jpg');
    cloudTexture.colorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.SphereGeometry(CLOUD_RADIUS, 96, 96);
    const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
            uCloudTexture: { value: cloudTexture },
            uSunDirectionLocal: { value: new THREE.Vector3(1, 0, 0) },
            uOpacity: { value: 0.85 },
        },
        transparent: true,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Scratch objects reused per frame.
    const scratchWorldSun = new THREE.Vector3();
    const scratchInvMatrix = new THREE.Matrix4();

    function setSunDirection(worldSunDir) {
        scratchWorldSun.set(worldSunDir.x, worldSunDir.y, worldSunDir.z);
        mesh.updateMatrixWorld();
        scratchInvMatrix.copy(mesh.matrixWorld).invert();
        scratchWorldSun.transformDirection(scratchInvMatrix);
        material.uniforms.uSunDirectionLocal.value.copy(scratchWorldSun);
    }

    // Independent rotation — clouds drift slowly relative to the surface.
    // 1 full rotation per real day is exaggerated (real winds are much slower)
    // but reads as gentle motion, which is what we want visually.
    const CLOUD_ROTATION_RATE = (2 * Math.PI) / 86400; // rad/sec
    function tick(dtSec) {
        mesh.rotation.y += CLOUD_ROTATION_RATE * dtSec;
    }

    return { mesh, setSunDirection, tick };
}
