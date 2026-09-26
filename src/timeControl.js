// Simulated time — every astronomy call in the app reads through getSimulatedTime()
// instead of new Date() directly, so the whole visualization can be pointed at
// any moment in time (past, present, future) without touching the physics code.
//
// Modes:
//   live      — return real wall-clock time
//   paused    — stay frozen at a fixed timestamp
//   scrubbing — advance from a baseline at a variable speed multiplier
//
// The slider UI drives the mode. The scene doesn't care which mode is active;
// it just reads getSimulatedTime() each frame.

const state = {
    mode: 'live',
    frozenMs: Date.now(),      // used in 'paused' mode
    baselineMs: Date.now(),    // real time at which we last set the scrub position
    scrubOriginMs: Date.now(), // simulated time at that baseline
    speedMultiplier: 1,        // how fast simulated time advances vs real time
};

/**
 * Returns the current simulated Date. Called every frame by main.js.
 */
export function getSimulatedTime() {
    if (state.mode === 'live') {
        return new Date();
    }
    if (state.mode === 'paused') {
        return new Date(state.frozenMs);
    }
    // scrubbing
    const elapsedReal = Date.now() - state.baselineMs;
    const simulated = state.scrubOriginMs + elapsedReal * state.speedMultiplier;
    return new Date(simulated);
}

export function setLive() {
    state.mode = 'live';
}

/**
 * Freeze at a specific timestamp (Date or ms).
 */
export function setPaused(dateOrMs) {
    state.mode = 'paused';
    state.frozenMs = dateOrMs instanceof Date ? dateOrMs.getTime() : dateOrMs;
}

/**
 * Start scrubbing from a given time at a given speed multiplier.
 * speedMultiplier of 1 = real time, 3600 = 1 hour per real second, etc.
 */
export function setScrubbing(dateOrMs, speedMultiplier) {
    state.mode = 'scrubbing';
    state.baselineMs = Date.now();
    state.scrubOriginMs = dateOrMs instanceof Date ? dateOrMs.getTime() : dateOrMs;
    state.speedMultiplier = speedMultiplier;
}

/**
 * Change speed without resetting the current simulated position.
 */
export function setSpeedMultiplier(speedMultiplier) {
    if (state.mode !== 'scrubbing') return;
    const currentSim = getSimulatedTime();
    state.baselineMs = Date.now();
    state.scrubOriginMs = currentSim.getTime();
    state.speedMultiplier = speedMultiplier;
}

export function getMode() {
    return state.mode;
}

export function getSpeedMultiplier() {
    return state.speedMultiplier;
}

/**
 * Jump to a specific time (used by the slider). Puts us in paused mode there.
 */
export function jumpTo(dateOrMs) {
    setPaused(dateOrMs);
}
