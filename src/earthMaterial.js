// Earth material — custom ShaderMaterial. Blends day/night textures based on
// dot(surface normal, sun direction), adds specular highlights on oceans (from
// the specular map), and perturbs surface normals with the normal map for
// subtle terrain relief that catches light at grazing angles.
//
// Everything is computed in the mesh's LOCAL frame — the Earth mesh sits inside
// earthSpin (rotates) inside earthGroup (tilted), so world-space Sun and world-
// space camera positions must be transformed into local frame each frame.
//
// UV convention:
//   Three.js SphereGeometry places u=0.25 at +Z (which is our prime meridian).
//   Standard equirectangular Earth textures put prime meridian at u=0.5.
//   So we shift the sample UV by +0.25 in the shader.
//
// Note on normal mapping: this uses a simplified per-fragment perturbation
// (XY offset only, no full tangent-space TBN). Not physically correct, but
// visually convincing for terrain relief at planetary scale. A proper TBN
// implementation would require analytical tangent vectors from sphere position,
// which is doable but adds complexity — skipped for now.

import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormalLocal;
    varying vec3 vLocalPosition;

    void main() {
        vUv = uv;
        vNormalLocal = normalize(normal);
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform sampler2D uDayTexture;
    uniform sampler2D uNightTexture;
    uniform sampler2D uSpecularTexture;
    uniform sampler2D uNormalTexture;
    uniform vec3 uSunDirectionLocal;
    uniform vec3 uCameraPositionLocal;
    uniform float uNightBoost;
    uniform float uSpecularStrength;
    uniform float uNormalStrength;

    varying vec2 vUv;
    varying vec3 vNormalLocal;
    varying vec3 vLocalPosition;

    void main() {
        // Shift UV so prime meridian lines up with texture center (u=0.5).
        vec2 sampleUv = vec2(fract(vUv.x + 0.25), vUv.y);

        // Sample all four maps.
        vec3 dayColor   = texture2D(uDayTexture,   sampleUv).rgb;
        vec3 nightColor = texture2D(uNightTexture, sampleUv).rgb * uNightBoost;
        float specMask  = texture2D(uSpecularTexture, sampleUv).r; // white = water
        vec3 nmapRaw    = texture2D(uNormalTexture,   sampleUv).xyz * 2.0 - 1.0;

        // Approximate normal perturbation: shift XY of the local-space normal
        // by the normal map's XY. Not tangent-space, but reads as terrain.
        vec3 N = normalize(vNormalLocal + vec3(nmapRaw.x, nmapRaw.y, 0.0) * uNormalStrength);

        // Lighting from Sun (both vectors in local frame).
        float lightIntensity = dot(N, uSunDirectionLocal);
        float dayWeight = smoothstep(-0.2, 0.2, lightIntensity);

        vec3 color = mix(nightColor, dayColor, dayWeight);

        // Blinn-Phong specular — only on water, only on the day side.
        vec3 viewDir = normalize(uCameraPositionLocal - vLocalPosition);
        vec3 halfVec = normalize(uSunDirectionLocal + viewDir);
        float specTerm = pow(max(dot(N, halfVec), 0.0), 40.0);
        vec3 specColor = vec3(1.1, 1.0, 0.85) * specTerm * specMask * dayWeight * uSpecularStrength;

        gl_FragColor = vec4(color + specColor, 1.0);
    }
`;

/**
 * Build the Earth shader material. Returns { material, updateShader(worldSunDir, camera) }.
 * Call updateShader every frame — the material handles world→local transforms.
 */
export async function buildEarthMaterial(mesh) {
    const loader = new THREE.TextureLoader();

    const [dayTexture, nightTexture, specTexture, normalTexture] = await Promise.all([
        loader.loadAsync('/textures/earth_day_2k.jpg'),
        loader.loadAsync('/textures/earth_night_2k.jpg'),
        loader.loadAsync('/textures/earth_specular_2k.jpg'),
        loader.loadAsync('/textures/earth_normal_2k.jpg'),
    ]);

    dayTexture.colorSpace = THREE.SRGBColorSpace;
    nightTexture.colorSpace = THREE.SRGBColorSpace;
    // Specular and normal maps are DATA (not color), so keep them in linear space.
    specTexture.colorSpace = THREE.NoColorSpace;
    normalTexture.colorSpace = THREE.NoColorSpace;

    const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
            uDayTexture: { value: dayTexture },
            uNightTexture: { value: nightTexture },
            uSpecularTexture: { value: specTexture },
            uNormalTexture: { value: normalTexture },
            uSunDirectionLocal: { value: new THREE.Vector3(1, 0, 0) },
            uCameraPositionLocal: { value: new THREE.Vector3(0, 0, 5) },
            uNightBoost: { value: 1.4 },
            uSpecularStrength: { value: 1.6 },
            uNormalStrength: { value: 0.5 },
        },
    });

    // Scratch objects reused each frame to avoid allocations.
    const scratchWorldSun = new THREE.Vector3();
    const scratchCameraLocal = new THREE.Vector3();
    const scratchInvMatrix = new THREE.Matrix4();

    function updateShader(worldSunDir, camera) {
        mesh.updateMatrixWorld();
        scratchInvMatrix.copy(mesh.matrixWorld).invert();

        // Sun direction in mesh local frame.
        scratchWorldSun.set(worldSunDir.x, worldSunDir.y, worldSunDir.z);
        scratchWorldSun.transformDirection(scratchInvMatrix);
        material.uniforms.uSunDirectionLocal.value.copy(scratchWorldSun);

        // Camera position in mesh local frame.
        scratchCameraLocal.copy(camera.position);
        scratchCameraLocal.applyMatrix4(scratchInvMatrix);
        material.uniforms.uCameraPositionLocal.value.copy(scratchCameraLocal);
    }

    return { material, updateShader };
}
