# Earth Project

A real-time 3D visualization of Earth, showing the planet's current axial tilt, sidereal rotation, and the direction of the Sun and Moon — computed from live astronomical data (NASA JPL-accurate), rendered entirely in the browser.

## Features

**Astronomy**
- Correct axial tilt, sidereal-locked rotation, day/night terminator, lat/lon grid
- Procedural sun surface: granulation, sunspots on the real rotation law, limb darkening, corona
- Tidally-locked moon with crater relief, earthshine, and real phase data (phase name, age, next full/new moon, supermoon flag)
- Eclipse detection and moon orbit ring
- Real bright-star catalog for the stellar background
- Time scrub controls, wall clock, timezone
- Verifiable math: `npm run verify` prints Earth state for cross-check against reference sources

**Live data**
- ISS + Hubble tracking via Celestrak TLEs — glowing marker, 30-min fading trail, follow camera, altitude/speed/sunlight panel
- Aurora glow driven by NOAA Kp index
- Meteor showers tied to real annual peak dates
- Historical MODIS imagery via NASA GIBS

**Rendering**
- Progressive HD texture upgrade to NASA Blue Marble 10K
- Real heightmap terrain displacement
- Tangent-space normal mapping, ocean Fresnel, cloud layer, atmosphere, bloom

**Product surfaces**
- Search bar with event lookup and date parsing
- Location pin with season indicator
- Offline reverse-geocoding (1° country grid + named seas/oceans) — the ISS panel names where the station is with no network call
- Share-a-moment: URL state, link copy, image export, tweet intent
- Cinematic dolly-in camera on load

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
