import { useEffect, useMemo, useRef, useState } from 'react';

const GOOGLE_CHARTS_SRC = 'https://www.gstatic.com/charts/loader.js';
const MIN_REDRAW_MS = 30000;

let googleChartsLoaderPromise = null;
let geoChartReadyPromise = null;

function loadGoogleChartsLoader() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Charts only runs in the browser.'));
  if (window.google?.charts) return Promise.resolve(window.google);

  if (googleChartsLoaderPromise) return googleChartsLoaderPromise;

  googleChartsLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_CHARTS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Charts.')));
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_CHARTS_SRC;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Failed to load Google Charts.'));
    document.head.appendChild(script);
  });

  return googleChartsLoaderPromise;
}

function ensureGeoChartReady() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Charts only runs in the browser.'));
  if (geoChartReadyPromise) return geoChartReadyPromise;

  geoChartReadyPromise = loadGoogleChartsLoader().then((google) => new Promise((resolve) => {
    if (google?.visualization?.GeoChart) {
      resolve(google);
      return;
    }

    const mapsApiKey = import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY;
    const loadOptions = { packages: ['geochart'] };
    if (typeof mapsApiKey === 'string' && mapsApiKey.trim()) {
      loadOptions.mapsApiKey = mapsApiKey.trim();
    }

    google.charts.load('current', loadOptions);
    google.charts.setOnLoadCallback(() => resolve(google));
  }));

  return geoChartReadyPromise;
}

function buildDataTable(google, tableRows) {
  const rows = Array.isArray(tableRows) ? tableRows : [];
  const data = new google.visualization.DataTable();
  data.addColumn('string', 'Country');
  data.addColumn('number', 'Active sessions');

  if (rows.length === 0) {
    // GeoChart errors on empty tables; draw a tiny placeholder.
    data.addRow(['', 0]);
    return data;
  }

  data.addRows(rows);
  return data;
}

export default function GeoHotspotsMap({
  countries,
  focusRegion = 'WORLD',
  height = 260
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const lastDrawAtRef = useRef(0);
  const lastRegionCodeRef = useRef(null);
  const redrawTimeoutRef = useRef(null);
  const [error, setError] = useState('');

  const regionCode = useMemo(() => {
    const raw = (focusRegion || 'WORLD').toString().trim().toUpperCase();
    if (!raw || raw === 'WORLD') return null;
    if (/^[A-Z]{2}$/.test(raw)) return raw;
    return null;
  }, [focusRegion]);

  const tableRows = useMemo(() => {
    const rows = Array.isArray(countries) ? countries : [];
    return rows
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const code = (row.value || '').toString().trim().toUpperCase();
        const count = Number(row.count);
        if (!code) return null;
        if (!Number.isFinite(count) || count <= 0) return null;
        return [code, count];
      })
      .filter(Boolean);
  }, [countries]);

  // A stable signature prevents re-drawing the map just because the input array got recreated.
  const dataSignature = useMemo(() => (
    tableRows
      .slice()
      .sort((a, b) => String(a?.[0]).localeCompare(String(b?.[0])))
      .map((row) => `${row[0]}:${row[1]}`)
      .join('|')
  ), [tableRows]);

  useEffect(() => {
    let cancelled = false;
    let observer = null;
    let raf = 0;

    const draw = async () => {
      const node = containerRef.current;
      if (!node) return;

      try {
        const google = await ensureGeoChartReady();
        if (cancelled) return;

        const data = buildDataTable(google, tableRows);
        const chart = chartRef.current || new google.visualization.GeoChart(node);
        chartRef.current = chart;

        const options = {
          backgroundColor: 'transparent',
          datalessRegionColor: '#f1f5f9',
          defaultColor: '#e0e7ff',
          legend: 'none',
          tooltip: { textStyle: { fontSize: 12 } },
          colorAxis: { colors: ['#e0e7ff', '#4f46e5'] }
        };

        if (regionCode) {
          options.region = regionCode;
          options.resolution = 'provinces';
        }

        chart.draw(data, options);
        lastDrawAtRef.current = Date.now();
        lastRegionCodeRef.current = regionCode || null;
        setError('');
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Failed to render map.');
      }
    };

    const scheduleDraw = () => {
      if (redrawTimeoutRef.current) {
        clearTimeout(redrawTimeoutRef.current);
        redrawTimeoutRef.current = null;
      }

      const now = Date.now();
      const elapsed = now - (lastDrawAtRef.current || 0);
      const regionChanged = lastRegionCodeRef.current !== (regionCode || null);
      const delay = regionChanged || elapsed >= MIN_REDRAW_MS ? 0 : MIN_REDRAW_MS - elapsed;

      redrawTimeoutRef.current = setTimeout(() => {
        redrawTimeoutRef.current = null;
        draw();
      }, delay);
    };

    scheduleDraw();

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          scheduleDraw();
        });
      });
      if (containerRef.current) observer.observe(containerRef.current);
    } else {
      const onResize = () => scheduleDraw();
      window.addEventListener('resize', onResize);
      observer = { disconnect: () => window.removeEventListener('resize', onResize) };
    }

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      if (redrawTimeoutRef.current) {
        clearTimeout(redrawTimeoutRef.current);
        redrawTimeoutRef.current = null;
      }
      cancelAnimationFrame(raf);
    };
  }, [dataSignature, regionCode]);

  return (
    <div className="si-geo-map">
      {error ? (
        <div className="si-empty" style={{ padding: 12, color: '#b42318' }}>
          {error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="si-geo-map-canvas"
        style={{ height }}
      />
    </div>
  );
}
