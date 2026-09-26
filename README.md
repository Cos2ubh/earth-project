# Earth Project

A real-time 3D visualization of Earth, showing the planet's current axial tilt, sidereal rotation, and the direction of the Sun and Moon — computed from live astronomical data (NASA JPL-accurate), rendered entirely in the browser.

## Running

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Verifying the astronomy

The visualization is only as trustworthy as the math behind it. To print the current Earth state to the terminal and cross-check against reference sources:

```bash
npm run verify
```

Compare against [timeanddate.com](https://www.timeanddate.com/worldclock/sunearth.html) for the subsolar point.

## Credits

Earth textures (day + night) from [Solar System Scope](https://www.solarsystemscope.com/textures/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Astronomical computations by [astronomy-engine](https://github.com/cosinekitty/astronomy) (Don Cross), which implements the same algorithms used by NASA JPL's Horizons system.

## Status

Work in progress. Currently displays a textured Earth with correct axial tilt, sidereal-locked rotation, day/night terminator, and lat/lon grid. Sun and Moon positioning, atmospheric glow, and stellar background are coming in later phases.
