import { useEffect, useMemo, useRef, useState } from 'react';
import { clamp } from './chartUtils';
import { countryNameFromCode, normalizeCountryKey, resolveWorldAtlasCountryKey } from './countryUtils';

const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css';
const MAPLIBRE_CSS_URL = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';
const DEFAULT_MAP_CENTER = [15, 18];
const DEFAULT_MAP_ZOOM = 1.05;
const DEFAULT_BURST_INTERVAL_MS = 2600;
const BURST_DURATION_MS = 1900;
const MAX_PATH_MARKERS = 6;
const MIN_MARKER_SIZE = 14;
const MAX_MARKER_SIZE = 24;
const PATH_LINE_COLOR = '#4DA6FF';

const MAP_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      maxzoom: 19
    }
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#060d1a' }
    },
    {
      id: 'carto-raster',
      type: 'raster',
      source: 'carto-dark',
      paint: { 'raster-opacity': 0.78 }
    }
  ]
};

const INJECTED_CSS = `
@keyframes metaMetricsRipple {
  0%   { transform: scale(1);   opacity: 0.85; }
  100% { transform: scale(3.8); opacity: 0;    }
}
@keyframes metaMetricsBurst {
  0%   { transform: scale(1); opacity: 1; }
  100% { transform: scale(7); opacity: 0; }
}
.meta-metrics-map-dot-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.meta-metrics-map-dot-core {
  border-radius: 999px;
  background: #007AFF;
  box-shadow: 0 0 6px #007AFF, 0 0 18px rgba(0,122,255,0.55);
  position: relative;
  z-index: 2;
  flex-shrink: 0;
}
.meta-metrics-map-dot-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 1.5px solid rgba(0,122,255,0.85);
  animation: metaMetricsRipple 1.5s ease-out infinite;
}
.meta-metrics-map-burst-ring {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid #007AFF;
  box-shadow: 0 0 10px rgba(0,122,255,0.9), 0 0 24px rgba(0,122,255,0.4);
  animation: metaMetricsBurst 1.8s ease-out forwards;
  pointer-events: none;
}
.mapboxgl-ctrl-logo,
.mapboxgl-ctrl-attrib,
.maplibregl-ctrl-logo,
.maplibregl-ctrl-attrib {
  display: none !important;
}
`;

function injectStyleSheet(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

function injectAnimationStyles() {
  if (document.querySelector('style[data-meta-metrics-map="true"]')) return;
  const style = document.createElement('style');
  style.dataset.metaMetricsMap = 'true';
  style.textContent = INJECTED_CSS;
  document.head.appendChild(style);
}

async function importMapRuntime(runtimeName) {
  const module = await import(runtimeName);
  return module?.default || module;
}

async function resolveMapRuntime() {
  const mapboxAccessToken = typeof import.meta?.env?.VITE_MAPBOX_ACCESS_TOKEN === 'string'
    ? import.meta.env.VITE_MAPBOX_ACCESS_TOKEN.trim()
    : '';
  const runtimes = [
    { name: 'mapbox-gl', kind: 'mapbox', cssUrl: MAPBOX_CSS_URL, enabled: Boolean(mapboxAccessToken) },
    { name: 'maplibre-gl', kind: 'maplibre', cssUrl: MAPLIBRE_CSS_URL, enabled: true }
  ];

  for (const runtime of runtimes) {
    if (!runtime.enabled) continue;
    try {
      const lib = await importMapRuntime(runtime.name);
      if (runtime.kind === 'mapbox') {
        lib.accessToken = mapboxAccessToken;
      }
      injectStyleSheet(runtime.cssUrl);
      return { lib, kind: runtime.kind };
    } catch (_error) {
      // try the next runtime
    }
  }

  throw new Error('Install mapbox-gl or maplibre-gl to render the live world map.');
}

async function loadWorldMapAssets() {
  const [{ feature }, { default: centroid }, topo] = await Promise.all([
    import('topojson-client'),
    import('@turf/centroid'),
    fetch(WORLD_ATLAS_URL).then((response) => response.json())
  ]);

  const geoJson = feature(topo, topo.objects.countries);
  const centroidByCountryKey = new Map();

  geoJson.features.forEach((featureItem) => {
    const featureName = featureItem?.properties?.name;
    const featureKey = normalizeCountryKey(featureName);
    if (!featureKey) return;
    const centroidFeature = centroid(featureItem);
    const coordinates = centroidFeature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;
    centroidByCountryKey.set(featureKey, coordinates);
  });

  return { geoJson, centroidByCountryKey };
}

function buildMarkerElement(size) {
  const wrap = document.createElement('div');
  wrap.className = 'meta-metrics-map-dot-wrap';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;

  const core = document.createElement('div');
  core.className = 'meta-metrics-map-dot-core';
  core.style.width = `${Math.max(4, Math.round(size * 0.36))}px`;
  core.style.height = `${Math.max(4, Math.round(size * 0.36))}px`;

  const ring = document.createElement('div');
  ring.className = 'meta-metrics-map-dot-ring';
  ring.style.animationDelay = `${Math.random() * 1.5}s`;

  wrap.appendChild(ring);
  wrap.appendChild(core);
  return wrap;
}

function buildPathGeoJson(markerPoints, focusPoint) {
  if (!focusPoint || markerPoints.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: markerPoints
      .filter((point) => point.id !== focusPoint.id)
      .slice(0, MAX_PATH_MARKERS)
      .map((point) => ({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [focusPoint.coordinates, point.coordinates]
        }
      }))
  };
}

function MiniMapSVG() {
  const indicatorPoints = [
    [30, 33],
    [84, 22],
    [144, 28],
    [76, 58],
    [136, 60],
    [180, 36],
    [20, 60],
    [100, 42],
    [160, 24],
    [58, 38]
  ];

  return (
    <svg width="200" height="90" viewBox="0 0 200 90" fill="none">
      <rect width="200" height="90" fill="#060d1a" rx="4" />
      <path d="M18 28 Q28 18 42 24 Q50 30 46 40 Q34 46 22 40Z" fill="#0D1B2A" stroke="#1a2a3a" strokeWidth="0.5" />
      <path d="M52 14 Q82 8 106 16 Q118 24 114 38 Q96 48 72 44 Q56 38 52 14Z" fill="#0D1B2A" stroke="#1a2a3a" strokeWidth="0.5" />
      <path d="M118 16 Q146 10 162 22 Q170 32 160 42 Q144 50 126 44 Q114 36 118 16Z" fill="#0D1B2A" stroke="#1a2a3a" strokeWidth="0.5" />
      <path d="M64 48 Q80 44 90 56 Q88 70 74 74 Q62 70 62 58Z" fill="#0D1B2A" stroke="#1a2a3a" strokeWidth="0.5" />
      <path d="M124 50 Q140 46 150 58 Q148 70 134 74 Q122 70 122 58Z" fill="#0D1B2A" stroke="#1a2a3a" strokeWidth="0.5" />
      <path d="M26 52 Q34 48 38 58 Q36 68 28 68 Q22 64 26 52Z" fill="#0D1B2A" stroke="#1a2a3a" strokeWidth="0.5" />
      <path d="M30 33 Q66 14 84 22 Q104 18 144 28" stroke="#4DA6FF" strokeWidth="0.9" strokeDasharray="3,2" opacity="0.65" />
      <path d="M84 22 Q78 46 76 58" stroke="#4DA6FF" strokeWidth="0.9" strokeDasharray="3,2" opacity="0.55" />
      <path d="M144 28 Q168 28 180 36" stroke="#4DA6FF" strokeWidth="0.9" strokeDasharray="3,2" opacity="0.5" />
      {indicatorPoints.map(([x, y], index) => (
        <g key={`mini-map-indicator-${index}`}>
          <circle cx={x} cy={y} r="4" fill="#007AFF" opacity="0.12" />
          <circle cx={x} cy={y} r="2" fill="#007AFF" opacity="0.5" />
          <circle cx={x} cy={y} r="1.2" fill="#007AFF" />
        </g>
      ))}
    </svg>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}` }} />
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 7, fontWeight: 500, color: 'rgba(200,225,255,0.65)' }}>{label}</span>
    </div>
  );
}

function LegendLine({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg width="13" height="3" viewBox="0 0 13 3">
        <line x1="0" y1="1.5" x2="13" y2="1.5" stroke={color} strokeWidth="1.2" strokeDasharray="2,2" />
      </svg>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 7, fontWeight: 500, color: 'rgba(200,225,255,0.65)' }}>{label}</span>
    </div>
  );
}

export default function LiveWorldMap({ liveView, width, height }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapLibRef = useRef(null);
  const centroidByCountryKeyRef = useRef(new Map());
  const liveMarkersRef = useRef([]);
  const burstTimerRef = useRef(null);
  const [status, setStatus] = useState('loading');

  const countryRows = useMemo(() => (
    Array.isArray(liveView?.countries)
      ? liveView.countries.filter((row) => row?.value && Number.isFinite(Number(row?.count)) && Number(row.count) > 0)
      : []
  ), [liveView?.countries]);

  useEffect(() => {
    let disposed = false;

    async function start() {
      if (!containerRef.current) return;

      try {
        injectAnimationStyles();
        const [{ lib }, { geoJson, centroidByCountryKey }] = await Promise.all([
          resolveMapRuntime(),
          loadWorldMapAssets()
        ]);

        if (disposed || !containerRef.current) return;

        const map = new lib.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          interactive: false,
          attributionControl: false
        });

        mapRef.current = map;
        mapLibRef.current = lib;
        centroidByCountryKeyRef.current = centroidByCountryKey;

        map.on('load', () => {
          if (disposed) return;

          map.addSource('countries', {
            type: 'geojson',
            data: geoJson,
            generateId: false
          });

          map.addLayer({
            id: 'country-line',
            type: 'line',
            source: 'countries',
            paint: {
              'line-color': 'rgba(146, 214, 255, 0.32)',
              'line-width': 0.5,
              'line-opacity': 0.45
            }
          });

          map.addSource('paths', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });

          map.addLayer({
            id: 'path-glow',
            type: 'line',
            source: 'paths',
            paint: {
              'line-color': PATH_LINE_COLOR,
              'line-width': 4,
              'line-blur': 3,
              'line-opacity': 0.18
            }
          });

          map.addLayer({
            id: 'path-lines',
            type: 'line',
            source: 'paths',
            paint: {
              'line-color': PATH_LINE_COLOR,
              'line-width': 1.5,
              'line-blur': 1.2,
              'line-opacity': 0.72
            }
          });

          setStatus('ready');
        });

        map.on('error', () => {
          if (!disposed) setStatus('error');
        });
      } catch (_error) {
        if (!disposed) setStatus('error');
      }
    }

    start();

    return () => {
      disposed = true;
      if (burstTimerRef.current) {
        clearInterval(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      liveMarkersRef.current.forEach((marker) => marker.remove());
      liveMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      mapLibRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapLib = mapLibRef.current;
    const centroidByCountryKey = centroidByCountryKeyRef.current;
    if (!map || !mapLib || !map.isStyleLoaded() || status !== 'ready') return undefined;

    liveMarkersRef.current.forEach((marker) => marker.remove());
    liveMarkersRef.current = [];

    if (burstTimerRef.current) {
      clearInterval(burstTimerRef.current);
      burstTimerRef.current = null;
    }

    const maxCount = Math.max(...countryRows.map((row) => Number(row.count)), 1);
    const liveMarkerPoints = countryRows
      .map((row) => {
        const countryKey = resolveWorldAtlasCountryKey(row.value);
        const coordinates = countryKey ? centroidByCountryKey.get(countryKey) : null;
        if (!countryKey || !coordinates) return null;

        const intensity = clamp(Number(row.count) / maxCount, 0, 1);
        const markerSize = Math.round(MIN_MARKER_SIZE + (intensity * (MAX_MARKER_SIZE - MIN_MARKER_SIZE)));
        const marker = new mapLib.Marker({
          element: buildMarkerElement(markerSize),
          anchor: 'center'
        })
          .setLngLat(coordinates)
          .addTo(map);

        liveMarkersRef.current.push(marker);

        return {
          id: countryKey,
          label: countryNameFromCode(row.value),
          coordinates,
          count: Number(row.count) || 0,
          value: row.value
        };
      })
      .filter(Boolean);

    const focusCountryKey = resolveWorldAtlasCountryKey(liveView?.focusCountry);
    const focusPoint = liveMarkerPoints.find((point) => point.id === focusCountryKey) || liveMarkerPoints[0] || null;
    const pathSource = map.getSource('paths');
    if (pathSource?.setData) {
      pathSource.setData(buildPathGeoJson(liveMarkerPoints, focusPoint));
    }

    if (liveMarkerPoints.length > 0) {
      let burstIndex = 0;
      const emitBurst = () => {
        const point = liveMarkerPoints[burstIndex % liveMarkerPoints.length];
        burstIndex += 1;
        if (!point) return;

        const burstElement = document.createElement('div');
        burstElement.className = 'meta-metrics-map-burst-ring';
        const burstMarker = new mapLib.Marker({
          element: burstElement,
          anchor: 'center'
        })
          .setLngLat(point.coordinates)
          .addTo(map);

        window.setTimeout(() => {
          burstMarker.remove();
        }, BURST_DURATION_MS);
      };

      emitBurst();
      burstTimerRef.current = window.setInterval(emitBurst, DEFAULT_BURST_INTERVAL_MS);
    }

    return () => {
      if (burstTimerRef.current) {
        clearInterval(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      liveMarkersRef.current.forEach((marker) => marker.remove());
      liveMarkersRef.current = [];
    };
  }, [countryRows, liveView?.focusCountry, status]);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 'inherit',
        overflow: 'hidden',
        WebkitMaskImage: 'radial-gradient(ellipse at center, black 55%, transparent 100%)',
        maskImage: 'radial-gradient(ellipse at center, black 55%, transparent 100%)'
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {status !== 'ready' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at 50% 80%, #0d1e35 0%, #060d1a 70%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <MiniMapSVG />
          {status === 'loading' && (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 8, color: 'rgba(0,122,255,0.8)', marginTop: 2 }}>
              Loading map…
            </p>
          )}
          {status === 'error' && (
            <>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: 600, color: 'rgba(0,122,255,0.9)' }}>
                Map unavailable
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'rgba(150,200,255,0.45)' }}>
                Install map runtime dependencies
              </p>
            </>
          )}
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 6, right: 8, display: 'flex', gap: 9, zIndex: 10, pointerEvents: 'none' }}>
        <LegendDot color="#007AFF" label="Live" />
        <LegendLine color={PATH_LINE_COLOR} label="Path" />
      </div>
    </div>
  );
}
