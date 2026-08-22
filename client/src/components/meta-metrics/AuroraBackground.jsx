import { useEffect, useRef } from 'react';

const STAR_COUNT = 160;
const STAR_FIELD_HEIGHT_RATIO = 0.75;
const HORIZON_START_RATIO = 0.7;
const DEFAULT_BASE_COLOR = '#060A18';
const LIGHT_BASE_COLOR = '#eef4ff';

const DARK_BLOOMS = [
  { x: -0.05, y: 1.05, rW: 0.7, rH: 0.85, colorInner: [160, 0, 220], colorOuter: [100, 0, 180], alpha: 0.9, phase: 0, speed: 0.00055 },
  { x: 0.1, y: 0.95, rW: 0.45, rH: 0.55, colorInner: [200, 0, 200], colorOuter: [120, 0, 160], alpha: 0.55, phase: 1.8, speed: 0.0004 },
  { x: 1.05, y: 1.05, rW: 0.7, rH: 0.82, colorInner: [0, 200, 230], colorOuter: [0, 140, 200], alpha: 0.85, phase: 2.4, speed: 0.00048 },
  { x: 0.88, y: 0.92, rW: 0.42, rH: 0.5, colorInner: [0, 220, 255], colorOuter: [0, 160, 210], alpha: 0.5, phase: 4.0, speed: 0.00038 }
];

const LIGHT_BLOOMS = [
  { x: -0.08, y: 1.0, rW: 0.72, rH: 0.78, colorInner: [237, 72, 153], colorOuter: [219, 39, 119], alpha: 0.34, phase: 0.3, speed: 0.00055 },
  { x: 1.08, y: 1.02, rW: 0.7, rH: 0.8, colorInner: [14, 165, 233], colorOuter: [56, 189, 248], alpha: 0.32, phase: 1.4, speed: 0.00046 },
  { x: 0.52, y: 0.0, rW: 0.46, rH: 0.36, colorInner: [99, 102, 241], colorOuter: [129, 140, 248], alpha: 0.18, phase: 2.0, speed: 0.00032 }
];

function buildStars() {
  return Array.from({ length: STAR_COUNT }).map(() => ({
    x: Math.random(),
    y: Math.random() * STAR_FIELD_HEIGHT_RATIO,
    size: Math.random() * 1.2 + 0.2,
    alpha: Math.random() * 0.5 + 0.15,
    phase: Math.random() * Math.PI * 2,
    speed: 0.006 + Math.random() * 0.012,
    twinkleBase: Math.random() > 0.5 ? 0.4 : 0.85
  }));
}

export default function AuroraBackground({ mode = 'dark' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return undefined;

    const stars = buildStars();
    const blooms = mode === 'light' ? LIGHT_BLOOMS : DARK_BLOOMS;
    const baseColor = mode === 'light' ? LIGHT_BASE_COLOR : DEFAULT_BASE_COLOR;
    let animationFrameId = 0;
    let tick = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    };

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;

      context.globalCompositeOperation = 'source-over';
      context.fillStyle = baseColor;
      context.fillRect(0, 0, width, height);

      const vignette = context.createRadialGradient(
        width * 0.5,
        height * 0.35,
        height * 0.05,
        width * 0.5,
        height * 0.5,
        height * 0.95
      );

      if (mode === 'light') {
        vignette.addColorStop(0, 'rgba(255,255,255,0)');
        vignette.addColorStop(0.55, 'rgba(214,226,255,0.08)');
        vignette.addColorStop(1, 'rgba(196,210,241,0.22)');
      } else {
        vignette.addColorStop(0, 'rgba(5,8,22,0)');
        vignette.addColorStop(0.5, 'rgba(3,5,15,0.25)');
        vignette.addColorStop(1, 'rgba(2,3,10,0.65)');
      }

      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      context.globalCompositeOperation = 'source-over';
      stars.forEach((star) => {
        const alpha = star.alpha * (star.twinkleBase + (1 - star.twinkleBase) * Math.abs(Math.sin(tick * star.speed + star.phase)));
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
        context.fillStyle = mode === 'light'
          ? `rgba(148, 163, 184, ${alpha * 0.45})`
          : `rgba(200,220,255,${alpha})`;
        context.fill();
      });

      context.globalCompositeOperation = 'screen';
      blooms.forEach((bloom) => {
        const centerX = bloom.x * width;
        const centerY = bloom.y * height;
        const radiusX = bloom.rW * width;
        const radiusY = bloom.rH * height;
        const pulse = 0.82 + 0.18 * Math.sin(tick * bloom.speed + bloom.phase);
        const alpha = bloom.alpha * pulse;

        context.save();
        context.translate(centerX, centerY);
        context.scale(radiusX, radiusY);
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
        gradient.addColorStop(0, `rgba(${bloom.colorInner.join(',')},${alpha})`);
        gradient.addColorStop(0.3, `rgba(${bloom.colorInner.join(',')},${alpha * 0.65})`);
        gradient.addColorStop(0.6, `rgba(${bloom.colorOuter.join(',')},${alpha * 0.28})`);
        gradient.addColorStop(0.85, `rgba(${bloom.colorOuter.join(',')},${alpha * 0.07})`);
        gradient.addColorStop(1, `rgba(${bloom.colorOuter.join(',')},0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(0, 0, 1, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });

      const horizon = context.createLinearGradient(0, height * HORIZON_START_RATIO, 0, height);
      if (mode === 'light') {
        horizon.addColorStop(0, 'rgba(99,102,241,0)');
        horizon.addColorStop(0.45, 'rgba(99,102,241,0.06)');
        horizon.addColorStop(1, 'rgba(14,165,233,0.08)');
      } else {
        horizon.addColorStop(0, 'rgba(60,0,120,0)');
        horizon.addColorStop(0.5, `rgba(60,0,120,${0.08 + 0.04 * Math.sin(tick * 0.00045)})`);
        horizon.addColorStop(1, 'rgba(60,0,120,0.12)');
      }
      context.fillStyle = horizon;
      context.fillRect(0, height * HORIZON_START_RATIO, width, height * (1 - HORIZON_START_RATIO));

      tick += 1;
      animationFrameId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        zIndex: 0,
        pointerEvents: 'none'
      }}
    />
  );
}
