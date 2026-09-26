// Location pin — a small marker placed on Earth's surface at the user's
// geographic coordinates. Parented to earthSpin so it rotates with the surface.
//
// Convention (matches earthSpin frame):
//   local +Z = prime meridian at equator
//   local +Y = north pole
//   local +X = 90° east at equator
// A surface point at (lat, lon) in degrees sits at:
//   ( cos(lat)·sin(lon), sin(lat), cos(lat)·cos(lon) ) × radius

import * as THREE from 'three';

const SURFACE_R = 1.0;
const PIN_HEIGHT = 0.06;
const PIN_RADIUS = 0.012;

function latLonToVec3(latDeg, lonDeg, r) {
    const lat = latDeg * Math.PI / 180;
    const lon = lonDeg * Math.PI / 180;
    const cosLat = Math.cos(lat);
    return new THREE.Vector3(
        cosLat * Math.sin(lon) * r,
        Math.sin(lat) * r,
        cosLat * Math.cos(lon) * r,
    );
}

/**
 * Build a small pin marker (a thin cone standing on the surface, tip up).
 * Rotate the pin so its long axis aligns with the surface normal.
 */
export function buildLocationPin(latDeg, lonDeg) {
    const group = new THREE.Group();
    group.name = 'locationPin';

    const cone = new THREE.Mesh(
        new THREE.ConeGeometry(PIN_RADIUS, PIN_HEIGHT, 16),
        new THREE.MeshBasicMaterial({ color: 0x4ad4c8 }),
    );
    // Cone's default axis is +Y — that's what we want when it stands "up"
    // relative to the surface. Shift so base sits on the sphere surface.
    cone.position.y = PIN_HEIGHT / 2;
    group.add(cone);

    // Small glow disc under the tip for legibility on both hemispheres.
    const disc = new THREE.Mesh(
        new THREE.CircleGeometry(PIN_RADIUS * 2.5, 24),
        new THREE.MeshBasicMaterial({
            color: 0x4ad4c8,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
        }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    group.add(disc);

    // Position the whole group on the sphere surface, oriented so local +Y
    // (the pin's up-axis) points away from Earth's center.
    const surfacePoint = latLonToVec3(latDeg, lonDeg, SURFACE_R);
    group.position.copy(surfacePoint);

    // Rotate so the pin's local +Y aligns with the surface normal.
    // Default Y-axis of the group points along scene +Y; we need it to point
    // along surfacePoint (which is the outward normal at that surface point).
    const up = new THREE.Vector3(0, 1, 0);
    const normal = surfacePoint.clone().normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    group.setRotationFromQuaternion(quat);

    return group;
}
