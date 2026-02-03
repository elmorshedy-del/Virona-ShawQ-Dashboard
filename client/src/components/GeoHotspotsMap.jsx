import { useEffect, useMemo, useRef, useState } from 'react';

const GOOGLE_CHARTS_SRC = 'https://www.gstatic.com/charts/loader.js';

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

    google.charts.load('current', { packages: ['geochart'] });
    google.charts.setOnLoadCallback(() => resolve(google));
  }));

  return geoChartReadyPromise;
}

function buildDataTable(google, countries) {
  const rows = Array.isArray(countries) ? countries : [];
  const data = new google.visualization.DataTable();
  data.addColumn('string', 'Country');
  data.addColumn('number', 'Active sessions');

  const tableRows = rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const code = (row.value || '').toString().trim().toUpperCase();
      const count = Number(row.count);
      if (!code) return null;
      if (!Number.isFinite(count) || count <= 0) return null;
      return [code, count];
    })
    .filter(Boolean);

  if (tableRows.length === 0) {
    // GeoChart errors on empty tables; draw a tiny placeholder.
    data.addRow(['', 0]);
    return data;
  }

  data.addRows(tableRows);
  return data;
}

export default function GeoHotspotsMap({
  countries,
  focusRegion = 'WORLD',
  height = 260
}) {
  const containerRef = useRef(null);
  const [error, setError] = useState('');

  const regionCode = useMemo(() => {
    const raw = (focusRegion || 'WORLD').toString().trim().toUpperCase();
    if (!raw || raw === 'WORLD') return null;
    if (/^[A-Z]{2}$/.test(raw)) return raw;
    return null;
  }, [focusRegion]);

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

        const data = buildDataTable(google, countries);
        const chart = new google.visualization.GeoChart(node);

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
        }

        chart.draw(data, options);
        setError('');
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Failed to render map.');
      }
    };

    draw();

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          draw();
        });
      });
      if (containerRef.current) observer.observe(containerRef.current);
    } else {
      const onResize = () => draw();
      window.addEventListener('resize', onResize);
      observer = { disconnect: () => window.removeEventListener('resize', onResize) };
    }

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [countries, regionCode]);

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

