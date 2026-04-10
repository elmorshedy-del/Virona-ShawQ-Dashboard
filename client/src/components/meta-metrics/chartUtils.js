const MIN_SCALE_VALUE = 1;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function niceMax(value) {
  if (value <= 0) return MIN_SCALE_VALUE;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  if (fraction <= 1) return exponent;
  if (fraction <= 2) return 2 * exponent;
  if (fraction <= 5) return 5 * exponent;
  return 10 * exponent;
}

export function catmullRomPath(points) {
  if (!Array.isArray(points) || points.length < 2) return '';

  let path = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const point0 = points[Math.max(index - 1, 0)];
    const point1 = points[index];
    const point2 = points[index + 1];
    const point3 = points[Math.min(index + 2, points.length - 1)];
    const controlPoint1X = point1[0] + ((point2[0] - point0[0]) / 6);
    const controlPoint1Y = point1[1] + ((point2[1] - point0[1]) / 6);
    const controlPoint2X = point2[0] - ((point3[0] - point1[0]) / 6);
    const controlPoint2Y = point2[1] - ((point3[1] - point1[1]) / 6);
    path += ` C ${controlPoint1X.toFixed(2)} ${controlPoint1Y.toFixed(2)}, ${controlPoint2X.toFixed(2)} ${controlPoint2Y.toFixed(2)}, ${point2[0].toFixed(2)} ${point2[1].toFixed(2)}`;
  }

  return path;
}
