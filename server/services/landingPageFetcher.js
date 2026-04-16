import dns from 'dns/promises';
import net from 'net';

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const NAVIGATION_TIMEOUT_MS = 30_000;
const DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1 });
const MOBILE_VIEWPORT = Object.freeze({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const MAX_VISIBLE_TEXT_CHARS = 30_000;
const MAX_CAPTURED_COLORS = 120;
const CTA_ACTION_WORDS = /\b(sign up|signup|start|get|buy|purchase|book|download|try|join|subscribe|learn more|contact|demo|shop|add to cart|checkout)\b/i;
const STEALTH_PLUGIN = StealthPlugin();

puppeteerExtra.use(STEALTH_PLUGIN);

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

export async function fetchLandingPageData(targetUrl) {
  const parsedUrl = normalizeTargetUrl(targetUrl);
  await assertNoPrivateNetworkTarget(parsedUrl);

  let browser;
  const consoleErrors = [];
  const jsErrors = [];

  try {
    browser = await puppeteerExtra.launch({
      headless: 'new',
      timeout: NAVIGATION_TIMEOUT_MS
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
      console.warn('[LandingPageFetcher] Navigation issue:', error.message);
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
  } catch (error) {
    return {
      url: parsedUrl.toString(),
      finalUrl: parsedUrl.toString(),
      fetchedAt: new Date().toISOString(),
      error: error?.message || 'Failed to fetch landing page',
      consoleErrors,
      jsErrors,
      partial: true,
      screenshots: {
        desktopBase64: null,
        mobileBase64: null
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export default {
  fetchLandingPageData
};
