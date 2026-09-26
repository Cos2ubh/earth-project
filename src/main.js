// Earth Project — entry point.
// Phase 2: minimum viable 3D scene. Flat sphere, no rotation, no accuracy yet.
// Every subsequent phase adds one layer on top of this foundation.

import * as THREE from 'three';

const canvas = document.getElementById('canvas');

// --- Scene, camera, renderer -------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
    45, // fov (degrees)
    window.innerWidth / window.innerHeight,
    0.1, // near
    1000, // far
);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR for perf

// --- Earth placeholder -------------------------------------------------------
// Just a flat grey sphere for now. Textures + shaders come in Phase 7.

const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
const earthMaterial = new THREE.MeshBasicMaterial({
    color: 0x4a6a8a,
    wireframe: false,
});
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);

// A subtle wireframe overlay so we can see the sphere is actually 3D
// even without lighting. Removed once real textures land.
const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0x2a4a6a,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
});
const earthWireframe = new THREE.Mesh(earthGeometry, wireframeMaterial);
scene.add(earthWireframe);

// --- Resize handling ---------------------------------------------------------

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop -------------------------------------------------------------

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

animate();

console.log('Earth Project — Phase 2 scene initialized');
