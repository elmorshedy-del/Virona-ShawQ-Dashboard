import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import twemoji from 'twemoji';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRESETS = {
  instagram_story: {
    name: 'Instagram Story',
    width: 1080,
    height: 1920,
    backgroundType: 'gradient',
    gradientColors: ['#833ab4', '#fd1d1d', '#fcb045'],
    padding: 100,
    bubbleStyle: 'soft_shadow',
    fontSize: 32,
    centerVertical: true
  },
  instagram_post: {
    name: 'Instagram Post',
    width: 1080,
    height: 1080,
    backgroundType: 'solid',
    backgroundColor: '#ffffff',
    padding: 80,
    bubbleStyle: 'soft_shadow',
    fontSize: 28,
    centerVertical: true
  },
  twitter: {
    name: 'Twitter/X',
    width: 1200,
    height: 675,
    backgroundType: 'solid',
    backgroundColor: '#ffffff',
    padding: 60,
    bubbleStyle: 'solid',
    fontSize: 26,
    centerVertical: true
  },
  linkedin: {
    name: 'LinkedIn',
    width: 1200,
    height: 627,
    backgroundType: 'solid',
    backgroundColor: '#ffffff',
    padding: 60,
    bubbleStyle: 'soft_shadow',
    fontSize: 26,
    centerVertical: true
  },
  website: {
    name: 'Website',
    width: null,
    height: null,
    backgroundType: 'transparent',
    padding: 24,
    bubbleStyle: 'solid',
    fontSize: 24,
    centerVertical: false
  },
  presentation: {
    name: 'Presentation',
    width: 1920,
    height: 1080,
    backgroundType: 'solid',
    backgroundColor: '#ffffff',
    padding: 120,
    bubbleStyle: 'soft_shadow',
    fontSize: 36,
    centerVertical: true
  },
  raw_bubbles: {
    name: 'Raw Bubbles',
    width: null,
    height: null,
    backgroundType: 'transparent',
    padding: 16,
    bubbleStyle: 'solid',
    fontSize: 28,
    centerVertical: false
  }
};

const MAX_EMOJI_CACHE = 500;
const EMOJI_FETCH_TIMEOUT_MS = 5000;
const emojiSvgCache = new Map();

const EMOJI_CDN_BASES = [
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/',
  'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/',
  'https://twemoji.maxcdn.com/v/latest/svg/'
];

const fontCache = new Map();

function h(type, props, ...children) {
  return {
    type,
    props: {
      ...(props || {}),
      children: children.flat().filter(child => child !== null && child !== undefined)
    }
  };
}

function resolveFontPath(fileName) {
  return path.resolve(__dirname, '..', 'assets', 'fonts', fileName);
}

function loadFontDataFromPath(fontPath) {
  if (!fontPath || !fs.existsSync(fontPath)) {
    return null;
  }
  const data = fs.readFileSync(fontPath);
  return { data, path: fontPath };
}

function loadFontData(fileName) {
  if (fontCache.has(fileName)) {
    return fontCache.get(fileName);
  }
  const fontPath = resolveFontPath(fileName);
  const entry = loadFontDataFromPath(fontPath);
  if (!entry) {
    console.warn(`Font not found: ${fontPath}`);
    return null;
  }
  fontCache.set(fileName, entry);
  return entry;
}

function buildFontConfig() {
  const fonts = [];

  // Load Inter font
  const interFont = loadFontData('Inter-Regular.ttf')
    || loadFontDataFromPath(path.resolve(__dirname, '..', '..', 'Inter-Regular.ttf'));
  if (interFont) {
    fonts.push({
      name: 'Inter',
      data: interFont.data,
      weight: 400,
      style: 'normal',
      source: interFont.path
    });
  } else {
    console.warn('Inter font not found, rendering may fail');
  }

  // Load Noto Color Emoji font for emoji support
  const emojiFont = loadFontData('NotoColorEmoji.ttf');
  if (emojiFont) {
    fonts.push({
      name: 'Noto Color Emoji',
      data: emojiFont.data,
      weight: 400,
      style: 'normal',
      source: emojiFont.path
    });
  } else {
    console.warn('Emoji font not found, emojis may not render correctly');
  }

  return fonts;
}

function formatFontSignature(data) {
  const bytes = Array.from(data.subarray(0, 4));
  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchEmojiDataUrlFromBase(baseUrl, filename) {
  const src = `${baseUrl}${filename}`;
  const response = await fetchWithTimeout(src, EMOJI_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Emoji fetch failed: ${response.status}`);
  }
  const svgText = await response.text();
  const base64 = Buffer.from(svgText).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

async function fetchEmojiDataUrl(filename) {
  if (emojiSvgCache.has(filename)) {
    return emojiSvgCache.get(filename);
  }

  for (const baseUrl of EMOJI_CDN_BASES) {
    try {
      const dataUrl = await fetchEmojiDataUrlFromBase(baseUrl, filename);
      if (emojiSvgCache.size >= MAX_EMOJI_CACHE) {
        const firstKey = emojiSvgCache.keys().next().value;
        emojiSvgCache.delete(firstKey);
      }
      emojiSvgCache.set(filename, dataUrl);
      return dataUrl;
    } catch (error) {
      console.warn('Emoji fetch failed from base:', baseUrl, error.message);
    }
  }

  return null;
}

async function buildTwemojiNodes(text) {
  const parsed = twemoji.parse(text, { folder: 'svg', ext: '.svg' });
  const regex = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]+)"[^>]*>/g;
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(parsed)) !== null) {
    const [fullMatch, src, alt] = match;
    const textChunk = parsed.slice(lastIndex, match.index);
    if (textChunk) {
      nodes.push(textChunk);
    }
    const filename = src.split('/').pop();
    const dataUrl = filename ? await fetchEmojiDataUrl(filename) : null;
    if (dataUrl) {
      nodes.push(h('img', {
        src: dataUrl,
        width: '1em',
        height: '1em',
        style: { display: 'inline-block', verticalAlign: '-0.1em' }
      }));
    } else {
      nodes.push(alt || '');
    }
    lastIndex = match.index + fullMatch.length;
  }

  const remaining = parsed.slice(lastIndex);
  if (remaining) {
    nodes.push(remaining);
  }

  return nodes;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

async function buildMessageTextNodes(text, quoteScale, outputShape, textColor) {
  const sanitized = escapeHtml(text || '');
  const textNodes = await buildTwemojiNodes(sanitized);
  if (outputShape !== 'quote_card') {
    return textNodes;
  }
  return [
    h('span', {
      style: {
        fontSize: `${quoteScale}em`,
        color: textColor,
        opacity: 0.85
      }
    }, '“'),
    ...textNodes,
    h('span', {
      style: {
        fontSize: `${quoteScale}em`,
        color: textColor,
        opacity: 0.85
      }
    }, '”')
  ];
}

async function buildTestimonialVNode(messages, config) {
  const {
    width,
    height,
    backgroundType,
    backgroundColor = '#ffffff',
    gradientColors = ['#833ab4', '#fcb045'],
    padding = 24,
    outputShape = 'bubble',
    borderRadius = 20,
    bubbleStyle = 'solid',
    bubbleColor = '#ffffff',
    textColor = '#000000',
    fontSize = 28,
    typographyPreset = 'inherit',
    quoteTreatment = 'polished',
    weightOption = 'match',
    cardPadding = 'm',
    lineSpacing = 'normal',
    maxWidth = 'standard',
    centerVertical = false,
    layout = 'stacked',
    collageColumns = 2
  } = config;

  const resolvedCollageColumns = Math.min(4, Math.max(2, Number(collageColumns) || 2));

  const fontWeightMap = {
    match: 400,
    medium: 500,
    bold: 600
  };

  const typographyMap = {
    inherit: { sizeMultiplier: 1, lineHeightAdjust: 0 },
    editorial: { sizeMultiplier: 1.05, lineHeightAdjust: 0.08 },
    compact: { sizeMultiplier: 0.95, lineHeightAdjust: -0.04 }
  };

  const maxWidthMap = {
    narrow: '32ch',
    standard: '38ch',
    wide: '44ch'
  };

  const baseLineHeight = outputShape === 'quote_card' ? 1.6 : 1.4;
  const typographyConfig = typographyMap[typographyPreset] || typographyMap.inherit;
  const lineSpacingBoost = lineSpacing === 'relaxed' ? 0.1 : 0;
  const lineHeight = Number((baseLineHeight + typographyConfig.lineHeightAdjust + lineSpacingBoost).toFixed(2));
  const effectiveFontSize = Math.round(fontSize * typographyConfig.sizeMultiplier);
  const fontWeight = fontWeightMap[weightOption] || fontWeightMap.match;
  const resolvedMaxWidth = maxWidthMap[maxWidth] || maxWidthMap.standard;

  const paddingByShape = {
    bubble: { s: 16, m: 20, l: 24 },
    card: { s: 20, m: 24, l: 32 },
    quote_card: { s: 28, m: 36, l: 44 },
    minimal: { s: 0, m: 0, l: 0 }
  };
  const shapePadding = paddingByShape[outputShape] || paddingByShape.bubble;
  const resolvedCardPadding = shapePadding[cardPadding] ?? shapePadding.m;

  const quoteScale = outputShape === 'quote_card'
    ? 1.2
    : (quoteTreatment === 'editorial' ? 1.08 : 1);

  const backgroundStyle = backgroundType === 'transparent'
    ? 'transparent'
    : (backgroundType === 'gradient'
      ? `linear-gradient(to bottom, ${gradientColors[0]}, ${gradientColors[gradientColors.length - 1]})`
      : backgroundColor);

  const bubbleBaseStyle = {
    background: outputShape === 'minimal' ? 'transparent' : bubbleColor,
    padding: outputShape === 'minimal' ? 0 : resolvedCardPadding,
    borderRadius: outputShape === 'minimal' ? 0 : borderRadius,
    marginBottom: 16,
    maxWidth: resolvedMaxWidth,
    color: textColor,
    fontSize: effectiveFontSize,
    lineHeight: lineHeight,
    fontWeight: fontWeight,
    textAlign: outputShape === 'quote_card' ? 'center' : 'left'
  };

  if (outputShape === 'card') {
    bubbleBaseStyle.border = '1px solid rgba(0,0,0,0.15)';
  }
  if (bubbleStyle === 'soft_shadow') {
    bubbleBaseStyle.boxShadow = '6px 6px 20px rgba(0,0,0,0.15)';
  } else if (bubbleStyle === 'hard_shadow') {
    bubbleBaseStyle.boxShadow = '5px 5px 0px rgba(0,0,0,1)';
  } else if (bubbleStyle === 'outline') {
    bubbleBaseStyle.border = '2px solid #000000';
  }

  const messageNodes = await Promise.all(messages.map(async (msg) => {
    const textNodes = await buildMessageTextNodes(msg.quoteText || msg.text || '', quoteScale, outputShape, textColor);
    const authorBlock = (msg.authorName || msg.authorRole || msg.avatarDataUrl)
      ? h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 16
        }
      },
      msg.avatarDataUrl
        ? h('img', {
          src: msg.avatarDataUrl,
          width: 44,
          height: 44,
          style: {
            borderRadius: '50%',
            objectFit: 'cover'
          }
        })
        : null,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        msg.authorName ? h('div', { style: { fontWeight: 500, fontSize: '0.85em', opacity: 0.85 } }, msg.authorName) : null,
        msg.authorRole ? h('div', { style: { fontSize: '0.75em', opacity: 0.65 } }, msg.authorRole) : null
      ))
      : null;

    return h('div', {
      style: {
        ...bubbleBaseStyle,
        alignSelf: outputShape === 'quote_card'
          ? 'center'
          : (msg.side === 'right' ? 'flex-end' : 'flex-start')
      }
    },
    h('div', { style: { display: 'block' } }, ...textNodes),
    authorBlock
    );
  }));

  const contentContainerStyle = layout === 'collage'
    ? {
      display: 'grid',
      gridTemplateColumns: `repeat(${resolvedCollageColumns}, minmax(0, 1fr))`,
      gap: 16,
      padding
    }
    : {
      display: 'flex',
      flexDirection: 'column',
      padding,
      justifyContent: centerVertical ? 'center' : 'flex-start',
      gap: 16
    };

  const containerWidth = width || 800;
  const baseHeight = height || Math.max(
    200,
    messages.length * (effectiveFontSize * 3 + 40) + padding * 2
  );

  return {
    vnode: h('div', {
      style: {
        width: containerWidth,
        height: baseHeight,
        background: backgroundStyle,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }
    },
    h('div', { style: contentContainerStyle }, messageNodes)),
    width: containerWidth,
    height: baseHeight
  };
}

/**
 * Render testimonials to PNG using Satori + Resvg
 */
export async function renderTestimonials(messages, outputPath, options = {}) {
  if (!messages || messages.length === 0) {
    throw new Error('No messages to render');
  }

  const presetName = options.preset || 'raw_bubbles';
  const preset = PRESETS[presetName] || PRESETS.raw_bubbles;
  const config = { ...preset, ...options };

  const fonts = buildFontConfig();

  const { vnode, width, height } = await buildTestimonialVNode(messages, config);
  if (fonts.length > 0) {
    fonts.forEach(font => {
      console.info('SATORI_FONT_SIGNATURE', {
        source: font.source || 'unknown',
        byteLength: font.data.length,
        firstBytesHex: formatFontSignature(font.data)
      });
    });
  }

  let svg;
  try {
    svg = await satori(vnode, {
      width,
      height,
      ...(fonts.length > 0 ? { fonts } : {})
    });
  } catch (error) {
    console.warn('FONT_LOAD_FAILED: Satori failed with custom fonts. Falling back to default fonts.', error);
    svg = await satori(vnode, { width, height });
  }

  const resvg = new Resvg(svg, {
    background: config.backgroundType === 'transparent' ? 'transparent' : undefined
  });
  const pngBuffer = resvg.render().asPng();
  fs.writeFileSync(outputPath, pngBuffer);
  return outputPath;
}

/**
 * Get available presets
 */
export function getPresets() {
  return Object.keys(PRESETS).map(key => ({
    key,
    ...PRESETS[key]
  }));
}
