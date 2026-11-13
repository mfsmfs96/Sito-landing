/* ===================================================================
   Arrivo in volo 3D
   "Da dove parti?" diventa una veduta dal mare con la città dell'ospite e
   San Nicola Arcella: un cuore disegna la strada che le unisce, poi la
   camera scende sul Palazzo, che sorge in 3D dalla mappa.
   MapLibre GL viene caricato solo quando qualcuno avvia il volo.
   =================================================================== */
(() => {
  "use strict";

  const ML_VERSION = "5.24.1";
  const ML_JS  = `https://cdn.jsdelivr.net/npm/maplibre-gl@${ML_VERSION}/dist/maplibre-gl.js`;
  const ML_CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${ML_VERSION}/dist/maplibre-gl.css`;
  const ML_JS_SRI  = "sha384-nXMl9YiLoSG5KBPTFgvxVuIqQQcqIvo0bFrvoEaGJC6r7IibIzF1S36Zbf/sKBtL";
  const ML_CSS_SRI = "sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK";
  const OFM    = "https://tiles.openfreemap.org";
  const DEM    = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const OSRM = "https://router.project-osrm.org/route/v1/driving";

  const DIRECTIONS_DEST = "Praia a Mare (CS)";

  const PALAZZO = { lng: 15.78241, lat: 39.84513 };
  // la costa guarda a ovest: all'arrivo inquadriamo dal mare verso le colline
  const VIEW_BEARING = 78;
  // il viaggio si guarda da lontano, dal Tirreno verso la costa italiana
  const SEA_BEARING = 58, SEA_PITCH = 50;

  const C = {
    paper: "#f3ebdc", paper2: "#efe4d0", panel: "#fffdf9",
    ink: "#46392d", inkSoft: "#7a6a58",
    rose: "#c1815f", roseDeep: "#9c5f42", roseSoft: "#e6c4ae",
    sage: "#8a9873", wood: "#dfe2cc", grass: "#e7e6d1",
    sea: "#c6d7d3", seaDeep: "#b4c9c5",
    wall: "#ecc9b6", eaves: "#cf9273", roof: "#b9714f", shutter: "#5f4638", portal: "#4b382d", court: "#e9dfcb"
  };

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, c = document) => c.querySelector(s);

  /* ---------- geometria ---------- */
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  function centralAngle(a, b) {
    const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
    const dφ = φ2 - φ1, dλ = toRad(b.lng - a.lng);
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const distanceKm = (a, b) => centralAngle(a, b) * 6371;

  function greatCircle(a, b, n) {
    const d = centralAngle(a, b);
    if (d < 1e-7) return [[a.lng, a.lat], [b.lng, b.lat]];
    const φ1 = toRad(a.lat), λ1 = toRad(a.lng), φ2 = toRad(b.lat), λ2 = toRad(b.lng);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
      const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
      const z = A * Math.sin(φ1) + B * Math.sin(φ2);
      pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.hypot(x, y)))]);
    }
    // evita salti sull'antimeridiano
    for (let i = 1; i < pts.length; i++) {
      while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360;
      while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360;
    }
    return pts;
  }

  function bearingDeg(a, b) {
    const φ1 = toRad(a[1]), φ2 = toRad(b[1]), dλ = toRad(b[0] - a[0]);
    const y = Math.sin(dλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function lerpAngle(a, b, k) {
    const d = ((b - a + 540) % 360) - 180;
    return (a + d * k + 360) % 360;
  }
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeSine  = t => -(Math.cos(Math.PI * t) - 1) / 2;

  /* ---------- servizi esterni ---------- */
  let mlPromise = null;
  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mlPromise) return mlPromise;
    mlPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = ML_CSS;
      css.integrity = ML_CSS_SRI; css.crossOrigin = "anonymous";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = ML_JS; s.async = true;
      s.integrity = ML_JS_SRI; s.crossOrigin = "anonymous";
      s.onload = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error("maplibre missing"));
      s.onerror = () => reject(new Error("maplibre load failed"));
      document.head.appendChild(s);
    });
    mlPromise.catch(() => { mlPromise = null; });
    return mlPromise;
  }

  function supportsWebGL() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { return false; }
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timeout")), ms))
    ]);
  }

  function prettyName(raw, fallback) {
    const s = (raw || fallback || "").split(",")[0].trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "casa vostra";
  }

  async function geocode(query) {
    const url = `${NOMINATIM}/search?format=jsonv2&limit=1&accept-language=it&q=${encodeURIComponent(query)}`;
    const res = await withTimeout(fetch(url), 9000, "geocode");
    if (!res.ok) throw new Error("geocode " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const d = data[0];
    return { lng: +d.lon, lat: +d.lat, label: prettyName(d.name, query) };
  }

  async function reverseName(lat, lng) {
    try {
      const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=10&accept-language=it&lat=${lat}&lon=${lng}`;
      const res = await withTimeout(fetch(url), 6000, "reverse");
      if (!res.ok) return null;
      const d = await res.json();
      const a = d.address || {};
      return a.city || a.town || a.village || a.municipality || d.name || null;
    } catch { return null; }
  }

  // percorso in auto lungo le strade principali (OSRM). Se non risponde si vola in linea retta.
  async function fetchRoute(origin, dest) {
    if (distanceKm(origin, dest) > 2500) return null;
    const url = `${OSRM}/${origin.lng.toFixed(5)},${origin.lat.toFixed(5)};${dest.lng.toFixed(5)},${dest.lat.toFixed(5)}?overview=full&geometries=geojson`;
    const res = await withTimeout(fetch(url), 8000, "route");
    if (!res.ok) throw new Error("route " + res.status);
    const data = await res.json();
    const r = data && data.code === "Ok" && data.routes && data.routes[0];
    const coords = r && r.geometry && r.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { coords: coords.concat([[dest.lng, dest.lat]]), km: r.distance / 1000, minutes: r.duration / 60 };
  }

  function cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + distanceKm(
        { lng: coords[i - 1][0], lat: coords[i - 1][1] }, { lng: coords[i][0], lat: coords[i][1] }));
    }
    return cum;
  }

  // punto a una frazione p (0..1) della lunghezza del percorso
  function alongAt(coords, cum, p) {
    const target = Math.max(0, Math.min(1, p)) * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo], k = seg > 0 ? (target - cum[lo]) / seg : 0;
    const a = coords[lo], b = coords[hi];
    const pos = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    pos.index = lo;
    return pos;
  }

  // toglie i punti superflui (Douglas-Peucker, tolleranza in metri): i rettilinei
  // restano un solo segmento, le curve restano fedeli alla strada
  function simplify(coords, tolM) {
    if (coords.length < 3) return coords;
    const kx = 111320 * Math.cos(toRad(coords[0][1])), ky = 111320;
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack = [[0, coords.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const ax = coords[s][0] * kx, ay = coords[s][1] * ky;
      const dx = coords[e][0] * kx - ax, dy = coords[e][1] * ky - ay;
      const len2 = dx * dx + dy * dy;
      let far = -1, max = tolM * tolM;
      for (let i = s + 1; i < e; i++) {
        const px = coords[i][0] * kx - ax, py = coords[i][1] * ky - ay;
        const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
        const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
        if (d2 > max) { max = d2; far = i; }
      }
      if (far > 0) { keep[far] = 1; stack.push([s, far], [far, e]); }
    }
    return coords.filter((_, i) => keep[i]);
  }

  function formatDrive(minutes) {
    let h = Math.floor(minutes / 60), m = Math.round((minutes % 60) / 5) * 5;
    if (m === 60) { h++; m = 0; }
    return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${Math.max(5, m)} min`;
  }

  /* ---------- stile mappa nei colori del sito ---------- */
  function buildStyle() {
    const label = ["coalesce", ["get", "name:it"], ["get", "name"]];
    return {
      version: 8,
      glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
      sources: {
        omt: {
          type: "vector",
          url: `${OFM}/planet`,
          attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>'
        },
        dem: {
          type: "raster-dem", tiles: [DEM], tileSize: 512, maxzoom: 14, encoding: "terrarium",
          attribution: 'Rilievo: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles</a>'
        }
      },
      // Il rilievo è reso con le ombre (hillshade), non con un terreno 3D vero e proprio:
      // è molto più leggero per i telefoni e la mappa non resta bianca mentre la rotta si disegna.
      // luce morbida: le facciate in ombra restano rosa, non grigie
      light: { anchor: "viewport", intensity: .2, color: "#fff6ec" },
      sky: {
        "sky-color": "#e9ddc8",
        "horizon-color": "#f6efe2",
        "fog-color": "#f3ebdc",
        "sky-horizon-blend": .6,
        "horizon-fog-blend": .7,
        "fog-ground-blend": .85,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, .9, 10, .6, 14, .2]
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": C.paper } },
        { id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover",
          filter: ["==", ["get", "class"], "wood"],
          paint: { "fill-color": C.wood, "fill-opacity": .9 } },
        { id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover",
          filter: ["match", ["get", "class"], ["grass", "farmland", "wetland"], true, false],
          paint: { "fill-color": C.grass, "fill-opacity": .7 } },
        { id: "landcover-sand", type: "fill", source: "omt", "source-layer": "landcover",
          filter: ["==", ["get", "class"], "sand"],
          paint: { "fill-color": "#efe2c6" } },
        { id: "landuse-town", type: "fill", source: "omt", "source-layer": "landuse",
          filter: ["match", ["get", "class"], ["residential", "suburb", "neighbourhood", "commercial", "retail"], true, false],
          paint: { "fill-color": C.paper2, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, .8] } },
        { id: "hillshade", type: "hillshade", source: "dem",
          paint: {
            "hillshade-shadow-color": "rgba(122,106,88,.55)",
            "hillshade-highlight-color": "rgba(255,253,249,.55)",
            "hillshade-accent-color": "rgba(156,95,66,.18)",
            "hillshade-exaggeration": .7
          } },
        { id: "water", type: "fill", source: "omt", "source-layer": "water",
          paint: { "fill-color": C.sea } },
        { id: "waterway", type: "line", source: "omt", "source-layer": "waterway",
          minzoom: 9, paint: { "line-color": C.seaDeep, "line-width": ["interpolate", ["linear"], ["zoom"], 9, .4, 15, 1.6] } },
        { id: "boundary-country", type: "line", source: "omt", "source-layer": "boundary",
          filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
          paint: { "line-color": "#b9a68e", "line-width": 1, "line-dasharray": [3, 2] } },
        { id: "roads-minor", type: "line", source: "omt", "source-layer": "transportation",
          minzoom: 12,
          filter: ["match", ["get", "class"], ["minor", "service", "tertiary"], true, false],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": C.panel, "line-width": ["interpolate", ["linear"], ["zoom"], 12, .6, 16, 4] } },
        { id: "roads-main", type: "line", source: "omt", "source-layer": "transportation",
          minzoom: 6,
          filter: ["match", ["get", "class"], ["primary", "secondary", "trunk"], true, false],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f8efe2", "line-width": ["interpolate", ["linear"], ["zoom"], 6, .4, 10, 1.2, 16, 6] } },
        { id: "roads-motorway", type: "line", source: "omt", "source-layer": "transportation",
          minzoom: 5,
          filter: ["==", ["get", "class"], "motorway"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": C.roseSoft, "line-width": ["interpolate", ["linear"], ["zoom"], 5, .5, 10, 1.6, 16, 7] } },
        { id: "rail", type: "line", source: "omt", "source-layer": "transportation",
          minzoom: 9, filter: ["==", ["get", "class"], "rail"],
          paint: { "line-color": "#cbb9a2", "line-width": .8, "line-dasharray": [2, 2] } },
        { id: "buildings", type: "fill-extrusion", source: "omt", "source-layer": "building",
          minzoom: 13.5,
          paint: {
            "fill-extrusion-color": "#eadcc6",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 14.5, .85]
          } },
        { id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name",
          filter: ["match", ["get", "class"], ["sea", "ocean", "bay", "gulf"], true, false],
          layout: { "text-field": label, "text-font": ["Noto Sans Italic"], "text-size": 13,
            "text-letter-spacing": .25, "text-max-width": 8 },
          paint: { "text-color": "#7f9894", "text-halo-color": "rgba(198,215,211,.7)", "text-halo-width": 1 } },
        { id: "place-village", type: "symbol", source: "omt", "source-layer": "place",
          minzoom: 11, filter: ["match", ["get", "class"], ["village", "hamlet", "suburb"], true, false],
          layout: { "text-field": label, "text-font": ["Noto Sans Regular"], "text-size": 11 },
          paint: { "text-color": C.inkSoft, "text-halo-color": C.paper, "text-halo-width": 1.4 } },
        { id: "place-town", type: "symbol", source: "omt", "source-layer": "place",
          minzoom: 7, filter: ["==", ["get", "class"], "town"],
          layout: { "text-field": label, "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 12, 13] },
          paint: { "text-color": C.ink, "text-halo-color": C.paper, "text-halo-width": 1.5 } },
        { id: "place-city", type: "symbol", source: "omt", "source-layer": "place",
          minzoom: 3, filter: ["==", ["get", "class"], "city"],
          layout: { "text-field": label, "text-font": ["Noto Sans Bold"],
            "text-transform": "uppercase", "text-letter-spacing": .12,
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 14] },
          paint: { "text-color": C.ink, "text-halo-color": C.paper, "text-halo-width": 1.6 } }
      ]
    };
  }

  /* ---------- interfaccia ---------- */
  const HEART = '<svg viewBox="0 0 32 29" aria-hidden="true"><path d="M16 28.5C7 22 1 16.2 1 9.8 1 4.9 4.8 1 9.6 1c2.7 0 5.2 1.3 6.4 3.4C17.2 2.3 19.7 1 22.4 1 27.2 1 31 4.9 31 9.8 31 16.2 25 22 16 28.5z"/></svg>';

  function buildOverlay() {
    const el = document.createElement("div");
    el.id = "volo";
    el.className = "volo";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Il vostro viaggio fino al Palazzo");
    el.innerHTML = `
      <div class="volo-map" id="voloMap"></div>
      <div class="volo-vignette"></div>
      <header class="volo-head">
        <p class="eyebrow" id="voloEyebrow">Il vostro viaggio</p>
        <h2 id="voloTitle"></h2>
        <p class="volo-sub" id="voloSub"></p>
      </header>
      <button class="volo-close" id="voloClose" aria-label="Chiudi il volo">&times;</button>
      <button class="volo-skip" id="voloSkip" type="button">Salta <span aria-hidden="true">&rsaquo;</span></button>
      <div class="volo-loading" id="voloLoading">
        <div class="volo-loading-heart">${HEART}</div>
        <p>Prepariamo il volo…</p>
      </div>
      <div class="volo-fail" id="voloFail" hidden>
        <p>Su questo dispositivo non riusciamo a mostrare il volo in 3D.</p>
        <a class="origin-btn primary" id="voloFailLink" target="_blank" rel="noopener">Apri il percorso su Google Maps</a>
      </div>
      <div class="volo-bar" id="voloBar">
        <div class="volo-actions">
          <a class="origin-btn primary" id="voloDirections" target="_blank" rel="noopener">Indicazioni stradali</a>
          <button class="origin-btn" id="voloReplay" type="button">Rivedi il volo</button>
        </div>
        <p class="volo-credits">Mappa <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · Rilievo <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles</a></p>
      </div>`;
    document.body.appendChild(el);
    return el;
  }

  function directionsUrl(origin) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(DIRECTIONS_DEST)}`;
  }

  /* ---------- stato ---------- */
  let overlay = null, map = null, raf = 0, phase = "idle", trip = null, prevOverflow = "";
  let heartMarker = null, palazzoMarker = null;

  function ui(id) { return $("#" + id, overlay); }

  function setInteractive(on) {
    if (!map) return;
    ["dragPan", "dragRotate", "scrollZoom", "boxZoom", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch"]
      .forEach(h => map[h] && (on ? map[h].enable() : map[h].disable()));
  }

  function headBottom() {
    const head = $(".volo-head", overlay);
    return head ? head.getBoundingClientRect().bottom : 0;
  }

  function collapseAttribution() {
    const a = overlay.querySelector(".maplibregl-ctrl-attrib");
    if (a) a.classList.remove("maplibregl-compact-show");
  }

  function showPalazzoMarker() {
    if (palazzoMarker) return;
    const el = document.createElement("div");
    el.className = "volo-pin";
    el.innerHTML = `<div class="volo-pin-in">
        <span class="volo-pin-label"><b>Palazzo dei Principi Lanza</b>San Nicola Arcella</span>
        <i>${HEART}</i>
      </div>`;
    palazzoMarker = new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: "1" })
      .setLngLat(palazzoCenter || [PALAZZO.lng, PALAZZO.lat]).addTo(map);
  }
  function hidePalazzoMarker() {
    if (palazzoMarker) { palazzoMarker.remove(); palazzoMarker = null; }
  }

  /* ---------- la rotta ---------- */
  function lineData(coords) {
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
  }

  function addRouteLayers() {
    map.addSource("volo-full", { type: "geojson", data: lineData(trip.full) });
    map.addSource("volo-route", { type: "geojson", data: lineData([trip.coords[0], trip.coords[0]]) });
    map.addLayer({ id: "volo-full", type: "line", source: "volo-full",
      layout: { "line-cap": "round" },
      paint: { "line-color": C.rose, "line-opacity": .45, "line-width": 1.6, "line-dasharray": [1.5, 2.5] } });
    map.addLayer({ id: "volo-glow", type: "line", source: "volo-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": C.roseSoft, "line-width": 10, "line-blur": 6, "line-opacity": .8 } });
    map.addLayer({ id: "volo-line", type: "line", source: "volo-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": C.roseDeep, "line-width": 3 } });
  }

  // la rotta si disegna dietro al cuore; a fine volo diventa il percorso completo
  let lastDraw = 0;
  function setProgress(p, force) {
    const src = map && map.getSource("volo-route");
    if (!src) return;
    if (p >= 1) return src.setData(lineData(trip.full));
    const now = performance.now();
    if (!force && now - lastDraw < 30) return;
    lastDraw = now;
    const pos = pointAt(p);
    src.setData(lineData(trip.coords.slice(0, pos.index + 1).concat([[pos[0], pos[1]]])));
  }

  const pointAt = p => alongAt(trip.coords, trip.cum, p);

  function planTrip(origin, route) {
    const km = distanceKm(origin, PALAZZO);
    const full = route ? route.coords
      : greatCircle(origin, PALAZZO, Math.max(60, Math.min(700, Math.round(km / 2))));
    // per l'animazione basta una versione alleggerita (entro ~20 m dalla strada)
    const coords = route ? simplify(full, 20) : full;
    const cum = cumulative(coords);
    const tripKm = route ? route.km : km;
    return { origin, km, full, coords, cum, road: !!route,
      duration: Math.max(6000, Math.min(13000, 4500 + tripKm * 10)) };
  }

  // Inquadratura fissa dal mare: partenza e arrivo entrambi visibili, la costa davanti.
  // Si parte da una stima e si corregge finché tutto il percorso sta nello spazio libero.
  function fitRoute() {
    const W = overlay.clientWidth, H = overlay.clientHeight;
    // margini larghi ai lati: sotto i due punti ci sono i nomi dei luoghi
    const side = Math.min(90, W * .2);
    const area = { x0: side, x1: W - side, y0: Math.round(headBottom()) + 56, y1: H - 110 };
    const pts = [];
    for (let i = 0; i <= 60; i++) pts.push(pointAt(i / 60));
    const bounds = new maplibregl.LngLatBounds();
    pts.forEach(p => bounds.extend([p[0], p[1]]));
    const zero = { top: 0, bottom: 0, left: 0, right: 0 };
    map.setPadding(zero);
    const cam = map.cameraForBounds(bounds, { bearing: SEA_BEARING, padding: 40 });
    let zoom = Math.min(12, cam ? cam.zoom + .4 : 6);
    let center = cam ? [cam.center.lng, cam.center.lat] : [pts[30][0], pts[30][1]];
    for (let i = 0; i < 40; i++) {
      map.jumpTo({ center, zoom, pitch: SEA_PITCH, bearing: SEA_BEARING, padding: zero });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(p => {
        const q = map.project([p[0], p[1]]);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      });
      const fits = x1 - x0 <= area.x1 - area.x0 && y1 - y0 <= area.y1 - area.y0;
      const dx = (x0 + x1) / 2 - (area.x0 + area.x1) / 2, dy = (y0 + y1) / 2 - (area.y0 + area.y1) / 2;
      if (fits && Math.abs(dx) < 3 && Math.abs(dy) < 3) break;
      if (!fits) zoom -= .12;
      const c = map.unproject([W / 2 + dx, H / 2 + dy]);
      center = [c.lng, c.lat];
    }
  }

  // i due capi del viaggio, con il loro nome
  let placeMarkers = [];
  function showPlaces() {
    hidePlaces();
    const make = (name, coord, cls) => {
      const el = document.createElement("div");
      el.className = "volo-place " + cls;
      el.innerHTML = `<span></span><i></i>`;
      el.firstChild.textContent = name;
      placeMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coord).addTo(map));
    };
    make(trip.origin.label, trip.coords[0], "from");
    make("San Nicola Arcella", [PALAZZO.lng, PALAZZO.lat], "to");
  }
  function hidePlaces() {
    placeMarkers.forEach(m => m.remove());
    placeMarkers = [];
  }

  /* ---------- mappa pronta prima di arrivarci ---------- */
  // Scarica in anticipo i dettagli intorno al Palazzo: quando la camera scende sono già
  // nella memoria del browser.
  let tileTemplateP = null;
  function tileTemplate() {
    if (!tileTemplateP) {
      tileTemplateP = fetch(`${OFM}/planet`).then(r => r.json()).then(j => j.tiles[0]);
      tileTemplateP.catch(() => { tileTemplateP = null; });
    }
    return tileTemplateP;
  }

  function tileOf(lng, lat, z) {
    const n = 2 ** z;
    const y = (1 - Math.asinh(Math.tan(toRad(lat))) / Math.PI) / 2 * n;
    return [Math.floor((lng + 180) / 360 * n), Math.floor(y)];
  }

  function prewarm() {
    const keys = [];
    for (let z = 9; z <= 14; z++) {
      const [x, y] = tileOf(PALAZZO.lng, PALAZZO.lat, z), r = z === 14 ? 1 : 0;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) keys.push([z, x + dx, y + dy]);
    }
    tileTemplate().then(tpl => keys.forEach(([z, x, y]) => [tpl, DEM].forEach(u =>
      fetch(u.replace("{z}", z).replace("{x}", x).replace("{y}", y)).then(r => r.arrayBuffer()).catch(() => {})
    ))).catch(() => {});
  }

  /* ---------- movimenti di camera ---------- */
  // Fotogramma per fotogramma, così ogni movimento si può interrompere in qualsiasi momento.
  function tween(to, duration, easing, done) {
    cancelAnimationFrame(raf);
    const c0 = map.getCenter(), z0 = map.getZoom(), p0 = map.getPitch(), b0 = map.getBearing(), pad0 = map.getPadding();
    const c1 = to.center || [c0.lng, c0.lat];
    const z1 = to.zoom ?? z0, p1 = to.pitch ?? p0, pad1 = to.padding || pad0;
    const db = to.bearing == null ? 0 : ((to.bearing - b0 + 540) % 360) - 180;
    // scendendo di molto, il centro si sposta in proporzione alla scala: il bersaglio resta in vista
    const dz = z1 - z0;
    const kc = k => Math.abs(dz) < .01 ? k : (1 - 2 ** (-dz * k)) / (1 - 2 ** (-dz));
    const frame = k => map.jumpTo({
      center: [c0.lng + (c1[0] - c0.lng) * kc(k), c0.lat + (c1[1] - c0.lat) * kc(k)],
      zoom: z0 + (z1 - z0) * k, pitch: p0 + (p1 - p0) * k, bearing: b0 + db * k,
      padding: {
        top: pad0.top + (pad1.top - pad0.top) * k, bottom: pad0.bottom + (pad1.bottom - pad0.bottom) * k,
        left: pad0.left + (pad1.left - pad0.left) * k, right: pad0.right + (pad1.right - pad0.right) * k
      }
    });
    if (reduceMotion || !duration) { frame(1); done && done(); return; }
    const t0 = performance.now();
    const step = now => {
      if (!map) return;
      // il tempo del fotogramma può precedere di un soffio quello di partenza
      const t = Math.max(0, Math.min(1, (now - t0) / duration));
      frame(easing(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else done && done();
    };
    raf = requestAnimationFrame(step);
  }

  // l'inquadratura finale: il Palazzo al centro dello spazio libero tra titolo e pulsanti
  function finalView() {
    const bar = ui("voloBar");
    return {
      center: [PALAZZO.lng, PALAZZO.lat], zoom: 17.5, pitch: 60,
      padding: { top: Math.round(headBottom()) + 10, bottom: overlay.clientHeight - bar.offsetTop + 10, left: 0, right: 0 }
    };
  }

  function fly() {
    phase = "flight";
    setInteractive(false);
    removePalazzo();
    hidePalazzoMarker();
    ui("voloBar").classList.remove("show");
    overlay.classList.remove("arrived");
    ui("voloSkip").classList.add("show");
    ui("voloEyebrow").textContent = "Il vostro viaggio";
    collapseAttribution();

    cancelAnimationFrame(raf);
    fitRoute();
    showPlaces();
    setProgress(0, true);
    if (!heartMarker) heartMarker = new maplibregl.Marker({ element: makeHeart(), anchor: "center" });
    heartMarker.setLngLat(trip.coords[0]).addTo(map);

    // la camera resta ferma: si muove solo il cuore, che disegna la strada
    const t0 = performance.now() + 900;
    const step = now => {
      if (phase !== "flight") return;
      const t = Math.max(0, Math.min(1, (now - t0) / trip.duration));
      const s = easeSine(t);
      setProgress(s, t >= 1);
      heartMarker.setLngLat(pointAt(s));
      if (t < 1) raf = requestAnimationFrame(step);
      else setTimeout(() => { if (phase === "flight") arrive(); }, 500);
    };
    raf = requestAnimationFrame(step);
  }

  function makeHeart() {
    const el = document.createElement("div");
    el.className = "volo-heart";
    el.innerHTML = HEART;
    return el;
  }

  function arrive() {
    phase = "arrive";
    ui("voloEyebrow").textContent = "Benvenuti in Calabria";
    setProgress(1);
    heartMarker && heartMarker.remove();
    hidePlaces();
    const view = finalView();
    // dalla veduta d'insieme giù fino al Palazzo
    tween({ ...view, bearing: VIEW_BEARING + 14 }, 6500, easeInOut, () => {
      // aspetta un attimo i dettagli degli edifici, poi il Palazzo sorge mentre la camera gli gira intorno
      const since = performance.now();
      const wait = () => {
        if (phase !== "arrive" || !map) return;
        if (!palazzoFootprint() && performance.now() - since < 3500) return setTimeout(wait, 250);
        raisePalazzo(true);
        tween({ bearing: VIEW_BEARING + 60 }, 4600, t => t, () => { if (phase === "arrive") settle(); });
      };
      wait();
    });
  }

  // fine del viaggio: resta solo il Palazzo, che gira lentamente finché non si tocca la mappa
  function settle(instant) {
    phase = "arrived";
    cancelAnimationFrame(raf);
    ui("voloSkip").classList.remove("show");
    ui("voloEyebrow").textContent = "Benvenuti in Calabria";
    setProgress(1);
    heartMarker && heartMarker.remove();
    hidePlaces();
    ui("voloBar").classList.add("show");
    overlay.classList.add("arrived");
    collapseAttribution();
    if (instant) map.jumpTo({ ...finalView(), bearing: VIEW_BEARING + 60 });
    raisePalazzo(false);
    showPalazzoMarker();
    setInteractive(true);
    if (reduceMotion) return;
    let last = 0;
    const orbit = now => {
      if (phase !== "arrived" || !map) return;
      if (last) map.jumpTo({ center: palazzoCenter || [PALAZZO.lng, PALAZZO.lat], bearing: map.getBearing() + (now - last) * .004 });
      last = now;
      raf = requestAnimationFrame(orbit);
    };
    raf = requestAnimationFrame(orbit);
  }

  function skip() {
    if (phase !== "flight" && phase !== "arrive") return;
    settle(true);
  }

  /* ---------- il Palazzo che sorge in 3D ---------- */
  // Un modello fatto a mano: quattro ali intorno al cortile, tetto in coppi, due ordini di
  // finestre, portale e loggia a tre archi. Posizione, misure e orientamento vengono dalla
  // pianta reale dell'edificio sulla mappa (OpenStreetMap), quando c'è.
  const PARTS = [
    { part: "court",  color: C.court,   base: 0,    height: .15 },
    { part: "walls",  color: C.wall,    base: 0,    height: 10.4 },
    { part: "eaves",  color: C.eaves,   base: 10.4, height: 10.9 },
    { part: "roof1",  color: C.roof,    base: 10.9, height: 11.6 },
    { part: "roof2",  color: C.roof,    base: 11.6, height: 12.2 },
    { part: "roof3",  color: C.eaves,   base: 12.2, height: 12.6 },
    { part: "win0",   color: C.shutter, base: 1.4,  height: 3.6 },
    { part: "win1",   color: C.shutter, base: 5.6,  height: 8.6 },
    { part: "portal", color: C.portal,  base: 0,    height: 4.6 },
    { part: "arches", color: C.portal,  base: 5.6,  height: 9.2 }
  ];
  let palazzoState = null, palazzoCenter = null;

  const KY = 111320, kxAt = lat => 111320 * Math.cos(toRad(lat));

  function ringCentroid(ring) {
    let x = 0, y = 0;
    ring.forEach(c => { x += c[0]; y += c[1]; });
    return [x / ring.length, y / ring.length];
  }
  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // pianta reale dell'edificio, dai dati della mappa già caricati: centro, lati e orientamento
  function palazzoFootprint() {
    const P = [PALAZZO.lng, PALAZZO.lat];
    let feats = [];
    try { feats = map.querySourceFeatures("omt", { sourceLayer: "building" }); } catch {}
    let best = null, bestD = Infinity, bestId = null;
    feats.forEach(f => {
      const g = f.geometry || {};
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      polys.forEach(poly => {
        const ring = poly[0];
        if (!ring || ring.length < 4) return;
        const c = ringCentroid(ring);
        const d = pointInRing(P, ring) ? 0 : distanceKm({ lng: P[0], lat: P[1] }, { lng: c[0], lat: c[1] }) * 1000;
        if (d < bestD) { bestD = d; best = ring; bestId = f.id; }
      });
    });
    if (!best || bestD > 35) return null;

    // rettangolo orientato: l'asse è quello del lato più lungo della pianta
    const kx = kxAt(PALAZZO.lat), c = ringCentroid(best);
    const pts = best.map(p => [(p[0] - c[0]) * kx, (p[1] - c[1]) * KY]);
    let angle = 0, longest = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], len = Math.hypot(dx, dy);
      if (len > longest) { longest = len; angle = Math.atan2(dy, dx); }
    }
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => {
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry);
    });
    let L = x1 - x0, W = y1 - y0;
    // centro del rettangolo, riportato in coordinate geografiche
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const center = [c[0] + (mx * Math.cos(angle) - my * Math.sin(angle)) / kx, c[1] + (mx * Math.sin(angle) + my * Math.cos(angle)) / KY];
    if (W > L) { [L, W] = [W, L]; angle += Math.PI / 2; }
    if (W < 22 || L > 120) return null;   // non è il Palazzo
    return { center, L, W, angle, id: bestId };
  }

  function palazzoModel(fp) {
    const { center, L, W, angle } = fp, kx = kxAt(center[1]);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const geo = ([x, y]) => [center[0] + (x * cos - y * sin) / kx, center[1] + (x * sin + y * cos) / KY];
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(geo);
    const feats = [];
    const add = (part, rings) => feats.push({ type: "Feature", properties: { part }, geometry: { type: "Polygon", coordinates: rings } });

    const hl = L / 2, hw = W / 2, d = Math.min(9.5, W * .26);   // profondità delle ali
    const ring = (out, inn) => [rect(-hl - out, -hw - out, hl + out, hw + out), rect(-hl + d - inn, -hw + d - inn, hl - d + inn, hw - d + inn).reverse()];
    add("court", [rect(-hl + d, -hw + d, hl - d, hw - d)]);
    add("walls", ring(0, 0));
    add("eaves", ring(.55, .45));
    add("roof1", ring(-d * .12, -d * .12));
    add("roof2", ring(-d * .26, -d * .26));
    add("roof3", ring(-d * .40, -d * .40));

    // finestre: piccoli volumi scuri appena sporgenti dalle facciate
    const out = .32, ww = .7;
    const spread = (len, step) => {
      const n = Math.max(3, Math.round(len / step));
      return Array.from({ length: n }, (_, i) => -len / 2 + len * (i + .5) / n);
    };
    spread(L, 5.6).forEach(x => [-1, 1].forEach(side => {
      const y = side * hw, r = rect(x - ww, Math.min(y, y + side * out), x + ww, Math.max(y, y + side * out));
      add("win0", [r]); add("win1", [r]);
    }));
    // lati corti: al centro il portale e, sopra, la loggia a tre archi
    spread(W, 5.4).forEach(y => [-1, 1].forEach(side => {
      if (Math.abs(y) < 5.2) return;
      const x = side * hl, r = rect(Math.min(x, x + side * out), y - ww, Math.max(x, x + side * out), y + ww);
      add("win0", [r]); add("win1", [r]);
    }));
    [-1, 1].forEach(side => {
      const x = side * hl, xa = Math.min(x, x + side * .45), xb = Math.max(x, x + side * .45);
      add("portal", [rect(xa, -1.8, xb, 1.8)]);
      [-2.7, 0, 2.7].forEach(y => add("arches", [rect(xa, y - .95, xb, y + .95)]));
    });
    return { type: "FeatureCollection", features: feats };
  }

  function raisePalazzo(animate) {
    if (!map) return;
    const found = palazzoFootprint();
    const fp = found || { center: [PALAZZO.lng, PALAZZO.lat], L: 52, W: 40, angle: 0, id: null };
    const state = found ? "real" : "fallback";
    if (found || !palazzoCenter) palazzoCenter = fp.center;
    // l'edificio "normale" della mappa lascia il posto al modello
    if (found && found.id != null && map.getLayer("buildings")) map.setFilter("buildings", ["!=", ["id"], found.id]);

    if (map.getSource("volo-palazzo")) {
      if (state === "real" && palazzoState !== "real") {
        map.getSource("volo-palazzo").setData(palazzoModel(fp));
        if (palazzoMarker) palazzoMarker.setLngLat(fp.center);
        palazzoState = overlay.dataset.palazzo = "real";
      }
      return;
    }
    palazzoState = overlay.dataset.palazzo = state;
    const grow = animate && !reduceMotion;
    map.addSource("volo-palazzo", { type: "geojson", data: palazzoModel(fp) });
    PARTS.forEach(p => map.addLayer({
      id: "volo-palazzo-" + p.part, type: "fill-extrusion", source: "volo-palazzo",
      filter: ["==", ["get", "part"], p.part],
      paint: {
        "fill-extrusion-color": p.color,
        "fill-extrusion-height": grow ? 0 : p.height,
        "fill-extrusion-base": grow ? 0 : p.base,
        "fill-extrusion-vertical-gradient": false,
        "fill-extrusion-height-transition": { duration: 2600, delay: 0 },
        "fill-extrusion-base-transition": { duration: 2600, delay: 0 }
      }
    }));
    if (grow) {
      requestAnimationFrame(() => PARTS.forEach(p => {
        const id = "volo-palazzo-" + p.part;
        if (!map || !map.getLayer(id)) return;
        map.setPaintProperty(id, "fill-extrusion-height", p.height);
        map.setPaintProperty(id, "fill-extrusion-base", p.base);
      }));
    }
  }

  function removePalazzo() {
    if (map && map.getSource("volo-palazzo")) {
      PARTS.forEach(p => map.getLayer("volo-palazzo-" + p.part) && map.removeLayer("volo-palazzo-" + p.part));
      map.removeSource("volo-palazzo");
      if (map.getLayer("buildings")) map.setFilter("buildings", null);
    }
    palazzoState = palazzoCenter = null;
    if (overlay) delete overlay.dataset.palazzo;
  }

  /* ---------- apertura e chiusura ---------- */
  function showFail() {
    phase = "fail";
    ui("voloLoading").classList.remove("show");
    ui("voloSkip").classList.remove("show");
    ui("voloFail").hidden = false;
  }

  function close() {
    if (!overlay || !overlay.classList.contains("open")) return;
    phase = "idle";
    cancelAnimationFrame(raf);
    hidePlaces();
    if (heartMarker) { heartMarker.remove(); heartMarker = null; }
    hidePalazzoMarker();
    if (map) { try { map.remove(); } catch {} map = null; }
    palazzoState = palazzoCenter = null;
    delete overlay.dataset.palazzo;
    overlay.classList.remove("open", "arrived");
    ["voloBar", "voloSkip", "voloLoading"].forEach(id => ui(id).classList.remove("show"));
    document.body.style.overflow = prevOverflow;
    if (trip && trip.returnFocus && trip.returnFocus.focus) trip.returnFocus.focus();
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = buildOverlay();
    ui("voloClose").addEventListener("click", close);
    ui("voloSkip").addEventListener("click", skip);
    ui("voloReplay").addEventListener("click", () => { if (map && trip && phase === "arrived") fly(); });
    addEventListener("keydown", e => {
      if (e.key === "Escape" && overlay.classList.contains("open")) {
        e.stopPropagation();
        close();
      }
    }, true);
  }

  async function start({ origin, directionsFrom, returnFocus }) {
    ensureOverlay();
    trip = null;
    ui("voloFail").hidden = true;
    ui("voloFailLink").href = directionsUrl(directionsFrom);
    ui("voloDirections").href = directionsUrl(directionsFrom);
    ui("voloBar").classList.remove("show");
    overlay.classList.remove("arrived");
    ui("voloSkip").classList.remove("show");
    ui("voloLoading").classList.add("show");
    ui("voloEyebrow").textContent = "Il vostro viaggio";
    ui("voloTitle").innerHTML = `Da ${escapeHtml(origin.label)}<br><em>a San Nicola Arcella</em>`;

    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.classList.add("open");
    ui("voloClose").focus({ preventScroll: true });
    phase = "loading";

    const km = distanceKm(origin, PALAZZO);
    ui("voloSub").textContent = km < 3
      ? "Siete già praticamente arrivati"
      : `${Math.round(km).toLocaleString("it-IT")} km in linea d'aria`;

    try {
      if (!supportsWebGL()) throw new Error("no webgl");
      const routeP = km < 3 ? Promise.resolve(null) : fetchRoute(origin, PALAZZO).catch(() => null);
      const ml = await withTimeout(loadMapLibre(), 15000, "maplibre");
      const route = await routeP;
      if (phase !== "loading") return;
      if (route) {
        ui("voloSub").textContent =
          `${Math.round(route.km).toLocaleString("it-IT")} km di strada · circa ${formatDrive(route.minutes)} in auto`;
      }
      trip = planTrip(origin, route);
      trip.returnFocus = returnFocus;
      const still = reduceMotion || km < 3;
      prewarm();
      map = new ml.Map({
        container: ui("voloMap"),
        style: buildStyle(),
        center: trip.coords[0], zoom: 6, pitch: SEA_PITCH, bearing: SEA_BEARING,
        maxPitch: 75,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        attributionControl: false,
        fadeDuration: 150
      });
      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");
      map.on("error", e => console.warn("[volo]", e && e.error ? e.error.message : e));
      // se l'ospite muove la mappa con le dita, il giro automatico si ferma
      map.on("movestart", e => { if (e.originalEvent && phase === "arrived") cancelAnimationFrame(raf); });
      // se all'inizio c'era solo il modello "di riserva", appena arrivano i dati si passa alla pianta vera
      map.on("idle", () => { if (map && palazzoState === "fallback") raisePalazzo(false); });
      // basta che lo stile sia pronto: le tessere arrivano mentre il volo parte
      await withTimeout(new Promise(res => map.once("styledata", res)), 20000, "style");
      if (phase !== "loading") return;
      addRouteLayers();
      // l'inquadratura è già quella del viaggio: si aspetta che la mappa sia tutta disegnata
      if (!still) fitRoute();
      await withTimeout(new Promise(res => map.once("idle", res)), 7000, "idle").catch(() => {});
      if (phase !== "loading") return;
      ui("voloLoading").classList.remove("show");
      if (still) settle(true);
      else fly();
    } catch (err) {
      console.warn("[volo] fallback:", err && err.message);
      if (overlay.classList.contains("open")) showFail();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- API usata da app.js ---------- */
  window.Volo = {
    supported: supportsWebGL,
    preload() { if (supportsWebGL()) { loadMapLibre().catch(() => {}); tileTemplate().catch(() => {}); } },
    async fromQuery(query, opts = {}) {
      const place = await geocode(query);
      if (!place) return { found: false };
      start({ origin: place, directionsFrom: query, returnFocus: opts.returnFocus });
      return { found: true, label: place.label };
    },
    async fromCoords(lat, lng, opts = {}) {
      const name = await reverseName(lat, lng);
      start({
        origin: { lat, lng, label: name || "casa vostra" },
        directionsFrom: `${lat},${lng}`,
        returnFocus: opts.returnFocus
      });
    },
    close
  };
})();
