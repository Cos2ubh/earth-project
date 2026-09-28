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
// Normal mapping uses analytical tangent-space TBN — for a sphere, tangent
// vectors can be derived on the fly from the position (T = cross(up, N),
// B = cross(N, T)). This is proper tangent-space normal mapping: mountains
// catch light on the correct side depending on where the sun is, giving
// visible relief instead of just a texture-y bump.
//
// Ocean shading has two contributions:
//   - Sharp specular sun glint (Blinn-Phong, high exponent) — the bright dot
//     where the sun reflects directly off water
//   - Fresnel sky reflection — water gets brighter at glancing angles because
//     it reflects the sky. This is what makes real oceans look "wet."

import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
    uniform sampler2D uHeightTexture;
    uniform float uDisplacementScale;

    varying vec2 vUv;
    varying vec3 vNormalLocal;
    varying vec3 vLocalPosition;

    void main() {
        vUv = uv;
        vNormalLocal = normalize(normal);

        // Sample heightmap with the same UV shift used in the fragment shader
        // (so displacement lines up with the day texture).
        vec2 sampleUv = vec2(fract(uv.x + 0.25), uv.y);
        float height = texture2D(uHeightTexture, sampleUv).r;

        // Displace along the surface normal. Height 0 (sea/deep water) stays
        // at the base sphere; brighter values push the vertex outward.
        // uDisplacementScale is heavily exaggerated vs reality (Everest is
        // only 0.14% of Earth's radius) so mountains actually READ from orbit.
        vec3 displaced = position + normal * height * uDisplacementScale;
        vLocalPosition = displaced;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
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

        // Analytical tangent-space TBN for a sphere.
        // Tangent points east along a parallel, bitangent points north along a
        // meridian, normal is the geometric surface normal. Degenerates exactly
        // at the poles — acceptable since polar ice hides the artifact.
        vec3 N_geom = normalize(vNormalLocal);
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N_geom));
        vec3 B = normalize(cross(N_geom, T));

        // Scale the tangential (XY) components of the normal map by uNormalStrength.
        // Z stays close to 1 so the base normal orientation is preserved.
        vec3 nmap = vec3(nmapRaw.xy * uNormalStrength, nmapRaw.z);
        vec3 N = normalize(T * nmap.x + B * nmap.y + N_geom * nmap.z);

        // Lighting from Sun (both vectors in local frame).
        float lightIntensity = dot(N, uSunDirectionLocal);
        float dayWeight = smoothstep(-0.2, 0.2, lightIntensity);

        vec3 color = mix(nightColor, dayColor, dayWeight);

        // View + half vectors for specular / Fresnel.
        vec3 viewDir = normalize(uCameraPositionLocal - vLocalPosition);
        vec3 halfVec = normalize(uSunDirectionLocal + viewDir);
        float NdotV = clamp(dot(N, viewDir), 0.0, 1.0);

        // --- Ocean: sharp sun glint (Blinn-Phong, tight exponent).
        // High exponent = small bright dot, real-ocean-like.
        float sunGlint = pow(max(dot(N, halfVec), 0.0), 90.0);
        vec3 glintColor = vec3(1.4, 1.28, 1.05) * sunGlint * specMask * dayWeight * uSpecularStrength;

        // --- Ocean: Fresnel sky reflection.
        // Water gets more reflective at glancing angles — this is what makes
        // seas visibly "wet" from orbit. Tinted a soft pale blue to fake the
        // sky the water is reflecting.
        float fresnel = pow(1.0 - NdotV, 4.0);
        vec3 fresnelColor = vec3(0.35, 0.55, 0.85) * fresnel * specMask * dayWeight * 0.55;

        // --- Terrain: subtle contact shadow (self-occlusion at glancing angles).
        // Where the normal-mapped surface is barely lit, dim slightly extra so
        // mountain slopes read as having depth.
        float slopeShade = 1.0 - (1.0 - smoothstep(0.0, 0.35, lightIntensity)) * (1.0 - specMask) * 0.35;
        color *= slopeShade;

        gl_FragColor = vec4(color + glintColor + fresnelColor, 1.0);
    }
`;

/**
 * Build the Earth shader material. Returns { material, updateShader(worldSunDir, camera) }.
 * Call updateShader every frame — the material handles world→local transforms.
 */
export async function buildEarthMaterial(mesh) {
    const loader = new THREE.TextureLoader();

    const [dayTexture, nightTexture, specTexture, normalTexture, heightTexture] = await Promise.all([
        loader.loadAsync('/textures/earth_day_2k.jpg'),
        loader.loadAsync('/textures/earth_night_2k.jpg'),
        loader.loadAsync('/textures/earth_specular_2k.jpg'),
        loader.loadAsync('/textures/earth_normal_2k.jpg'),
        loader.loadAsync('/textures/earth_height_4k.jpg'),
    ]);

    dayTexture.colorSpace = THREE.SRGBColorSpace;
    nightTexture.colorSpace = THREE.SRGBColorSpace;
    // Specular, normal, and height maps are DATA (not color), keep in linear space.
    specTexture.colorSpace = THREE.NoColorSpace;
    normalTexture.colorSpace = THREE.NoColorSpace;
    heightTexture.colorSpace = THREE.NoColorSpace;

    const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
            uDayTexture: { value: dayTexture },
            uNightTexture: { value: nightTexture },
            uSpecularTexture: { value: specTexture },
            uNormalTexture: { value: normalTexture },
            uHeightTexture: { value: heightTexture },
            uSunDirectionLocal: { value: new THREE.Vector3(1, 0, 0) },
            uCameraPositionLocal: { value: new THREE.Vector3(0, 0, 5) },
            uNightBoost: { value: 1.4 },
            uSpecularStrength: { value: 2.4 },
            uNormalStrength: { value: 1.4 },
            // ~40x exaggerated (real Everest is 0.14% of Earth's radius; here it's ~5.5%).
            // Enough to visibly stick up from orbit without looking cartoonish.
            uDisplacementScale: { value: 0.055 },
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
