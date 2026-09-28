// Cinematic intro — a short camera dolly-in from deep space to the default
// view, with the UI chrome (HUD, search, scrub bar) fading in afterward
// instead of popping in instantly. Purely cosmetic: it never touches
// simulated time or any astronomical value, only camera.position and CSS.
//
// Design constraints:
//   - Skippable: any pointer/touch/key interaction cancels it immediately
//     and snaps straight to the final state. Nobody should feel stuck
//     watching an animation they didn't ask for.
//   - Respects prefers-reduced-motion: skips straight to the end state.
//   - OrbitControls stays disabled (input-wise) for the duration so a drag
//     mid-flight can't fight the tween, but controls.update() is safe to
//     call throughout — it only re-derives spherical state from whatever
//     camera.position currently is, so it can't cause a snap-back later.

const DURATION_MS = 2600;

// A bit of camera drift is more interesting than a dead-straight line in —
// start further out and slightly off-axis, ease into the locked default.
const START_POSITION = { x: 3.2, y: 3.6, z: 34 };

// easeOutExpo — fast start, long unhurried settle. Reads as "arriving",
// not "snapping".
function easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Run the intro. Resolves once it's done (either played fully or skipped).
 *
 * @param camera   THREE.PerspectiveCamera — already at its final resting
 *                 position/lookAt when this is called (main.js sets that up
 *                 first); this function temporarily moves it and eases back.
 * @param endPosition  {x,y,z} the camera's real default position, to ease
 *                     toward and land on exactly (avoids float drift).
 * @param onDone   called once, when the intro finishes or is skipped.
 */
export function playIntro(camera, endPosition, onDone) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const body = document.body;

    // Stagger the UI panels' fade-in slightly so they cascade rather than
    // all snapping in on the same frame.
    document.querySelectorAll('.chrome-panel').forEach((el, i) => {
        el.style.transitionDelay = `${i * 90}ms`;
    });

    let done = false;
    function finish() {
        if (done) return;
        done = true;
        camera.position.set(endPosition.x, endPosition.y, endPosition.z);
        body.classList.remove('intro-active');
        window.removeEventListener('pointerdown', finish);
        window.removeEventListener('wheel', finish);
        window.removeEventListener('keydown', finish);
        onDone?.();
    }

    if (reduceMotion) {
        // No animation at all — go straight to the end state.
        finish();
        return;
    }

    // Any of these mean "I want to look around now" — respect it immediately.
    window.addEventListener('pointerdown', finish, { once: true });
    window.addEventListener('wheel', finish, { once: true, passive: true });
    window.addEventListener('keydown', finish, { once: true });

    camera.position.set(START_POSITION.x, START_POSITION.y, START_POSITION.z);
    camera.lookAt(0, 0, 0);

    const startMs = performance.now();

    function tick() {
        if (done) return;
        const elapsed = performance.now() - startMs;
        const t = Math.min(1, elapsed / DURATION_MS);
        const eased = easeOutExpo(t);

        camera.position.set(
            START_POSITION.x + (endPosition.x - START_POSITION.x) * eased,
            START_POSITION.y + (endPosition.y - START_POSITION.y) * eased,
            START_POSITION.z + (endPosition.z - START_POSITION.z) * eased,
        );
        camera.lookAt(0, 0, 0);

        if (t >= 1) {
            finish();
        } else {
            requestAnimationFrame(tick);
        }
    }
    requestAnimationFrame(tick);
}
