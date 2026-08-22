import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OVERLAY_TEXT_PADDING_PX = 8;
const DEFAULT_OVERLAY_LINE_HEIGHT = 1.2;
const MIN_OVERLAY_FONT_SIZE_PX = 8;
const MIN_OVERLAY_BOX_SIZE_PX = 1;
const MAX_OVERLAY_TEXT_LENGTH = 240;
const INTER_FONT_VARIANTS = [
  { fileName: 'Inter-Regular.ttf', weight: 400, style: 'normal' },
  { fileName: 'Inter-Bold.ttf', weight: 700, style: 'normal' },
  { fileName: 'Inter-Italic.ttf', weight: 400, style: 'italic' },
  { fileName: 'Inter-BoldItalic.ttf', weight: 700, style: 'italic' }
];
const EMOJI_FONT_VARIANTS = [
  { fileName: 'NotoColorEmoji.ttf', weight: 400, style: 'normal' }
];

const fontCache = new Map();

function safeParseNumber(value, fallback = null) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampNumber(value, min, max) {
  const numericValue = safeParseNumber(value, min);
  return Math.min(max, Math.max(min, numericValue));
}

function parseHexColor(hex) {
  const normalized = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b, hex: `#${normalized.toLowerCase()}` };
}

function resolveFontPath(fileName) {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'fonts', fileName),
    path.resolve(process.cwd(), 'server', 'assets', 'fonts', fileName),
    path.resolve(process.cwd(), 'assets', 'fonts', fileName),
    path.resolve(process.cwd(), fileName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function loadFontData(fileName) {
  if (fontCache.has(fileName)) {
    return fontCache.get(fileName);
  }

  const fontPath = resolveFontPath(fileName);
  if (!fs.existsSync(fontPath)) {
    return null;
  }

  const data = fs.readFileSync(fontPath);
  fontCache.set(fileName, data);
  return data;
}

function buildFontConfig() {
  const fonts = [];

  for (const variant of INTER_FONT_VARIANTS) {
    const data = loadFontData(variant.fileName);
    if (!data) continue;
    fonts.push({
      name: 'Inter',
      data,
      weight: variant.weight,
      style: variant.style
    });
  }

  for (const variant of EMOJI_FONT_VARIANTS) {
    const data = loadFontData(variant.fileName);
    if (!data) continue;
    fonts.push({
      name: 'Noto Color Emoji',
      data,
      weight: variant.weight,
      style: variant.style
    });
  }

  return fonts;
}

function sanitizeOverlayText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .slice(0, MAX_OVERLAY_TEXT_LENGTH);
}

function resolveOverlayBackground(overlay) {
  const backgroundHex = parseHexColor(overlay?.backgroundColor)?.hex || '#333333';
  const gradientDirection = overlay?.gradient?.direction === 'horizontal' ? 'to right' : 'to bottom';
  const gradientFromHex = parseHexColor(overlay?.gradient?.from?.hex)?.hex || backgroundHex;
  const gradientToHex = parseHexColor(overlay?.gradient?.to?.hex)?.hex || backgroundHex;

  if (overlay?.isGradient) {
    return `linear-gradient(${gradientDirection}, ${gradientFromHex}, ${gradientToHex})`;
  }

  return backgroundHex;
}

function resolveOverlayFontWeight(fontWeight) {
  return String(fontWeight || '').trim().toLowerCase() === 'bold' ? 700 : 400;
}

function resolveOverlayFontStyle(fontStyle) {
  return String(fontStyle || '').trim().toLowerCase() === 'italic' ? 'italic' : 'normal';
}

export async function renderVideoOverlayPng({ overlay, outputPath }) {
  if (!overlay || !outputPath) {
    throw new Error('renderVideoOverlayPng requires overlay and outputPath.');
  }

  const width = Math.max(MIN_OVERLAY_BOX_SIZE_PX, Math.round(safeParseNumber(overlay.width, MIN_OVERLAY_BOX_SIZE_PX) || MIN_OVERLAY_BOX_SIZE_PX));
  const height = Math.max(MIN_OVERLAY_BOX_SIZE_PX, Math.round(safeParseNumber(overlay.height, MIN_OVERLAY_BOX_SIZE_PX) || MIN_OVERLAY_BOX_SIZE_PX));
  const fontSize = Math.max(MIN_OVERLAY_FONT_SIZE_PX, Math.round(safeParseNumber(overlay.fontSize, 24) || 24));
  const borderRadius = Math.max(0, Math.round(safeParseNumber(overlay.borderRadius, 0) || 0));
  const paddingX = Math.max(0, Math.round(safeParseNumber(overlay.textPaddingX, DEFAULT_OVERLAY_TEXT_PADDING_PX) || DEFAULT_OVERLAY_TEXT_PADDING_PX));
  const lineHeight = clampNumber(overlay.lineHeight ?? DEFAULT_OVERLAY_LINE_HEIGHT, 1, 2);
  const textColor = parseHexColor(overlay?.textColor)?.hex || '#ffffff';
  const background = resolveOverlayBackground(overlay);
  const text = sanitizeOverlayText(overlay?.text);
  const fonts = buildFontConfig();

  if (!fonts.length) {
    throw new Error('No overlay fonts are available for server-side rendering.');
  }

  const vnode = {
    type: 'div',
    props: {
      style: {
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background,
        borderRadius,
        boxSizing: 'border-box',
        paddingLeft: paddingX,
        paddingRight: paddingX
      },
      children: {
        type: 'div',
        props: {
          style: {
            maxWidth: '100%',
            maxHeight: '100%',
            color: textColor,
            fontFamily: 'Inter, Noto Color Emoji',
            fontSize,
            fontWeight: resolveOverlayFontWeight(overlay?.fontWeight),
            fontStyle: resolveOverlayFontStyle(overlay?.fontStyle),
            lineHeight,
            textAlign: 'center',
            whiteSpace: 'pre-line',
            overflow: 'hidden'
          },
          children: text
        }
      }
    }
  };

  const svg = await satori(vnode, { width, height, fonts });
  const pngBuffer = new Resvg(svg, { background: 'transparent' }).render().asPng();
  await fs.promises.writeFile(outputPath, pngBuffer);
  return outputPath;
}
