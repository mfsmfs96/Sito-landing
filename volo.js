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
          type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 15, encoding: "terrarium",
          attribution: 'Rilievo: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles</a>'
        },
        demShade: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 15, encoding: "terrarium" }
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
      stopMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([PLACES[key].lng, PLACES[key].lat]).addTo(map));
    });
  }

  function routeData(coords) {
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
  }

  function addRouteLayers() {
    map.addSource("volo-full", { type: "geojson", data: routeData(trip.path) });
    map.addSource("volo-route", { type: "geojson", data: routeData([trip.path[0], trip.path[0]]) });
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

  function pointAt(p) {
    const path = trip.path, f = p * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f)), k = f - i;
    const a = path[i], b = path[i + 1];
    return { i, pos: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] };
  }

  function planTrip(origin) {
    const dest = PLACES.palazzo;
    const km = distanceKm(origin, dest);
    const path = greatCircle(origin, dest, Math.max(60, Math.min(700, Math.round(km / 2))));
    const w = Math.max(320, overlay.clientWidth || innerWidth);
    const midLat = (origin.lat + dest.lat) / 2;
    // zoom alla quale la tratta occupa circa metà della larghezza dello schermo
    const zFit = Math.log2(156543 * Math.cos(toRad(midLat)) * w / Math.max(1, km * 1000 * .55));
    const zStart = 11, zEnd = 13.2;
    const zMid = Math.max(3, Math.min(zFit, 10.5));
    const arc = Math.max(0, (zStart + zEnd) / 2 - zMid);
    const duration = Math.max(7000, Math.min(16000, 6500 + km * 7));
    return { origin, km, path, zStart, zEnd, arc, duration, bearing: bearingDeg(path[0], path[Math.min(path.length - 1, 3)]) };
  }

  function fly() {
    phase = "flight";
    setInteractive(false);
    clearStops();
    ui("voloCard").classList.remove("show");
    overlay.classList.remove("has-card");
    ui("voloSkip").classList.add("show");
    ui("voloEyebrow").textContent = "Il vostro viaggio";
    collapseAttribution();

    map.getSource("volo-route").setData(routeData([trip.path[0], trip.path[0]]));
    if (!heartMarker) heartMarker = new maplibregl.Marker({ element: makeHeart(), anchor: "center" });
    heartMarker.setLngLat(trip.path[0]).addTo(map);

    const top = headPadding();
    map.setPadding({ top: Math.round(top * .6), bottom: 0, left: 0, right: 0 });
    let bearing = trip.bearing;
    map.jumpTo({ center: trip.path[0], zoom: trip.zStart, pitch: 48, bearing });

    // breve pausa sulla città di partenza prima del decollo
    const hold = 900;
    const t0 = performance.now() + hold;
    cancelAnimationFrame(raf);
    const step = now => {
      if (phase !== "flight") return;
      const t = Math.max(0, Math.min(1, (now - t0) / trip.duration));
      const p = easeSine(t);
      const { i, pos } = pointAt(p);
      map.getSource("volo-route").setData(routeData(trip.path.slice(0, i + 1).concat([pos])));
      heartMarker.setLngLat(pos);

      const ahead = pointAt(Math.min(1, p + .02)).pos, behind = pointAt(Math.max(0, p - .02)).pos;
      if (p < .98) bearing = lerpAngle(bearing, bearingDeg(behind, ahead), .06);
      const zoom = trip.zStart + (trip.zEnd - trip.zStart) * p - trip.arc * Math.sin(Math.PI * p);
      const pitch = 48 + 14 * Math.sin(Math.PI * Math.min(1, p * 1.2));
      map.jumpTo({ center: pos, zoom, pitch, bearing });

      if (t < 1) raf = requestAnimationFrame(step);
      else arrive();
    };
    raf = requestAnimationFrame(step);
  }

  function arrive() {
    phase = "arrive";
    ui("voloEyebrow").textContent = "Benvenuti in Calabria";
    map.getSource("volo-route").setData(routeData(trip.path));
    heartMarker && heartMarker.remove();
    showStops();
    setActiveStop("palazzo");
    map.easeTo({
      center: [PLACES.palazzo.lng, PLACES.palazzo.lat],
      zoom: 15, pitch: 66, bearing: VIEW_BEARING + 14,
      duration: reduceMotion ? 0 : 4800, easing: easeInOut
    });
    map.once("moveend", () => { if (phase === "arrive") overview(); });
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
    map.getSource("volo-route").setData(routeData(trip.path));
    heartMarker && heartMarker.remove();
    if (!stopMarkers.length) showStops();
    setActiveStop(null);
    collapseAttribution();

    const card = ui("voloCard");
    card.classList.add("show");
    overlay.classList.add("has-card");
    const bounds = new maplibregl.LngLatBounds();
    STOP_ORDER.forEach(k => bounds.extend([PLACES[k].lng, PLACES[k].lat]));
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const cam = map.cameraForBounds(bounds, { padding: freePadding(14), bearing: VIEW_BEARING, pitch: 0 });
    const target = cam
      ? { center: cam.center, zoom: Math.min(13, cam.zoom - .15) }
      : { center: [15.80, 39.80], zoom: 10.2 };
    map.easeTo({
      ...target, bearing: VIEW_BEARING, pitch: 44,
      duration: instant || reduceMotion ? 0 : 2600, easing: easeInOut
    });
    setInteractive(true);
  }

  function focusStop(key) {
    if (phase !== "overview" || !map) return;
    const p = PLACES[key];
    setActiveStop(key);
    map.easeTo({
      center: [p.lng, p.lat], zoom: 15, pitch: 62, padding: freePadding(),
      bearing: VIEW_BEARING - 8, duration: reduceMotion ? 0 : 2200, easing: easeInOut
    });
  }

  function skip() {
    if (phase !== "flight" && phase !== "arrive") return;
    cancelAnimationFrame(raf);
    map.stop();
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
    overlay.classList.remove("open", "has-card");
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
      const ml = await withTimeout(loadMapLibre(), 15000, "maplibre");
      if (phase !== "loading") return;
      trip = planTrip(origin);
      trip.returnFocus = returnFocus;
      map = new ml.Map({
        container: ui("voloMap"),
        style: buildStyle(),
        center: trip.path[0], zoom: trip.zStart, pitch: 48, bearing: trip.bearing,
        maxPitch: 75,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        attributionControl: false,
        fadeDuration: 150
      });
      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");
      map.on("error", e => console.warn("[volo]", e && e.error ? e.error.message : e));
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
