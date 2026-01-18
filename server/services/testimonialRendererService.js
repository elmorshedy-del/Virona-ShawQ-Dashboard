import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

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

/**
 * Generate HTML for testimonial bubbles
 */
function generateHTML(messages, config) {
  const {
    width,
    height,
    backgroundType,
    backgroundColor = '#ffffff',
    gradientColors = ['#833ab4', '#fcb045'],
    padding = 24,
    bubbleStyle = 'solid',
    bubbleColor = '#ffffff',
    textColor = '#000000',
    fontSize = 28,
    centerVertical = false,
    layout = 'stacked',
    collageColumns = 2,
    logoUrl = null,
    logoPosition = 'bottom_right'
  } = config;

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

  // Bubble style CSS
  let bubbleCSS = `
    background: ${bubbleColor};
    padding: 20px;
    border-radius: 20px;
    margin-bottom: 16px;
    max-width: 500px;
    word-wrap: break-word;
    color: ${textColor};
    font-size: ${fontSize}px;
    line-height: 1.4;
  `;

  if (bubbleStyle === 'soft_shadow') {
    bubbleCSS += 'box-shadow: 6px 6px 20px rgba(0, 0, 0, 0.15);';
  } else if (bubbleStyle === 'hard_shadow') {
    bubbleCSS += 'box-shadow: 5px 5px 0px rgba(0, 0, 0, 1);';
  } else if (bubbleStyle === 'outline') {
    bubbleCSS += 'border: 2px solid #000000;';
  }

  // Layout-specific styles
  let containerStyle = '';
  let bubblesHTML = '';

  if (layout === 'collage' && messages.length > 1) {
    // Collage grid layout
    containerStyle = `
      display: grid;
      grid-template-columns: repeat(${collageColumns}, 1fr);
      gap: 16px;
      padding: ${padding}px;
    `;

    bubblesHTML = messages.map(msg => `
      <div class="bubble" style="${bubbleCSS}">
        ${escapeHtml(msg.text)}
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

    bubblesHTML = messages.map(msg => {
      const alignment = msg.side === 'right' ? 'flex-end' : 'flex-start';
      return `
        <div style="display: flex; justify-content: ${alignment}; margin-bottom: 16px;">
          <div class="bubble" style="${bubbleCSS}">
            ${escapeHtml(msg.text)}
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
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
          ${backgroundStyle}
          width: ${canvasWidth}px;
          ${isAutoHeight ? 'min-height: 100px;' : `height: ${canvasHeight}px;`}
          position: relative;
        }

        .container {
          ${containerStyle}
          width: 100%;
          height: 100%;
        }

        .bubble {
          ${bubbleCSS}
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

  const html = generateHTML(messages, config);

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
