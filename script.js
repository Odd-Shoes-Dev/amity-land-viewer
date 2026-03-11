// ── Config ──────────────────────────────────────────────────────
// Token is injected at build time by Vercel (env var: MAPBOX_TOKEN).
// For local dev, create a config.local.js that sets window.MAPBOX_TOKEN.
mapboxgl.accessToken = window.MAPBOX_TOKEN || '';

const CENTER    = [30.6608954, -0.6061077]; // [lon, lat]
const ZOOM_PLOT = 16;

// ── Plot polygon (approx 50×100 ft around center) ───────────────
// 50 ft ≈ 15.24 m  → ~0.000137° latitude / ~0.000137° longitude
// 100 ft ≈ 30.48 m → ~0.000274° latitude / ~0.000274° longitude
const HALF_W = 0.000137; // longitude  (east-west  / 50 ft half-width)
const HALF_H = 0.000274; // latitude   (north-south / 100 ft half-height)

const plotCoords = [
  [CENTER[0] - HALF_W, CENTER[1] - HALF_H],
  [CENTER[0] + HALF_W, CENTER[1] - HALF_H],
  [CENTER[0] + HALF_W, CENTER[1] + HALF_H],
  [CENTER[0] - HALF_W, CENTER[1] + HALF_H],
  [CENTER[0] - HALF_W, CENTER[1] - HALF_H], // close ring
];

// ── Infrastructure markers ───────────────────────────────────────
const infraPoints = [
  { icon: '🛣️',  name: 'Main Road',      dist: '400 m',  coords: [30.6608954, -0.6025] },
  { icon: '🛒',  name: 'Trading Centre', dist: '900 m',  coords: [30.6528,    -0.6061] },
  { icon: '🏫',  name: 'School',         dist: '1.4 km', coords: [30.6609,    -0.6187] },
  { icon: '🏥',  name: 'Hospital',       dist: '2.1 km', coords: [30.6798,    -0.6061] },
];

// ── Distance visualization helpers ──────────────────────────────
/**
 * Build a GeoJSON polygon ring approximating a geodesic circle.
 * @param {[number,number]} centerLonLat  [lon, lat] in degrees
 * @param {number}          radiusKm      radius in kilometres
 * @param {number}          steps         polygon vertex count
 */
function makeCirclePolygon(centerLonLat, radiusKm, steps = 80) {
  const [cLon, cLat] = centerLonLat;
  const lat = cLat * Math.PI / 180;
  const lon = cLon * Math.PI / 180;
  const d   = radiusKm / 6371; // angular radius (radians)
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ = Math.asin(
      Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(θ)
    );
    const λ = lon + Math.atan2(
      Math.sin(θ) * Math.sin(d) * Math.cos(lat),
      Math.cos(d) - Math.sin(lat) * Math.sin(φ)
    );
    ring.push([λ * 180 / Math.PI, φ * 180 / Math.PI]);
  }
  return ring;
}

// Named endpoints (mirror values already in infraPoints)
const ROAD_COORDS     = [30.6608954, -0.6025]; // Main Road (north, 400 m)
const HOSPITAL_COORDS = [30.6798,    -0.6061]; // Hospital  (east,  2.1 km)

// Midpoints for label placement
const roadMid     = [
  (CENTER[0] + ROAD_COORDS[0])     / 2,
  (CENTER[1] + ROAD_COORDS[1])     / 2,
];
const hospitalMid = [
  (CENTER[0] + HOSPITAL_COORDS[0]) / 2,
  (CENTER[1] + HOSPITAL_COORDS[1]) / 2,
];

// ── Init map ─────────────────────────────────────────────────────
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/satellite-v9',
  center: [32.2903, 1.3733], // start over Uganda for fly-in
  zoom: 6,
  pitch: 0,
  bearing: 0,
  antialias: true,
});

// Navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'top-right');
map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

// ── On load ──────────────────────────────────────────────────────
map.on('load', () => {

  // ── 3D terrain ───────────────────────────────────────────────
  map.addSource('mapbox-dem', {
    type: 'raster-dem',
    url:  'mapbox://mapbox.mapbox-terrain-dem-v1',
    tileSize: 512,
    maxzoom: 14,
  });
  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

  // ── Sky atmosphere layer ─────────────────────────────────────
  map.addLayer({
    id:   'sky',
    type: 'sky',
    paint: {
      'sky-type': 'atmosphere',
      'sky-atmosphere-sun': [0.0, 90.0],
      'sky-atmosphere-sun-intensity': 15,
    },
  });

  // ── Plot spotlight mask ───────────────────────────────────────
  // A polygon with a hole punched in the exact shape of the plot.
  // Outside the hole → dark overlay; inside the hole → full satellite brightness.
  //
  // GeoJSON winding rules (nonzero fill rule):
  //   Exterior ring → CCW  (adds +1 winding → filled = masked)
  //   Interior ring → CW   (adds -1 winding → net 0 = transparent "hole")
  //
  // plotCoords is CCW (SW→SE→NE→NW), so the hole ring reverses that to CW.

  const MASK_OUTER = [          // large CCW bounding box
    [25, -5], [35, -5], [35, 5], [25, 5], [25, -5],
  ];
  const MASK_HOLE = [           // CW = reverse of plotCoords
    [CENTER[0] - HALF_W, CENTER[1] - HALF_H],  // SW
    [CENTER[0] - HALF_W, CENTER[1] + HALF_H],  // NW
    [CENTER[0] + HALF_W, CENTER[1] + HALF_H],  // NE
    [CENTER[0] + HALF_W, CENTER[1] - HALF_H],  // SE
    [CENTER[0] - HALF_W, CENTER[1] - HALF_H],  // close
  ];

  map.addSource('plot-mask', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [MASK_OUTER, MASK_HOLE] },
    },
  });

  map.addLayer({
    id:     'plot-mask-fill',
    type:   'fill',
    source: 'plot-mask',
    paint:  {
      'fill-color':   '#000000',
      'fill-opacity': 0.55,
    },
  });

  // ── 1 km radius circle ───────────────────────────────────────
  map.addSource('radius-circle', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [makeCirclePolygon(CENTER, 1)] },
    },
  });

  // Subtle fill
  map.addLayer({
    id: 'radius-fill', type: 'fill', source: 'radius-circle',
    paint: { 'fill-color': '#4fc3f7', 'fill-opacity': 0.05 },
  });

  // Dashed perimeter
  map.addLayer({
    id: 'radius-outline', type: 'line', source: 'radius-circle',
    paint: {
      'line-color':     '#4fc3f7',
      'line-width':     3,
      'line-opacity':   0.8,
      'line-dasharray': [6, 4],
    },
  });

  // ── Distance lines: plot-center → road, plot-center → hospital ─
  map.addSource('distance-lines', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'road' },
          geometry: { type: 'LineString', coordinates: [CENTER, ROAD_COORDS] },
        },
        {
          type: 'Feature',
          properties: { kind: 'hospital' },
          geometry: { type: 'LineString', coordinates: [CENTER, HOSPITAL_COORDS] },
        },
      ],
    },
  });

  // Road – wide blurry glow (yellow)
  map.addLayer({
    id: 'road-line-glow', type: 'line', source: 'distance-lines',
    filter: ['==', ['get', 'kind'], 'road'],
    paint: { 'line-color': '#ffd700', 'line-width': 28, 'line-opacity': 0.4, 'line-blur': 10 },
  });
  // Road – crisp dashed core
  map.addLayer({
    id: 'road-line-core', type: 'line', source: 'distance-lines',
    filter: ['==', ['get', 'kind'], 'road'],
    paint: {
      'line-color':     '#ffd700',
      'line-width':     5,
      'line-opacity':   1,
      'line-dasharray': [8, 4],
    },
  });

  // Hospital – wide blurry glow (red)
  map.addLayer({
    id: 'hospital-line-glow', type: 'line', source: 'distance-lines',
    filter: ['==', ['get', 'kind'], 'hospital'],
    paint: { 'line-color': '#ff4d4d', 'line-width': 28, 'line-opacity': 0.4, 'line-blur': 10 },
  });
  // Hospital – crisp dashed core
  map.addLayer({
    id: 'hospital-line-core', type: 'line', source: 'distance-lines',
    filter: ['==', ['get', 'kind'], 'hospital'],
    paint: {
      'line-color':     '#ff4d4d',
      'line-width':     5,
      'line-opacity':   1,
      'line-dasharray': [8, 4],
    },
  });

  // ── Plot polygon source ──────────────────────────────────────
  map.addSource('plot', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [plotCoords] },
    },
  });

  // Fill – light transparent red
  map.addLayer({
    id:     'plot-fill',
    type:   'fill',
    source: 'plot',
    paint:  {
      'fill-color':   '#e63946',
      'fill-opacity': 0.18,
    },
  });

  // Glow layer 1 – outermost, very diffuse
  map.addLayer({
    id:     'plot-glow-outer',
    type:   'line',
    source: 'plot',
    paint:  {
      'line-color':   '#ff6b6b',
      'line-width':   12,
      'line-opacity': 0.15,
      'line-blur':    8,
    },
  });

  // Glow layer 2 – mid
  map.addLayer({
    id:     'plot-glow-mid',
    type:   'line',
    source: 'plot',
    paint:  {
      'line-color':   '#ff4d4d',
      'line-width':   6,
      'line-opacity': 0.35,
      'line-blur':    4,
    },
  });

  // Solid outline – crisp red border
  map.addLayer({
    id:     'plot-outline',
    type:   'line',
    source: 'plot',
    paint:  {
      'line-color':   '#e63946',
      'line-width':   2.5,
      'line-opacity': 1,
    },
  });

  // ── Pulsing circle markers for road & hospital ───────────────
  map.addSource('pulse-markers', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color: '#ffd700' },
          geometry: { type: 'Point', coordinates: ROAD_COORDS },
        },
        {
          type: 'Feature',
          properties: { color: '#ff4d4d' },
          geometry: { type: 'Point', coordinates: HOSPITAL_COORDS },
        },
      ],
    },
  });

  // Inner solid dot
  map.addLayer({
    id: 'pulse-core', type: 'circle', source: 'pulse-markers',
    paint: {
      'circle-radius':         13,
      'circle-color':          ['get', 'color'],
      'circle-opacity':        1,
      'circle-stroke-width':   3.5,
      'circle-stroke-color':   '#ffffff',
      'circle-stroke-opacity': 0.9,
    },
  });

  // Pulse ring 1 — radius & opacity driven by animatePulse()
  map.addLayer({
    id: 'pulse-ring-1', type: 'circle', source: 'pulse-markers',
    paint: {
      'circle-radius':         16,
      'circle-color':          'rgba(0,0,0,0)',
      'circle-stroke-width':   2.5,
      'circle-stroke-color':   ['get', 'color'],
      'circle-stroke-opacity': 0.7,
      'circle-opacity':        0,
    },
  });

  // Pulse ring 2 — half-period offset
  map.addLayer({
    id: 'pulse-ring-2', type: 'circle', source: 'pulse-markers',
    paint: {
      'circle-radius':         26,
      'circle-color':          'rgba(0,0,0,0)',
      'circle-stroke-width':   1.5,
      'circle-stroke-color':   ['get', 'color'],
      'circle-stroke-opacity': 0.4,
      'circle-opacity':        0,
    },
  });

  // ── Distance line labels + 1 km radius label ─────────────────
  map.addSource('dist-labels-src', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { label: 'Nearest Main Road – 400m', color: '#ffd700' },
          geometry: { type: 'Point', coordinates: roadMid },
        },
        {
          type: 'Feature',
          properties: { label: 'Nearest Hospital – 2.1 km', color: '#ff6b6b' },
          geometry: { type: 'Point', coordinates: hospitalMid },
        },
        {
          // North edge of the 1 km circle
          type: 'Feature',
          properties: { label: '1 km radius', color: '#4fc3f7' },
          geometry: { type: 'Point', coordinates: [CENTER[0], CENTER[1] + 0.009] },
        },
      ],
    },
  });

  map.addLayer({
    id:     'dist-labels',
    type:   'symbol',
    source: 'dist-labels-src',
    layout: {
      'text-field':          ['get', 'label'],
      'text-size':           15,
      'text-font':           ['Open Sans Bold', 'Arial Unicode MS Regular'],
      'text-anchor':         'center',
      'text-offset':         [0, -1.5],
      'text-allow-overlap':  true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color':      ['get', 'color'],
      'text-halo-color': 'rgba(13,17,23,0.95)',
      'text-halo-width': 3.5,
    },
  });

  // ── Plot marker (center label) ───────────────────────────────
  const plotEl = document.createElement('div');
  plotEl.className = 'plot-marker';
  plotEl.textContent = '✅ Amity Verified Plot';

  const plotPopup = new mapboxgl.Popup({ offset: 30, closeButton: true })
    .setHTML(`
      <div class="popup-title">
        Amity Realtors Verified Plot
        <span class="verified-badge">✔ Verified</span>
      </div>
      <div class="popup-row"><span class="pk">Location</span>      <span class="pv">Biharwe, Mbarara</span></div>
      <div class="popup-row"><span class="pk">Plot Size</span>     <span class="pv">50 × 100 ft</span></div>
      <div class="popup-row"><span class="pk">Distance to Town</span><span class="pv">7 km</span></div>
      <div class="popup-row"><span class="pk">Electricity</span>   <span class="pv">✔ Available</span></div>
      <div class="popup-row"><span class="pk">Water</span>         <span class="pv">✔ Available</span></div>
      <div class="popup-row"><span class="pk">Status</span>        <span class="pv">Title Available</span></div>
    `);

  new mapboxgl.Marker({ element: plotEl, anchor: 'bottom' })
    .setLngLat(CENTER)
    .setPopup(plotPopup)
    .addTo(map);

  // ── Infrastructure markers ───────────────────────────────────
  infraPoints.forEach(({ icon, name, dist, coords }) => {
    const el = document.createElement('div');
    el.className   = 'infra-marker';
    el.textContent = icon;
    el.title       = name;

    const popup = new mapboxgl.Popup({ offset: 20, closeButton: true })
      .setHTML(`
        <div class="popup-infra-title">${icon} ${name}</div>
        <div class="popup-infra-dist">Distance: <strong>${dist}</strong></div>
      `);

    new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(coords)
      .setPopup(popup)
      .addTo(map);
  });

  // ── Dismiss loading overlay ──────────────────────────────────
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('fade-out');
  setTimeout(() => overlay.remove(), 700);

  // ── Fly-in animation ─────────────────────────────────────────
  // Brief pause so the satellite tiles start rendering, then fly in
  setTimeout(() => {
    map.flyTo({
      center:   CENTER,
      zoom:     ZOOM_PLOT,
      pitch:    60,
      bearing:  -20,
      duration: 5000,
      essential: true,
      easing: (t) => {
        // Ease in-out cubic
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      },
    });
  }, 800);

});

// ── Glow pulse animation (JS-driven opacity cycling) ────────────
let glowDir = -1;
let glowOpacity = 0.35;

function animateGlow() {
  glowOpacity += glowDir * 0.004;
  if (glowOpacity <= 0.15) glowDir =  1;
  if (glowOpacity >= 0.45) glowDir = -1;

  if (map.getLayer('plot-glow-mid')) {
    map.setPaintProperty('plot-glow-mid',   'line-opacity', glowOpacity);
    map.setPaintProperty('plot-glow-outer', 'line-opacity', glowOpacity * 0.4);
  }
  requestAnimationFrame(animateGlow);
}
map.on('load', animateGlow);

// ── Pulse ring + line-glow animation (time-based) ────────────────
// Two concentric rings expand outward and fade, offset by half a period.
function animatePulse() {
  const now    = Date.now();
  const PERIOD = 2200; // ms per full pulse cycle

  const t1 = (now % PERIOD) / PERIOD;               // wave 1: 0 → 1
  const t2 = ((now + PERIOD / 2) % PERIOD) / PERIOD; // wave 2: offset by 0.5

  // Ease-out: ring expands quickly then slows; opacity is inverse of progress
  const easeOut = t => 1 - Math.pow(1 - t, 2);

  const r1 = 9  + easeOut(t1) * 28; // 9 px → 37 px
  const o1 = (1 - t1) * 0.8;

  const r2 = 9  + easeOut(t2) * 28;
  const o2 = (1 - t2) * 0.55;

  if (map.getLayer('pulse-ring-1')) {
    map.setPaintProperty('pulse-ring-1', 'circle-radius',         r1);
    map.setPaintProperty('pulse-ring-1', 'circle-stroke-opacity', o1);
  }
  if (map.getLayer('pulse-ring-2')) {
    map.setPaintProperty('pulse-ring-2', 'circle-radius',         r2);
    map.setPaintProperty('pulse-ring-2', 'circle-stroke-opacity', o2);
  }

  // Sync the distance-line glows with a gentle sine breath
  const lineGlow = 0.35 + Math.sin(now * 0.0025) * 0.15;
  if (map.getLayer('road-line-glow')) {
    map.setPaintProperty('road-line-glow',     'line-opacity', lineGlow);
    map.setPaintProperty('hospital-line-glow', 'line-opacity', lineGlow * 0.85);
  }

  requestAnimationFrame(animatePulse);
}
map.on('load', animatePulse);

// ── flyToPlot helper (called by sidebar button) ──────────────────
function flyToPlot() {
  closeSidebar();
  stopOrbit();
  stopStandMode();
  map.flyTo({
    center:   CENTER,
    zoom:     ZOOM_PLOT,
    pitch:    60,
    bearing:  -20,
    duration: 2500,
    essential: true,
  });
}

// ── Drone orbit ───────────────────────────────────────────────────
const ORBIT_ZOOM    = 18;
const ORBIT_PITCH   = 60;
const ORBIT_SPEED   = 0.04; // degrees per frame (~2.4°/s at 60 fps)

let orbitActive = false;
let orbitBearing = -20;
let orbitRafId   = null;

function orbitStep() {
  if (!orbitActive) return;
  orbitBearing = (orbitBearing + ORBIT_SPEED) % 360;
  map.setBearing(orbitBearing);
  orbitRafId = requestAnimationFrame(orbitStep);
}

function startOrbit() {
  orbitActive  = true;
  orbitBearing = map.getBearing();

  // Smoothly snap to orbit zoom/pitch first, then begin spinning
  map.easeTo({
    center:   CENTER,
    zoom:     ORBIT_ZOOM,
    pitch:    ORBIT_PITCH,
    duration: 1200,
    easing:   (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  });

  // Start the bearing loop once the ease settles
  setTimeout(() => {
    if (orbitActive) orbitRafId = requestAnimationFrame(orbitStep);
  }, 1250);

  const btn = document.getElementById('drone-btn');
  btn.classList.add('orbiting');
  document.getElementById('drone-label').textContent = 'Stop Orbit';
}

function stopOrbit() {
  orbitActive = false;
  if (orbitRafId) { cancelAnimationFrame(orbitRafId); orbitRafId = null; }

  const btn = document.getElementById('drone-btn');
  btn.classList.remove('orbiting');
  document.getElementById('drone-label').textContent = 'Drone View';
}

function toggleDroneView() {
  closeSidebar();
  if (orbitActive) {
    stopOrbit();
  } else {
    stopStandMode();
    startOrbit();
  }
}

// ── Stand On Your Land mode ───────────────────────────────────────
const STAND_ZOOM  = 20;
const STAND_PITCH = 85;       // near-horizontal, eye-level
const STAND_DWELL = 4500;     // ms at each corner before moving on

// Four positions just inside each plot corner, facing outward.
// Bearing = compass direction the camera looks (away from plot centre).
const STAND_WAYPOINTS = [
  {
    pos:     [CENTER[0] - HALF_W * 0.55, CENTER[1] - HALF_H * 0.55],
    bearing: 225,
    dir:     'South-West',
    corner:  'SW corner of your land',
  },
  {
    pos:     [CENTER[0] + HALF_W * 0.55, CENTER[1] - HALF_H * 0.55],
    bearing: 135,
    dir:     'South-East',
    corner:  'SE corner of your land',
  },
  {
    pos:     [CENTER[0] + HALF_W * 0.55, CENTER[1] + HALF_H * 0.55],
    bearing: 45,
    dir:     'North-East',
    corner:  'NE corner of your land',
  },
  {
    pos:     [CENTER[0] - HALF_W * 0.55, CENTER[1] + HALF_H * 0.55],
    bearing: 315,
    dir:     'North-West',
    corner:  'NW corner of your land',
  },
];

let standActive  = false;
let standIndex   = 0;
let standTimeout = null;

function standStep() {
  if (!standActive) return;

  const wp = STAND_WAYPOINTS[standIndex];
  _updateStandHUD(wp);

  map.easeTo({
    center:   wp.pos,
    zoom:     STAND_ZOOM,
    pitch:    STAND_PITCH,
    bearing:  wp.bearing,
    duration: 3200,
    easing:   (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  });

  standTimeout = setTimeout(() => {
    if (!standActive) return;
    standIndex = (standIndex + 1) % STAND_WAYPOINTS.length;
    standStep();
  }, STAND_DWELL);
}

function startStandMode() {
  standActive = true;
  standIndex  = 0;

  _showStandHUD();

  // Fly to first waypoint, then start the walk loop
  const first = STAND_WAYPOINTS[0];
  map.flyTo({
    center:    first.pos,
    zoom:      STAND_ZOOM,
    pitch:     STAND_PITCH,
    bearing:   first.bearing,
    duration:  2200,
    essential: true,
    easing:    (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  });

  setTimeout(() => {
    if (standActive) standStep();
  }, 2300);

  const btn = document.getElementById('stand-btn');
  btn.classList.add('standing');
  document.getElementById('stand-label').textContent = 'Exit Stand Mode';
}

function stopStandMode() {
  standActive = false;
  if (standTimeout) { clearTimeout(standTimeout); standTimeout = null; }
  _hideStandHUD();

  const btn = document.getElementById('stand-btn');
  if (btn) {
    btn.classList.remove('standing');
    document.getElementById('stand-label').textContent = 'Stand On Your Land';
  }
}

function toggleStandMode() {
  closeSidebar();
  if (standActive) {
    stopStandMode();
  } else {
    stopOrbit();
    startStandMode();
  }
}

// ── HUD helpers ───────────────────────────────────────────────────
function _showStandHUD() {
  document.getElementById('stand-hud').classList.remove('hidden');
}
function _hideStandHUD() {
  document.getElementById('stand-hud').classList.add('hidden');
}
function _updateStandHUD(wp) {
  document.getElementById('hud-facing-dir').textContent = wp.dir;
  document.getElementById('hud-corner').textContent     = wp.corner;

  // Rotate the SVG needle group to match bearing.
  // bearing 0 = N (no rotation), 90 = E, etc.
  const needle = document.getElementById('compass-needle-group');
  if (needle) needle.setAttribute('transform', `rotate(${wp.bearing}, 24, 24)`);
}

// Stop stand mode when user manually drags the map
map.on('mousedown', () => { if (standActive) stopStandMode(); });
map.on('touchstart', () => {
  if (standActive) stopStandMode();
  closeSidebar();
});

// ── Mobile sidebar drawer ─────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
  document.getElementById('menu-toggle').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
  document.getElementById('menu-toggle').classList.remove('open');
}
