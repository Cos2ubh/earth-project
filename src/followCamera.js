// Follow-the-ISS camera — glides to a chase view behind the ISS, then keeps
// that view as the station orbits, so the continents and the day/night line
// slide by underneath it.
//
// How it works:
//   1. Glide (~1.8 s, eased): the camera direction turns from wherever it
//      was toward a spot a little way BEHIND the ISS along its orbit, and the
//      distance eases to a close-in framing. The target is re-read every
//      frame, so the moving ISS is tracked even during the glide.
//   2. Chase: each frame the camera is rotated about the globe's centre by the
//      same rotation that carried the ISS since the previous frame. That keeps
//      the chosen viewpoint locked to the station while leaving the user free
//      to orbit and zoom — their input simply adds on top, instead of being
//      fought by a spring pulling the camera back.
//
// The camera must be free of any parent, look at the origin (OrbitControls
// with target 0,0,0), and this module must run BEFORE controls.update().
//
// Following stops on: a second click, Recenter, the tracker losing the ISS,
// or leaving live mode (the caller checks these — see main.js).

import * as THREE from 'three';

const GLIDE_MS = 1800;
const FOLLOW_DISTANCE = 3.4; // in Earth radii from the centre
const BEHIND_RADIANS = THREE.MathUtils.degToRad(24);

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * @param camera    THREE.PerspectiveCamera
 * @param getFocus  () => { worldPosition: Vector3, worldTangent: Vector3 } | null
 * @param onStop    called whenever following ends (for UI state)
 */
export function createFollowCamera(camera, { getFocus, onStop } = {}) {
    let active = false;
    let gliding = false;
    let glideStartMs = 0;
    let startDistance = 0;

    const startDirection = new THREE.Vector3();
    const previousIssDirection = new THREE.Vector3();

    // scratch objects, reused every frame
    const issDirection = new THREE.Vector3();
    const chase = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const partial = new THREE.Quaternion();
    const identity = new THREE.Quaternion();

    /** Direction from the globe's centre to the ideal camera spot. */
    function chaseDirection(focus, out) {
        out.copy(focus.worldPosition).normalize();
        // Orbit normal: rotating the ISS direction about it by +θ moves the
        // point forward along the track, so −θ puts us behind it.
        axis.crossVectors(out, focus.worldTangent).normalize();
        return out.applyAxisAngle(axis, -BEHIND_RADIANS);
    }

    // The user grabbing or zooming mid-glide means "I want to steer now":
    // end the glide where it stands and carry on chasing from there.
    function settleGlide() {
        if (!active || !gliding) return;
        gliding = false;
        const focus = getFocus();
        if (focus) previousIssDirection.copy(focus.worldPosition).normalize();
    }

    function start() {
        const focus = getFocus();
        if (!focus) return false;
        active = true;
        gliding = true;
        glideStartMs = performance.now();
        startDirection.copy(camera.position).normalize();
        startDistance = camera.position.length();
        window.addEventListener('pointerdown', settleGlide, { passive: true });
        window.addEventListener('wheel', settleGlide, { passive: true });
        return true;
    }

    function stop() {
        if (!active) return;
        active = false;
        gliding = false;
        window.removeEventListener('pointerdown', settleGlide);
        window.removeEventListener('wheel', settleGlide);
        onStop?.();
    }

    /** Call once per frame, before controls.update(). */
    function update() {
        if (!active) return;
        const focus = getFocus();
        if (!focus) {
            stop();
            return;
        }
        issDirection.copy(focus.worldPosition).normalize();

        if (gliding) {
            const t = Math.min(1, (performance.now() - glideStartMs) / GLIDE_MS);
            const eased = easeInOutCubic(t);

            chaseDirection(focus, chase);
            rotation.setFromUnitVectors(startDirection, chase);
            partial.slerpQuaternions(identity, rotation, eased);
            camera.position
                .copy(startDirection)
                .applyQuaternion(partial)
                .multiplyScalar(THREE.MathUtils.lerp(startDistance, FOLLOW_DISTANCE, eased));

            if (t >= 1) {
                gliding = false;
                previousIssDirection.copy(issDirection);
            }
            return;
        }

        rotation.setFromUnitVectors(previousIssDirection, issDirection);
        camera.position.applyQuaternion(rotation);
        previousIssDirection.copy(issDirection);
    }

    return {
        start,
        stop,
        update,
        isActive: () => active,
    };
}
