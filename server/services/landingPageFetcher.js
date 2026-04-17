import dns from 'dns/promises';
import net from 'net';

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

/* ── Configuration constants ── */
const NAVIGATION_TIMEOUT_MS = 30_000;
const HTTP_FETCH_TIMEOUT_MS = 20_000;
const DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1 });
const MOBILE_VIEWPORT = Object.freeze({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const MAX_VISIBLE_TEXT_CHARS = 30_000;
const MAX_HTML_RESPONSE_BYTES = 5_000_000; // 5 MB safety cap for HTTP-only fetch
const MAX_CAPTURED_COLORS = 120;
const CTA_ACTION_WORDS = /\b(sign up|signup|start|get|buy|purchase|book|download|try|join|subscribe|learn more|contact|demo|shop|add to cart|checkout)\b/i;
const STEALTH_PLUGIN = StealthPlugin();

/**
 * Environment flag to enable --no-sandbox for Puppeteer.
 * Other services in this codebase (croForensics, sessionIntelligence, facebookAdsScraper)
 * already use --no-sandbox. This flag allows operators to opt-in for the landing page
 * fetcher when running inside containers / CI without a sandbox-capable Chromium.
 *
 * Risk acceptance: running Chromium without a sandbox means a compromised renderer
 * process has fewer barriers to the host OS. This is acceptable when the process
 * already runs in a container or ephemeral VM (Railway, Docker, CI runners).
 */
const PUPPETEER_NO_SANDBOX = process.env.LPA_PUPPETEER_NO_SANDBOX === '1'
  || process.env.LPA_PUPPETEER_NO_SANDBOX === 'true';

puppeteerExtra.use(STEALTH_PLUGIN);

/* ── Shared utilities ── */

function normalizeTargetUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('URL is required.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  if (!parsed.hostname) {
    throw new Error('Invalid URL hostname.');
  }
  parsed.hash = '';
  return parsed;
}

function isPrivateIp(ip) {
  if (!ip) return false;
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split('.').map((part) => Number.parseInt(part, 10));
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

async function assertNoPrivateNetworkTarget(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed. Use a public URL.');
  }

  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Private network URLs are not allowed.');
  }

  let resolved;
  try {
    resolved = await dns.lookup(parsedUrl.hostname, { all: true });
  } catch (error) {
    throw new Error(`Could not resolve host: ${error.message}`);
  }

  if (resolved.some((entry) => isPrivateIp(entry?.address))) {
    throw new Error('Resolved host points to a private or loopback address.');
  }
}

function sanitizeText(value, maxLength = MAX_VISIBLE_TEXT_CHARS) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function safeMs(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * TIER 1 — Puppeteer (full browser, screenshots, JS execution, performance)
 * ══════════════════════════════════════════════════════════════════════════════ */

async function fetchViaPuppeteer(parsedUrl) {
  const launchArgs = [];
  if (PUPPETEER_NO_SANDBOX) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  let browser;
  const consoleErrors = [];
  const jsErrors = [];

  try {
    browser = await puppeteerExtra.launch({
      headless: 'new',
      timeout: NAVIGATION_TIMEOUT_MS,
      args: launchArgs
    });

    const page = await browser.newPage();
    await page.setViewport(DESKTOP_VIEWPORT);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(sanitizeText(message.text(), 500));
      }
    });

    page.on('pageerror', (error) => {
      jsErrors.push(sanitizeText(error?.message || 'Unknown JS error', 500));
    });

    let responseStatus = null;
    let finalUrl = parsedUrl.toString();
    try {
      const response = await page.goto(parsedUrl.toString(), {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT_MS
      });
      responseStatus = response?.status() ?? null;
      finalUrl = page.url() || finalUrl;
    } catch (error) {
      console.warn('[LandingPageFetcher] Puppeteer navigation issue:', error.message);
    }

    const desktopScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64', type: 'png' });
    await page.setViewport(MOBILE_VIEWPORT);
    await page.waitForTimeout(400);
    const mobileScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64', type: 'png' });
    await page.setViewport(DESKTOP_VIEWPORT);

    const pageSnapshot = await page.evaluate(({ ctaRegexSource, maxColors }) => {
      const ctaRegex = new RegExp(ctaRegexSource, 'i');
      const metas = Array.from(document.querySelectorAll('meta'));
      const metaDescription =
        document.querySelector('meta[name="description"]')?.getAttribute('content')
        || document.querySelector('meta[property="og:description"]')?.getAttribute('content')
        || '';

      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((node) => ({
        tag: node.tagName.toLowerCase(),
        text: (node.textContent || '').trim()
      })).filter((item) => item.text);

      const ctas = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"]'))
        .map((node) => {
          const text = (node.textContent || node.value || node.getAttribute('aria-label') || '').trim();
          const href = node.tagName.toLowerCase() === 'a' ? node.getAttribute('href') || '' : '';
          const rect = node.getBoundingClientRect();
          return {
            text,
            href,
            tag: node.tagName.toLowerCase(),
            visible: rect.width > 0 && rect.height > 0,
            aboveFold: rect.top >= 0 && rect.top < window.innerHeight
          };
        })
        .filter((item) => item.visible && item.text && ctaRegex.test(item.text));

      const images = Array.from(document.images).map((img) => ({
        src: img.currentSrc || img.src || '',
        alt: img.alt || '',
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        renderedWidth: Math.round(img.getBoundingClientRect().width),
        renderedHeight: Math.round(img.getBoundingClientRect().height),
        isBroken: Boolean(img.complete && img.naturalWidth === 0)
      }));

      const forms = Array.from(document.querySelectorAll('form')).map((form, index) => ({
        id: form.id || `form-${index + 1}`,
        fieldCount: form.querySelectorAll('input, textarea, select, button').length,
        hasSubmitControl: Boolean(form.querySelector('button[type="submit"], input[type="submit"]'))
      }));

      const styleText = Array.from(document.querySelectorAll('style')).map((node) => node.textContent || '').join('\n');
      const hasOutlineNone = /outline\s*:\s*none/i.test(styleText);
      const hasTransitionAll = /transition\s*:\s*all/i.test(styleText);

      const allElements = Array.from(document.querySelectorAll('body *')).slice(0, 800);
      const fontSizes = [];
      const colors = [];
      allElements.forEach((element) => {
        const style = window.getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize || '0');
        if (Number.isFinite(fontSize) && fontSize > 0) {
          fontSizes.push(fontSize);
        }
        if (style.color && colors.length < maxColors) {
          colors.push(style.color);
        }
      });

      const ogTags = metas
        .filter((meta) => String(meta.getAttribute('property') || '').startsWith('og:'))
        .map((meta) => ({
          property: meta.getAttribute('property') || '',
          content: meta.getAttribute('content') || ''
        }))
        .filter((tag) => tag.property && tag.content);

      const navTiming = performance.getEntriesByType('navigation')?.[0] || null;
      const lcpEntry = performance.getEntriesByType('largest-contentful-paint')?.slice(-1)?.[0] || null;

      const allText = (document.body?.innerText || '').trim();
      const title = (document.title || '').trim();

      return {
        html: document.documentElement?.outerHTML || '',
        title,
        metaDescription,
        ogTags,
        headings,
        visibleText: allText,
        ctas,
        images,
        forms,
        cssChecks: {
          hasOutlineNone,
          hasTransitionAll
        },
        horizontalScroll: (document.documentElement?.scrollWidth || 0) > window.innerWidth,
        minFontSize: fontSizes.length ? Math.min(...fontSizes) : null,
        colorValues: Array.from(new Set(colors)),
        performance: {
          ttfbMs: navTiming ? navTiming.responseStart - navTiming.requestStart : null,
          loadTimeMs: navTiming ? navTiming.loadEventEnd - navTiming.startTime : null,
          domContentLoadedMs: navTiming ? navTiming.domContentLoadedEventEnd - navTiming.startTime : null,
          lcpMs: lcpEntry?.startTime ?? null
        }
      };
    }, { ctaRegexSource: CTA_ACTION_WORDS.source, maxColors: MAX_CAPTURED_COLORS });

    const brokenImages = pageSnapshot.images.filter((image) => image.isBroken).map((image) => image.src);

    return {
      url: parsedUrl.toString(),
      finalUrl,
      statusCode: responseStatus,
      fetchedAt: new Date().toISOString(),
      fetchStrategy: 'puppeteer',
      protocol: new URL(finalUrl).protocol.replace(':', ''),
      https: new URL(finalUrl).protocol === 'https:',
      html: pageSnapshot.html,
      title: pageSnapshot.title,
      metaDescription: pageSnapshot.metaDescription,
      ogTags: pageSnapshot.ogTags,
      headings: pageSnapshot.headings,
      visibleText: sanitizeText(pageSnapshot.visibleText),
      ctas: pageSnapshot.ctas,
      images: pageSnapshot.images,
      brokenImages,
      forms: pageSnapshot.forms,
      cssChecks: pageSnapshot.cssChecks,
      consoleErrors,
      jsErrors,
      performance: {
        ttfbMs: safeMs(pageSnapshot.performance.ttfbMs),
        loadTimeMs: safeMs(pageSnapshot.performance.loadTimeMs),
        domContentLoadedMs: safeMs(pageSnapshot.performance.domContentLoadedMs),
        lcpMs: safeMs(pageSnapshot.performance.lcpMs)
      },
      diagnostics: {
        horizontalScroll: Boolean(pageSnapshot.horizontalScroll),
        minFontSizePx: pageSnapshot.minFontSize,
        colorValues: pageSnapshot.colorValues
      },
      screenshots: {
        desktopBase64: desktopScreenshot,
        mobileBase64: mobileScreenshot
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * TIER 2 — Lightweight HTTP fetch + regex-based HTML parsing (no browser)
 *
 * Works in every Node.js environment (containers, CI, serverless). No Chromium
 * needed. Trades screenshot / JS-execution fidelity for guaranteed availability.
 * The AI scoring engine can still produce useful scores from raw HTML + text.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** Minimal regex-based HTML helpers (avoids adding cheerio dependency). */
function extractTagContent(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const matches = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return matches;
}

function extractHeadings(html) {
  const headings = [];
  const regex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) headings.push({ tag: match[1].toLowerCase(), text });
  }
  return headings;
}

function extractMetaContent(html, attr, value) {
  const regex = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*>`, 'i');
  const match = html.match(regex);
  if (!match) return '';
  const contentMatch = match[0].match(/content=["']([^"']*?)["']/i);
  return contentMatch ? contentMatch[1] : '';
}

function extractOgTags(html) {
  const tags = [];
  const regex = /<meta[^>]+property=["'](og:[^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const property = match[1];
    const contentMatch = match[0].match(/content=["']([^"']*?)["']/i);
    if (contentMatch && contentMatch[1]) {
      tags.push({ property, content: contentMatch[1] });
    }
  }
  return tags;
}

function extractImages(html) {
  const images = [];
  const regex = /<img[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const srcMatch = match[0].match(/src=["']([^"']*?)["']/i);
    const altMatch = match[0].match(/alt=["']([^"']*?)["']/i);
    const widthMatch = match[0].match(/width=["']?(\d+)/i);
    const heightMatch = match[0].match(/height=["']?(\d+)/i);
    images.push({
      src: srcMatch ? srcMatch[1] : '',
      alt: altMatch ? altMatch[1] : '',
      width: widthMatch ? Number(widthMatch[1]) : 0,
      height: heightMatch ? Number(heightMatch[1]) : 0,
      renderedWidth: 0,
      renderedHeight: 0,
      isBroken: false
    });
  }
  return images;
}

function extractCtas(html) {
  const ctas = [];
  // Match <a>, <button>, and input[type="submit"] tags
  const linkRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  const buttonRegex = /<button[^>]*>([\s\S]*?)<\/button>/gi;
  const inputRegex = /<input[^>]+type=["'](submit|button)["'][^>]*>/gi;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const hrefMatch = match[0].match(/href=["']([^"']*?)["']/i);
    if (text && CTA_ACTION_WORDS.test(text)) {
      ctas.push({ text, href: hrefMatch ? hrefMatch[1] : '', tag: 'a', visible: true, aboveFold: false });
    }
  }
  while ((match = buttonRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && CTA_ACTION_WORDS.test(text)) {
      ctas.push({ text, href: '', tag: 'button', visible: true, aboveFold: false });
    }
  }
  while ((match = inputRegex.exec(html)) !== null) {
    const valueMatch = match[0].match(/value=["']([^"']*?)["']/i);
    const text = valueMatch ? valueMatch[1] : '';
    if (text && CTA_ACTION_WORDS.test(text)) {
      ctas.push({ text, href: '', tag: 'input', visible: true, aboveFold: false });
    }
  }
  return ctas;
}

function extractForms(html) {
  const forms = [];
  const regex = /<form[^>]*>([\s\S]*?)<\/form>/gi;
  let match;
  let index = 0;
  while ((match = regex.exec(html)) !== null) {
    const idMatch = match[0].match(/id=["']([^"']*?)["']/i);
    const inner = match[1];
    const fieldCount = (inner.match(/<(input|textarea|select|button)\b/gi) || []).length;
    const hasSubmit = /<(button[^>]*type=["']submit|input[^>]*type=["']submit)/i.test(inner);
    forms.push({
      id: idMatch ? idMatch[1] : `form-${index + 1}`,
      fieldCount,
      hasSubmitControl: hasSubmit
    });
    index++;
  }
  return forms;
}

function extractCssChecks(html) {
  const styleBlocks = extractTagContent(html, 'style');
  const allStyle = styleBlocks.join('\n');
  return {
    hasOutlineNone: /outline\s*:\s*none/i.test(allStyle),
    hasTransitionAll: /transition\s*:\s*all/i.test(allStyle)
  };
}

function stripHtmlTags(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchViaHttp(parsedUrl) {
  const startMs = Date.now();

  const response = await fetch(parsedUrl.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS)
  });

  const loadTimeMs = Date.now() - startMs;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(`Non-HTML content type: ${contentType.slice(0, 100)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_HTML_RESPONSE_BYTES) {
    throw new Error(`Response too large: ${Math.round(arrayBuffer.byteLength / 1_000_000)} MB exceeds safety cap.`);
  }
  const html = new TextDecoder().decode(arrayBuffer);

  const finalUrl = response.url || parsedUrl.toString();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
  const metaDescription = extractMetaContent(html, 'name', 'description')
    || extractMetaContent(html, 'property', 'og:description')
    || '';

  const visibleText = stripHtmlTags(html);

  return {
    url: parsedUrl.toString(),
    finalUrl,
    statusCode: response.status,
    fetchedAt: new Date().toISOString(),
    fetchStrategy: 'http',
    protocol: new URL(finalUrl).protocol.replace(':', ''),
    https: new URL(finalUrl).protocol === 'https:',
    html,
    title,
    metaDescription,
    ogTags: extractOgTags(html),
    headings: extractHeadings(html),
    visibleText: sanitizeText(visibleText),
    ctas: extractCtas(html),
    images: extractImages(html),
    brokenImages: [],
    forms: extractForms(html),
    cssChecks: extractCssChecks(html),
    consoleErrors: [],
    jsErrors: [],
    performance: {
      ttfbMs: null,
      loadTimeMs: safeMs(loadTimeMs),
      domContentLoadedMs: null,
      lcpMs: null
    },
    diagnostics: {
      horizontalScroll: false,
      minFontSizePx: null,
      colorValues: []
    },
    screenshots: {
      desktopBase64: null,
      mobileBase64: null
    },
    warnings: [
      'Fetched via HTTP-only mode (no browser). Screenshots, JS-rendered content, computed styles, and Web Vitals are unavailable.',
      'Visual hierarchy, font sizes, actual CTA visibility, and broken-image detection may be inaccurate.'
    ]
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * TIER 3 — User-supplied raw HTML + optional screenshots
 *
 * Bypasses fetching entirely. The user pastes HTML (and optionally supplies
 * base64 screenshots). Useful when the site is behind auth, bot protection,
 * or the environment has no network access to the target.
 * ══════════════════════════════════════════════════════════════════════════════ */

export function buildPageDataFromRawHtml({
  rawHtml,
  url = 'user-supplied',
  desktopScreenshot = null,
  mobileScreenshot = null
}) {
  const html = String(rawHtml || '');
  if (!html.trim()) {
    throw new Error('rawHtml is required when using manual input mode.');
  }

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
  const metaDescription = extractMetaContent(html, 'name', 'description')
    || extractMetaContent(html, 'property', 'og:description')
    || '';
  const visibleText = stripHtmlTags(html);

  return {
    url,
    finalUrl: url,
    statusCode: null,
    fetchedAt: new Date().toISOString(),
    fetchStrategy: 'manual',
    protocol: 'unknown',
    https: false,
    html,
    title,
    metaDescription,
    ogTags: extractOgTags(html),
    headings: extractHeadings(html),
    visibleText: sanitizeText(visibleText),
    ctas: extractCtas(html),
    images: extractImages(html),
    brokenImages: [],
    forms: extractForms(html),
    cssChecks: extractCssChecks(html),
    consoleErrors: [],
    jsErrors: [],
    performance: {
      ttfbMs: null,
      loadTimeMs: null,
      domContentLoadedMs: null,
      lcpMs: null
    },
    diagnostics: {
      horizontalScroll: false,
      minFontSizePx: null,
      colorValues: []
    },
    screenshots: {
      desktopBase64: desktopScreenshot || null,
      mobileBase64: mobileScreenshot || null
    },
    warnings: [
      'Page data supplied manually — screenshots, JS-rendered content, Web Vitals, and console errors are unavailable unless provided.',
      'Scores for Performance and Mobile & Access dimensions may be less accurate.'
    ]
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * ORCHESTRATOR — multi-tier fallback chain
 *
 * Tier 1: Puppeteer (full fidelity)
 *   ↓ fails
 * Tier 2: Lightweight HTTP fetch (no browser)
 *   ↓ fails
 * Returns partial error result with diagnostic context
 * ══════════════════════════════════════════════════════════════════════════════ */

export async function fetchLandingPageData(targetUrl) {
  const parsedUrl = normalizeTargetUrl(targetUrl);
  await assertNoPrivateNetworkTarget(parsedUrl);

  const tierErrors = [];

  /* ── Tier 1: Puppeteer ── */
  try {
    console.log('[LandingPageFetcher] Tier 1: attempting Puppeteer fetch…');
    const result = await fetchViaPuppeteer(parsedUrl);
    console.log('[LandingPageFetcher] Tier 1 succeeded (Puppeteer).');
    return result;
  } catch (puppeteerError) {
    const msg = puppeteerError?.message || 'Unknown Puppeteer error';
    console.warn('[LandingPageFetcher] Tier 1 failed (Puppeteer):', msg);
    tierErrors.push({ tier: 'puppeteer', error: msg });
  }

  /* ── Tier 2: HTTP-only fetch ── */
  try {
    console.log('[LandingPageFetcher] Tier 2: attempting HTTP-only fetch…');
    const result = await fetchViaHttp(parsedUrl);
    console.log('[LandingPageFetcher] Tier 2 succeeded (HTTP).');
    result.tierErrors = tierErrors;
    return result;
  } catch (httpError) {
    const msg = httpError?.message || 'Unknown HTTP fetch error';
    console.warn('[LandingPageFetcher] Tier 2 failed (HTTP):', msg);
    tierErrors.push({ tier: 'http', error: msg });
  }

  /* ── All tiers exhausted — return diagnostic partial result ── */
  console.error('[LandingPageFetcher] All fetch tiers failed:', tierErrors);
  return {
    url: parsedUrl.toString(),
    finalUrl: parsedUrl.toString(),
    fetchedAt: new Date().toISOString(),
    fetchStrategy: 'none',
    error: `All fetch strategies failed. ${tierErrors.map((e) => `[${e.tier}] ${e.error}`).join(' | ')}`,
    tierErrors,
    consoleErrors: [],
    jsErrors: [],
    partial: true,
    screenshots: {
      desktopBase64: null,
      mobileBase64: null
    },
    warnings: [
      'Could not fetch the page via any strategy. Consider pasting raw HTML manually.',
      'Tip: Set LPA_PUPPETEER_NO_SANDBOX=1 if running inside a container/CI to enable Puppeteer.'
    ]
  };
}

export default {
  fetchLandingPageData,
  buildPageDataFromRawHtml
};
