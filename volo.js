/* ===================================================================
   Arrivo in volo 3D
   "Da dove parti?" diventa un volo animato dalla città dell'ospite
   fino al Palazzo, con la panoramica dei tre luoghi del weekend.
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

  const PLACES = {
    beach: {
      lng: 15.78476, lat: 39.87663,
      when: "Sab 3 luglio · 20:00",
      title: "Pizza Party",
      place: "Budda Beach, Praia a Mare",
      maps: "https://www.google.com/maps/search/?api=1&query=Budda%20Beach%2C%20Contrada%20Fiuzzi%2C%2087028%20Praia%20a%20Mare%20%28CS%29"
    },
    chiesa: {
      lng: 15.82330, lat: 39.71660,
      when: "Dom 4 luglio · 16:30",
      title: "Cerimonia",
      place: "Convento dei Minimi, Cirella",
      maps: "https://www.google.com/maps/search/?api=1&query=Chiesa%20Santa%20Maria%20delle%20Grazie%2C%20Convento%20dei%20Minimi%20di%20San%20Francesco%2C%2087023%20Cirella%20di%20Diamante%20%28CS%29"
    },
    palazzo: {
      lng: 15.78241, lat: 39.84513,
      when: "Dom 4 luglio · 18:30",
      title: "Ricevimento",
      place: "Palazzo dei Principi Lanza",
      maps: "https://www.google.com/maps/search/?api=1&query=Palazzo%20dei%20Principi%20Lanza%20di%20Trabia%2C%20Corso%20Principi%20Lanza%20di%20Trabia%2C%2087020%20San%20Nicola%20Arcella%20%28CS%29"
    }
  };
  const STOP_ORDER = ["beach", "chiesa", "palazzo"];
  // la costa guarda a ovest: inquadriamo dal mare verso le colline, così niente copre i luoghi
  const VIEW_BEARING = 78;

  const C = {
    paper: "#f3ebdc", paper2: "#efe4d0", panel: "#fffdf9",
    ink: "#46392d", inkSoft: "#7a6a58",
    rose: "#c1815f", roseDeep: "#9c5f42", roseSoft: "#e6c4ae",
    sage: "#8a9873", wood: "#dfe2cc", grass: "#e7e6d1",
    sea: "#c6d7d3", seaDeep: "#b4c9c5"
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
          type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium",
          attribution: 'Rilievo: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles</a>'
        },
        demShade: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium" }
      },
      terrain: { source: "dem", exaggeration: 1.45 },
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
        { id: "hillshade", type: "hillshade", source: "demShade",
          paint: {
            "hillshade-shadow-color": "rgba(122,106,88,.55)",
            "hillshade-highlight-color": "rgba(255,253,249,.55)",
            "hillshade-accent-color": "rgba(156,95,66,.18)",
            "hillshade-exaggeration": .55
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
      <section class="volo-card" id="voloCard" aria-label="Il vostro weekend">
        <p class="eyebrow">Il vostro weekend</p>
        <ol class="volo-stops" id="voloStops"></ol>
        <div class="volo-actions">
          <a class="origin-btn primary" id="voloDirections" target="_blank" rel="noopener">Indicazioni stradali</a>
          <button class="origin-btn" id="voloReplay" type="button">Rivedi il volo</button>
        </div>
        <p class="volo-credits">Mappa <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · Rilievo <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles</a></p>
      </section>`;
    document.body.appendChild(el);

    const stops = $("#voloStops", el);
    STOP_ORDER.forEach(key => {
      const p = PLACES[key];
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="volo-num" aria-hidden="true">${STOP_ORDER.indexOf(key) + 1}</span>
        <button type="button" class="volo-stop" data-stop="${key}">
          <span class="volo-when">${p.when}</span>
          <span class="volo-what">${p.title}<small>${p.place}</small></span>
        </button>
        <a class="volo-maplink" href="${p.maps}" target="_blank" rel="noopener" aria-label="${p.place} su Google Maps">Mappa</a>`;
      stops.appendChild(li);
    });
    return el;
  }

  function directionsUrl(origin) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(DIRECTIONS_DEST)}`;
  }

  /* ---------- il volo ---------- */
  let overlay = null, map = null, raf = 0, phase = "idle", trip = null, prevOverflow = "";
  let heartMarker = null, stopMarkers = [];

  function ui(id) { return $("#" + id, overlay); }

  function setInteractive(on) {
    if (!map) return;
    ["dragPan", "dragRotate", "scrollZoom", "boxZoom", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch"]
      .forEach(h => map[h] && (on ? map[h].enable() : map[h].disable()));
  }

  function headPadding() {
    const head = $(".volo-head", overlay);
    return head ? head.getBoundingClientRect().bottom : 0;
  }

  function makeHeart() {
    const el = document.createElement("div");
    el.className = "volo-heart";
    el.innerHTML = HEART;
    return el;
  }

  function makePin(key, n) {
    const p = PLACES[key];
    const el = document.createElement("div");
    el.className = "volo-pin" + (key === "palazzo" ? " main" : "");
    el.dataset.stop = key;
    el.innerHTML = `<div class="volo-pin-in">
        <span class="volo-pin-label"><b>${p.title}</b>${p.when}</span>
        <i>${key === "palazzo" ? HEART : ""}<em>${n}</em></i>
      </div>`;
    el.addEventListener("click", e => { e.stopPropagation(); focusStop(key); });
    return el;
  }

  function setActiveStop(key) {
    stopMarkers.forEach(m => {
      const el = m.getElement();
      el.classList.toggle("active", el.dataset.stop === key);
    });
    overlay.querySelectorAll(".volo-stop").forEach(b => b.classList.toggle("active", b.dataset.stop === key));
  }

  function collapseAttribution() {
    const a = overlay.querySelector(".maplibregl-ctrl-attrib");
    if (a) a.classList.remove("maplibregl-compact-show");
  }

  function clearStops() {
    stopMarkers.forEach(m => m.remove());
    stopMarkers = [];
  }

  function showStops() {
    clearStops();
    STOP_ORDER.forEach((key, i) => {
      const el = makePin(key, i + 1);
      el.firstElementChild.style.animationDelay = (i * 160) + "ms";
      stopMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: "1" })
        .setLngLat([PLACES[key].lng, PLACES[key].lat]).addTo(map));
    });
  }

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
    if (!force && now - lastDraw < 50) return;
    lastDraw = now;
    const pos = pointAt(p);
    src.setData(lineData(trip.coords.slice(0, pos.index + 1).concat([[pos[0], pos[1]]])));
  }

  const pointAt = p => alongAt(trip.coords, trip.cum, p);
  // Movimento di camera fotogramma per fotogramma: così la quota del terreno sotto il
  // centro viene ricalcolata di continuo e l'inquadratura resta precisa anche in 3D.
  function tween(to, duration, easing, done) {
    cancelAnimationFrame(raf);
    const c0 = map.getCenter(), z0 = map.getZoom(), p0 = map.getPitch(), b0 = map.getBearing(), pad0 = map.getPadding();
    const c1 = to.center || [c0.lng, c0.lat];
    const z1 = to.zoom ?? z0, p1 = to.pitch ?? p0, pad1 = to.padding || pad0;
    const db = to.bearing == null ? 0 : ((to.bearing - b0 + 540) % 360) - 180;
    const frame = k => map.jumpTo({
      center: [c0.lng + (c1[0] - c0.lng) * k, c0.lat + (c1[1] - c0.lat) * k],
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

  function planTrip(origin, route) {
    const dest = PLACES.palazzo;
    const km = distanceKm(origin, dest);
    const full = route ? route.coords
      : greatCircle(origin, dest, Math.max(60, Math.min(700, Math.round(km / 2))));
    // per l'animazione basta una versione alleggerita (entro ~20 m dalla strada)
    const coords = route ? simplify(full, 20) : full;
    const cum = cumulative(coords);
    const w = Math.max(320, overlay.clientWidth || innerWidth);
    const midLat = (origin.lat + dest.lat) / 2;
    // zoom alla quale la tratta occupa circa metà della larghezza dello schermo
    const zFit = Math.log2(156543 * Math.cos(toRad(midLat)) * w / Math.max(1, km * 1000 * .55));
    const zStart = 11, zEnd = 13.2;
    // seguendo le strade si resta un po' più bassi, così il percorso si legge
    const zMid = Math.max(3, Math.min(zFit + (route ? 1 : 0), 10.5));
    const arc = Math.max(0, (zStart + zEnd) / 2 - zMid);
    const tripKm = route ? route.km : km;
    const duration = Math.max(8000, Math.min(18000, 7000 + tripKm * 8));
    return { origin, km, full, coords, cum, zStart, zEnd, arc, duration, road: !!route,
      bearing: bearingDeg(coords[0], alongAt(coords, cum, .03)) };
  }

  function fly() {
    phase = "flight";
    setInteractive(false);
    clearStops();
    removePalazzo();
    ui("voloCard").classList.remove("show");
    overlay.classList.remove("has-card");
    ui("voloSkip").classList.add("show");
    ui("voloEyebrow").textContent = "Il vostro viaggio";
    collapseAttribution();

    setProgress(0, true);
    if (!heartMarker) heartMarker = new maplibregl.Marker({ element: makeHeart(), anchor: "center", opacityWhenCovered: "1" });
    heartMarker.setLngLat(trip.coords[0]).addTo(map);

    const top = headPadding();
    map.setPadding({ top: Math.round(top * .6), bottom: 0, left: 0, right: 0 });
    let bearing = trip.bearing;
    // la camera insegue il cuore con un filo di ritardo: la strada curva, la ripresa resta fluida
    let cam = trip.coords[0].slice(0, 2), last = 0;
    map.jumpTo({ center: cam, zoom: trip.zStart, pitch: 48, bearing });

    // breve pausa sulla città di partenza prima del decollo
    const hold = 900;
    const t0 = performance.now() + hold;
    cancelAnimationFrame(raf);
    const step = now => {
      if (phase !== "flight") return;
      const t = Math.max(0, Math.min(1, (now - t0) / trip.duration));
      const p = easeSine(t);
      const pos = pointAt(p);
      setProgress(p);
      heartMarker.setLngLat(pos);

      const k = last ? 1 - Math.exp(-(now - last) / 260) : 0;
      last = now;
      cam = [cam[0] + (pos[0] - cam[0]) * k, cam[1] + (pos[1] - cam[1]) * k];
      // direzione di marcia su un tratto lungo, così i tornanti non fanno girare la testa
      if (p < .97) bearing = lerpAngle(bearing, bearingDeg(pointAt(p - .03), pointAt(p + .03)), .04);
      const zoom = trip.zStart + (trip.zEnd - trip.zStart) * p - trip.arc * Math.sin(Math.PI * p);
      const pitch = 48 + 14 * Math.sin(Math.PI * Math.min(1, p * 1.2));
      map.jumpTo({ center: cam, zoom, pitch, bearing });

      if (t < 1) raf = requestAnimationFrame(step);
      else arrive();
    };
    raf = requestAnimationFrame(step);
  }

  /* ---------- il Palazzo che sorge in 3D ---------- */
  let palazzoState = null;

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

  // pianta reale dell'edificio, presa dai dati della mappa già caricati
  function palazzoFootprint() {
    const P = [PLACES.palazzo.lng, PLACES.palazzo.lat];
    let feats = [];
    try { feats = map.querySourceFeatures("omt", { sourceLayer: "building" }); } catch {}
    let best = null, bestD = Infinity, bestH = 0;
    feats.forEach(f => {
      const g = f.geometry || {};
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      polys.forEach(poly => {
        const ring = poly[0];
        if (!ring || ring.length < 4) return;
        const c = ringCentroid(ring);
        const d = pointInRing(P, ring) ? 0 : distanceKm({ lng: P[0], lat: P[1] }, { lng: c[0], lat: c[1] }) * 1000;
        if (d < bestD) { bestD = d; best = ring; bestH = +(f.properties && f.properties.render_height) || 0; }
      });
    });
    return best && bestD <= 35 ? { ring: best, h: bestH } : null;
  }

  // se la mappa non ha la pianta, un volume semplice nel punto del Palazzo
  function palazzoFallback() {
    const { lng, lat } = PLACES.palazzo;
    const dy = 12 / 111320, dx = 19 / (111320 * Math.cos(toRad(lat)));
    return { ring: [[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]], h: 0 };
  }

  function palazzoData(fp) {
    // leggermente più largo della pianta, così copre l'edificio "normale" sotto
    const c = ringCentroid(fp.ring);
    const ring = fp.ring.map(p => [c[0] + (p[0] - c[0]) * 1.06, c[1] + (p[1] - c[1]) * 1.06]);
    return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
  }

  function raisePalazzo(animate) {
    if (!map) return;
    const found = palazzoFootprint();
    if (map.getLayer("volo-palazzo")) {
      if (found && palazzoState !== "real") {
        map.getSource("volo-palazzo").setData(palazzoData(found));
        palazzoState = overlay.dataset.palazzo = "real";
      }
      return;
    }
    const fp = found || palazzoFallback();
    palazzoState = overlay.dataset.palazzo = found ? "real" : "fallback";
    const height = Math.max(14, (fp.h || 0) + 5);
    map.addSource("volo-palazzo", { type: "geojson", data: palazzoData(fp) });
    map.addLayer({ id: "volo-palazzo", type: "fill-extrusion", source: "volo-palazzo",
      paint: {
        "fill-extrusion-color": C.rose,
        "fill-extrusion-height": animate && !reduceMotion ? 0 : height,
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": .96,
        "fill-extrusion-height-transition": { duration: 2400, delay: 0 }
      } });
    if (animate && !reduceMotion) {
      requestAnimationFrame(() => {
        if (map && map.getLayer("volo-palazzo")) map.setPaintProperty("volo-palazzo", "fill-extrusion-height", height);
      });
    }
  }

  function removePalazzo() {
    if (map && map.getLayer("volo-palazzo")) { map.removeLayer("volo-palazzo"); map.removeSource("volo-palazzo"); }
    palazzoState = null;
    if (overlay) delete overlay.dataset.palazzo;
  }

  function arrive() {
    phase = "arrive";
    ui("voloEyebrow").textContent = "Benvenuti in Calabria";
    setProgress(1);
    heartMarker && heartMarker.remove();
    showStops();
    setActiveStop("palazzo");
    const center = [PLACES.palazzo.lng, PLACES.palazzo.lat];
    tween({ center, zoom: 17.1, pitch: 62, bearing: VIEW_BEARING + 14 }, 4600, easeInOut, () => {
      // aspetta un attimo i dettagli degli edifici, poi il Palazzo sorge mentre la camera gli gira intorno
      const since = performance.now();
      const wait = () => {
        if (phase !== "arrive" || !map) return;
        if (!palazzoFootprint() && performance.now() - since < 3500) return setTimeout(wait, 250);
        raisePalazzo(true);
        tween({ bearing: VIEW_BEARING + 52 }, 4200, t => t, () => { if (phase === "arrive") overview(); });
      };
      wait();
    });
  }

  // la parte di mappa non coperta da intestazione e scheda finale
  function freePadding(extra = 0) {
    const card = ui("voloCard");
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const top = Math.round(headPadding()) + 30 + extra;
    const cardRight = card.offsetLeft + card.offsetWidth;
    if (cardRight < W * .55) {
      // scheda sul lato sinistro (schermi larghi)
      return { top, bottom: 50 + extra, left: cardRight + 40 + extra, right: 50 + extra };
    }
    return { top, bottom: H - card.offsetTop + 24 + extra, left: 36 + extra, right: 36 + extra };
  }

  function overview(instant) {
    phase = "overview";
    cancelAnimationFrame(raf);
    ui("voloSkip").classList.remove("show");
    ui("voloEyebrow").textContent = "Benvenuti in Calabria";
    setProgress(1);
    heartMarker && heartMarker.remove();
    if (!stopMarkers.length) showStops();
    raisePalazzo(false);
    setActiveStop(null);
    collapseAttribution();

    const card = ui("voloCard");
    card.classList.add("show");
    overlay.classList.add("has-card");
    const bounds = new maplibregl.LngLatBounds();
    STOP_ORDER.forEach(k => bounds.extend([PLACES[k].lng, PLACES[k].lat]));
    const zero = { top: 0, bottom: 0, left: 0, right: 0 }, padNow = map.getPadding();
    map.setPadding(zero);
    const cam = map.cameraForBounds(bounds, { padding: freePadding(14), bearing: VIEW_BEARING, pitch: 0 });
    map.setPadding(padNow);
    const target = cam
      ? { center: [cam.center.lng, cam.center.lat], zoom: Math.min(13, cam.zoom - .15) }
      : { center: [15.80, 39.80], zoom: 10.2 };
    tween({ ...target, bearing: VIEW_BEARING, pitch: 44, padding: zero },
      instant ? 0 : 2600, easeInOut);
    setInteractive(true);
  }

  function focusStop(key) {
    if (phase !== "overview" || !map) return;
    const p = PLACES[key];
    setActiveStop(key);
    tween({
      center: [p.lng, p.lat], zoom: key === "palazzo" ? 17 : 15, pitch: 62,
      bearing: VIEW_BEARING - 8, padding: freePadding()
    }, 2200, easeInOut);
  }

  function skip() {
    if (phase !== "flight" && phase !== "arrive") return;
    cancelAnimationFrame(raf);
    overview(true);
  }

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
    clearStops();
    if (heartMarker) { heartMarker.remove(); heartMarker = null; }
    if (map) { try { map.remove(); } catch {} map = null; }
    palazzoState = null;
    delete overlay.dataset.palazzo;
    overlay.classList.remove("open", "has-card", "near");
    ["voloCard", "voloSkip", "voloLoading"].forEach(id => ui(id).classList.remove("show"));
    document.body.style.overflow = prevOverflow;
    if (trip && trip.returnFocus && trip.returnFocus.focus) trip.returnFocus.focus();
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = buildOverlay();
    ui("voloClose").addEventListener("click", close);
    ui("voloSkip").addEventListener("click", skip);
    ui("voloReplay").addEventListener("click", () => { if (map && trip) fly(); });
    overlay.addEventListener("click", e => {
      const b = e.target.closest(".volo-stop");
      if (b) focusStop(b.dataset.stop);
    });
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
    ui("voloCard").classList.remove("show");
    overlay.classList.remove("has-card");
    ui("voloSkip").classList.remove("show");
    ui("voloLoading").classList.add("show");
    ui("voloTitle").innerHTML = `Da ${escapeHtml(origin.label)}<br><em>a San Nicola Arcella</em>`;

    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.classList.add("open");
    ui("voloClose").focus({ preventScroll: true });
    phase = "loading";

    const km = distanceKm(origin, PLACES.palazzo);
    ui("voloSub").textContent = km < 3
      ? "Siete già praticamente arrivati"
      : `${Math.round(km).toLocaleString("it-IT")} km in linea d'aria`;

    try {
      if (!supportsWebGL()) throw new Error("no webgl");
      const routeP = km < 3 ? Promise.resolve(null) : fetchRoute(origin, PLACES.palazzo).catch(() => null);
      const ml = await withTimeout(loadMapLibre(), 15000, "maplibre");
      const route = await routeP;
      if (phase !== "loading") return;
      if (route) {
        ui("voloSub").textContent =
          `${Math.round(route.km).toLocaleString("it-IT")} km di strada · circa ${formatDrive(route.minutes)} in auto`;
      }
      trip = planTrip(origin, route);
      trip.returnFocus = returnFocus;
      map = new ml.Map({
        container: ui("voloMap"),
        style: buildStyle(),
        center: trip.coords[0], zoom: trip.zStart, pitch: 48, bearing: trip.bearing,
        maxPitch: 75,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        attributionControl: false,
        fadeDuration: 150
      });
      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");
      map.on("error", e => console.warn("[volo]", e && e.error ? e.error.message : e));
      // se all'inizio c'era solo il volume semplice, appena arrivano i dati si passa alla pianta vera
      // da vicino il cuore del Palazzo si alza, per lasciar vedere l'edificio
      map.on("zoom", () => overlay.classList.toggle("near", map.getZoom() > 15.5));
      // se l'ospite muove la mappa con le dita, la ripresa automatica si ferma
      map.on("movestart", e => { if (e.originalEvent && phase === "overview") cancelAnimationFrame(raf); });
      map.on("idle", () => { if (map && palazzoState === "fallback" && map.getLayer("volo-palazzo")) raisePalazzo(false); });
      // basta che lo stile sia pronto: le tessere arrivano mentre il volo parte
      await withTimeout(new Promise(res => map.once("styledata", res)), 20000, "style");
      if (phase !== "loading") return;
      addRouteLayers();
      // aspetta le prime tessere della città di partenza, senza bloccare per sempre
      await withTimeout(new Promise(res => map.once("idle", res)), 5000, "idle").catch(() => {});
      if (phase !== "loading") return;
      ui("voloLoading").classList.remove("show");
      if (reduceMotion || km < 3) { showStops(); overview(true); }
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
    preload() { if (supportsWebGL()) loadMapLibre().catch(() => {}); },
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
