// Earth material — custom ShaderMaterial that blends day/night textures based on
// the dot product between the surface normal and the Sun direction (both in the
// mesh's LOCAL frame).
//
// Why local frame? The Earth mesh has textures baked to its own coordinate
// system. As earthSpin rotates and earthGroup tilts, the world Sun direction
// changes relative to the mesh's own +X/+Y/+Z. We transform the world Sun
// direction into the mesh's local frame every frame and pass it as a uniform.
//
// UV convention:
//   Three.js SphereGeometry places u=0.25 at +Z (which is our prime meridian).
//   Standard equirectangular Earth textures put prime meridian at u=0.5.
//   So we shift the sample UV by +0.25 in the shader.

import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormalLocal;

    void main() {
        vUv = uv;
        vNormalLocal = normalize(normal); // local-space normal
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform sampler2D uDayTexture;
    uniform sampler2D uNightTexture;
    uniform vec3 uSunDirectionLocal;
    uniform float uNightBoost;

    varying vec2 vUv;
    varying vec3 vNormalLocal;

    void main() {
        // Shift UV so prime meridian lines up with texture center (u=0.5).
        vec2 sampleUv = vec2(fract(vUv.x + 0.25), vUv.y);

        vec3 dayColor   = texture2D(uDayTexture,   sampleUv).rgb;
        vec3 nightColor = texture2D(uNightTexture, sampleUv).rgb * uNightBoost;

        // Lighting: dot product of surface normal and sun direction.
        // Both are unit vectors in the mesh's local frame.
        float lightIntensity = dot(vNormalLocal, uSunDirectionLocal);

        // Smoothstep across the terminator for a soft transition
        // (~11.5° of arc in either direction — close to real atmospheric twilight).
        float dayWeight = smoothstep(-0.2, 0.2, lightIntensity);

        vec3 color = mix(nightColor, dayColor, dayWeight);
        gl_FragColor = vec4(color, 1.0);
    }
`;

/**
 * Build the Earth shader material. Returns { material, setSunDirection(vec3) }.
 * Call setSunDirection every frame with the world-space Sun direction — the
 * material converts it into the mesh's local frame internally using the
 * provided mesh reference.
 */
export async function buildEarthMaterial(mesh) {
    const loader = new THREE.TextureLoader();

    const [dayTexture, nightTexture] = await Promise.all([
        loader.loadAsync('/textures/earth_day_2k.jpg'),
        loader.loadAsync('/textures/earth_night_2k.jpg'),
    ]);

    // Standard PBR / equirectangular convention.
    dayTexture.colorSpace = THREE.SRGBColorSpace;
    nightTexture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
            uDayTexture: { value: dayTexture },
            uNightTexture: { value: nightTexture },
            uSunDirectionLocal: { value: new THREE.Vector3(1, 0, 0) },
            // Boost the night-lights texture a touch so it reads at a glance
            // without blowing out the day side (the source jpg is fairly dim).
            uNightBoost: { value: 1.4 },
        },
    });

    // Scratch objects reused each frame to avoid allocations.
    const scratchWorldSun = new THREE.Vector3();
    const scratchInvMatrix = new THREE.Matrix4();

    function setSunDirection(worldSunDir) {
        // Transform the world-space Sun direction into the mesh's local frame.
        // transformDirection uses only the rotation part of the matrix and
        // renormalizes the result — exactly what we want for a unit vector.
        scratchWorldSun.set(worldSunDir.x, worldSunDir.y, worldSunDir.z);
        mesh.updateMatrixWorld();
        scratchInvMatrix.copy(mesh.matrixWorld).invert();
        scratchWorldSun.transformDirection(scratchInvMatrix);
        material.uniforms.uSunDirectionLocal.value.copy(scratchWorldSun);
    }

    return { material, setSunDirection };
}
