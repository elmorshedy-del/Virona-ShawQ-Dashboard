import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import twemoji from 'twemoji';

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

const emojiSvgCache = new Map();

async function fetchEmojiDataUrl(src) {
  if (emojiSvgCache.has(src)) {
    return emojiSvgCache.get(src);
  }
  try {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch emoji: ${response.status}`);
    }
    const svgText = await response.text();
    const base64 = Buffer.from(svgText).toString('base64');
    const dataUrl = `data:image/svg+xml;base64,${base64}`;
    emojiSvgCache.set(src, dataUrl);
    return dataUrl;
  } catch (error) {
    console.warn('Emoji fetch failed:', error);
    emojiSvgCache.set(src, src);
    return src;
  }
}

async function renderTextWithTwemoji(text) {
  const safeText = escapeHtml(text);
  const parsed = twemoji.parse(safeText, { folder: 'svg', ext: '.svg', className: 'emoji' });
  const matches = [...parsed.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/g)];
  if (matches.length === 0) {
    return parsed;
  }

  const uniqueSrcs = Array.from(new Set(matches.map(match => match[1])));
  const replacements = await Promise.all(
    uniqueSrcs.map(async (src) => ({
      src,
      dataUrl: await fetchEmojiDataUrl(src)
    }))
  );

  let hydrated = parsed;
  replacements.forEach(({ src, dataUrl }) => {
    hydrated = hydrated.replaceAll(src, dataUrl);
  });

  return hydrated;
}

/**
 * Generate HTML for testimonial bubbles
 */
async function generateHTML(messages, config) {
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
    collageColumns = 2,
    logoUrl = null,
    logoPosition = 'bottom_right'
  } = config;

  const resolvedCollageColumns = Math.min(4, Math.max(2, Number(collageColumns) || 2));

  // Calculate auto dimensions if needed
  const isAutoWidth = width === null || width === undefined;
  const isAutoHeight = height === null || height === undefined;
  const canvasWidth = isAutoWidth ? 800 : width;
  const canvasHeight = isAutoHeight ? 'auto' : height;

  // Background style
  let backgroundStyle = '';
  if (backgroundType === 'transparent') {
    backgroundStyle = 'background: transparent;';
  } else if (backgroundType === 'gradient' && gradientColors.length >= 2) {
    backgroundStyle = `background: linear-gradient(to bottom, ${gradientColors[0]}, ${gradientColors[gradientColors.length - 1]});`;
  } else {
    backgroundStyle = `background: ${backgroundColor};`;
  }

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

  // Bubble style CSS - varies by output shape
  let bubbleCSS = '';

  if (outputShape === 'minimal') {
    // Minimal: no container, just text
    bubbleCSS = `
      color: ${textColor};
      font-size: ${effectiveFontSize}px;
      line-height: ${lineHeight};
      font-weight: ${fontWeight};
      margin-bottom: 16px;
      max-width: ${resolvedMaxWidth};
      word-wrap: break-word;
    `;
  } else if (outputShape === 'quote_card') {
    // Quote card: centered with quotes
    bubbleCSS = `
      background: ${bubbleColor};
      padding: ${resolvedCardPadding}px;
      border-radius: ${borderRadius}px;
      margin-bottom: 16px;
      max-width: ${resolvedMaxWidth};
      word-wrap: break-word;
      color: ${textColor};
      font-size: ${effectiveFontSize}px;
      line-height: ${lineHeight};
      font-weight: ${fontWeight};
      text-align: center;
      position: relative;
    `;
  } else if (outputShape === 'card') {
    // Card: rectangle with border
    bubbleCSS = `
      background: ${bubbleColor};
      padding: ${resolvedCardPadding}px;
      border-radius: ${borderRadius}px;
      margin-bottom: 16px;
      max-width: ${resolvedMaxWidth};
      word-wrap: break-word;
      color: ${textColor};
      font-size: ${effectiveFontSize}px;
      line-height: ${lineHeight};
      font-weight: ${fontWeight};
      border: 1px solid rgba(0, 0, 0, 0.15);
    `;
  } else {
    // Default bubble
    bubbleCSS = `
      background: ${bubbleColor};
      padding: ${resolvedCardPadding}px;
      border-radius: ${borderRadius}px;
      margin-bottom: 16px;
      max-width: ${resolvedMaxWidth};
      word-wrap: break-word;
      color: ${textColor};
      font-size: ${effectiveFontSize}px;
      line-height: ${lineHeight};
      font-weight: ${fontWeight};
    `;
  }

  // Apply bubble style effects (shadow, outline) - skip for minimal
  if (outputShape !== 'minimal') {
    if (bubbleStyle === 'soft_shadow') {
      bubbleCSS += 'box-shadow: 6px 6px 20px rgba(0, 0, 0, 0.15);';
    } else if (bubbleStyle === 'hard_shadow') {
      bubbleCSS += 'box-shadow: 5px 5px 0px rgba(0, 0, 0, 1);';
    } else if (bubbleStyle === 'outline') {
      bubbleCSS += 'border: 2px solid #000000;';
    }
  }

  // Layout-specific styles
  let containerStyle = '';
  let bubblesHTML = '';

  const formatMessage = async (text) => {
    if (outputShape === 'quote_card') {
      const inner = await renderTextWithTwemoji(text);
      return `<span class="quote quote--open" style="font-size: ${quoteScale}em;">“</span>${inner}<span class="quote quote--close" style="font-size: ${quoteScale}em;">”</span>`;
    }
    return renderTextWithTwemoji(text);
  };

  const buildAvatarMarkup = (msg) => {
    if (!msg.avatarDataUrl) {
      return '';
    }
    const fallbackPlacement = { xPct: 6, yPct: 6, wPct: 12, hPct: 12 };
    const placement = msg.avatarPlacementPct || fallbackPlacement;
    const { xPct, yPct, wPct, hPct } = placement;
    const shapeClass = msg.avatarShape === 'circle' ? 'avatar--circle' : 'avatar--rounded';
    return `
      <img
        class="avatar ${shapeClass}"
        src="${msg.avatarDataUrl}"
        alt=""
        style="left: ${xPct}%; top: ${yPct}%; width: ${wPct}%; height: ${hPct}%;"
      />
    `;
  };

  const buildAuthorMarkup = (msg) => {
    if (!msg.authorName && !msg.authorRole) {
      return '';
    }
    return `
      <div class="author">
        ${msg.authorName ? `<div class="author-name">${escapeHtml(msg.authorName)}</div>` : ''}
        ${msg.authorRole ? `<div class="author-role">${escapeHtml(msg.authorRole)}</div>` : ''}
      </div>
    `;
  };

  const buildAvatarPadding = (msg) => {
    if (!msg.avatarDataUrl) {
      return '';
    }
    const fallbackPlacement = { xPct: 6, yPct: 6, wPct: 12, hPct: 12 };
    const placement = msg.avatarPlacementPct || fallbackPlacement;
    const { xPct, yPct, wPct, hPct } = placement;
    const paddingBuffer = 12;
    const styles = [];
    if (xPct < 50) {
      styles.push(`padding-left: calc(${xPct + wPct}% + ${paddingBuffer}px);`);
    } else {
      styles.push(`padding-right: calc(${100 - xPct}% + ${paddingBuffer}px);`);
    }
    if (yPct < 50) {
      styles.push(`padding-top: calc(${yPct + hPct}% + ${paddingBuffer}px);`);
    }
    return styles.join(' ');
  };

  const formattedMessages = await Promise.all(
    messages.map(async (msg) => ({
      ...msg,
      formattedText: await formatMessage(msg.quoteText || msg.text || '')
    }))
  );

  if (layout === 'collage') {
    // Collage grid layout
    containerStyle = `
      display: grid;
      grid-template-columns: repeat(${resolvedCollageColumns}, minmax(0, 1fr));
      gap: 16px;
      padding: ${padding}px;
    `;

    bubblesHTML = formattedMessages.map(msg => `
      <div class="bubble ${msg.avatarDataUrl ? 'has-avatar' : ''}" style="${bubbleCSS} ${buildAvatarPadding(msg)}">
        ${buildAvatarMarkup(msg)}
        <div class="bubble-content">
          <div class="message-text">
            ${msg.formattedText}
          </div>
          ${buildAuthorMarkup(msg)}
        </div>
      </div>
    `).join('');
  } else {
    // Stacked layout
    containerStyle = `
      display: flex;
      flex-direction: column;
      padding: ${padding}px;
      ${centerVertical && !isAutoHeight ? 'justify-content: center;' : ''}
    `;

    bubblesHTML = formattedMessages.map(msg => {
      const alignment = msg.side === 'right' ? 'flex-end' : 'flex-start';
      // Center quote cards regardless of side
      const actualAlignment = outputShape === 'quote_card' ? 'center' : alignment;
      return `
        <div style="display: flex; justify-content: ${actualAlignment}; margin-bottom: 16px;">
          <div class="bubble ${msg.avatarDataUrl ? 'has-avatar' : ''}" style="${bubbleCSS} ${buildAvatarPadding(msg)}">
            ${buildAvatarMarkup(msg)}
            <div class="bubble-content">
              <div class="message-text">
                ${msg.formattedText}
              </div>
              ${buildAuthorMarkup(msg)}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Logo HTML
  let logoHTML = '';
  if (logoUrl) {
    const logoPositions = {
      'bottom_right': 'bottom: 20px; right: 20px;',
      'bottom_left': 'bottom: 20px; left: 20px;',
      'top_right': 'top: 20px; right: 20px;',
      'top_left': 'top: 20px; left: 20px;'
    };
    const positionStyle = logoPositions[logoPosition] || logoPositions['bottom_right'];

    logoHTML = `
      <img src="${logoUrl}"
           style="position: absolute; ${positionStyle} max-height: 60px; width: auto; z-index: 100;" />
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial',
            'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
          ${backgroundStyle}
          width: ${canvasWidth}px;
          ${isAutoHeight ? 'min-height: 100px;' : `height: ${canvasHeight}px;`}
          position: relative;
        }

        html {
          background: ${backgroundType === 'transparent' ? 'transparent' : backgroundColor};
        }

        .container {
          ${containerStyle}
          width: 100%;
          height: 100%;
        }

        .bubble {
          ${bubbleCSS}
        }

        .bubble.has-avatar {
          position: relative;
        }

        .bubble-content {
          display: flex;
          flex-direction: column;
          gap: 10px;
          position: relative;
          z-index: 2;
        }

        .quote {
          color: ${textColor};
          opacity: 0.85;
          font-weight: inherit;
        }

        .quote--open {
          margin-right: 0.15em;
        }

        .quote--close {
          margin-left: 0.15em;
        }

        .author {
          font-size: 0.85em;
          color: ${textColor};
          opacity: 0.7;
        }

        .author-name {
          font-weight: 500;
        }

        .author-role {
          margin-top: 2px;
        }

        .emoji {
          height: 1em;
          width: 1em;
          vertical-align: -0.1em;
        }

        .avatar {
          position: absolute;
          object-fit: cover;
          z-index: 1;
        }

        .avatar--circle {
          border-radius: 9999px;
        }

        .avatar--rounded {
          border-radius: 16px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${bubblesHTML}
      </div>
      ${logoHTML}
    </body>
    </html>
  `;

  return html;
}

/**
 * Escape HTML to prevent XSS
 */
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

/**
 * Render testimonials to PNG using Puppeteer
 * @param {Array} messages - Array of message objects
 * @param {string} outputPath - Output file path
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} Path to generated image
 */
export async function renderTestimonials(messages, outputPath, options = {}) {
  if (!messages || messages.length === 0) {
    throw new Error('No messages to render');
  }

  // Merge preset with custom options
  const presetName = options.preset || 'raw_bubbles';
  const preset = PRESETS[presetName] || PRESETS.raw_bubbles;
  const config = { ...preset, ...options };

  const html = await generateHTML(messages, config);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // Set viewport
    const viewportWidth = config.width || 800;
    const viewportHeight = config.height || 600;
    await page.setViewport({
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 2 // For better quality
    });

    // Set content
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    await page.waitForFunction(
      () => Array.from(document.images).every(img => img.complete),
      { timeout: 5000 }
    ).catch(() => {});

    // For auto-height, calculate actual height
    let screenshotOptions = {
      path: outputPath,
      type: 'png',
      omitBackground: config.backgroundType === 'transparent'
    };

    if (config.height === null || config.height === undefined) {
      // Auto-fit height
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.setViewport({
        width: viewportWidth,
        height: bodyHeight,
        deviceScaleFactor: 2
      });
      screenshotOptions.fullPage = true;
    }

    await page.screenshot(screenshotOptions);

    return outputPath;

  } catch (error) {
    console.error('Rendering error:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
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
