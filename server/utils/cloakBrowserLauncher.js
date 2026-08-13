/**
 * CloakBrowser launcher (optional Tier 0 for the landing page fetcher).
 *
 * CloakBrowser (https://github.com/CloakHQ/CloakBrowser) is a stealth Chromium build
 * that ships source-level fingerprint patches and exposes a drop-in Puppeteer API via
 * its `cloakbrowser/puppeteer` entry point.
 *
 * It is deliberately an OPTIONAL dependency:
 *   - The package downloads a platform-specific Chromium binary on first use. If that
 *     download fails (locked-down CI, no egress, unsupported arch), we must not take
 *     the whole audit service down with it.
 *   - The module is therefore imported lazily, inside a try/catch, and any failure
 *     falls back to the existing puppeteer-extra + stealth tier.
 *
 * Enable with LPA_CLOAKBROWSER=1. Licensing (per upstream README): the latest binary is
 * free via GitHub sign-in at ONE concurrent session; higher concurrency needs a paid key
 * supplied as CLOAKBROWSER_LICENSE_KEY. Because this runs behind an HTTP endpoint that
 * can be hit concurrently, launches are serialized through a promise chain so we never
 * exceed the configured session budget.
 */

const DEFAULT_MAX_CONCURRENT_SESSIONS = 1;

function readFlag(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

export function isCloakBrowserEnabled() {
  return readFlag('LPA_CLOAKBROWSER');
}

function readMaxConcurrentSessions() {
  const raw = Number.parseInt(process.env.LPA_CLOAKBROWSER_MAX_SESSIONS || '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_MAX_CONCURRENT_SESSIONS;
}

/* ── Session gate ──
 * A minimal counting semaphore. Free-tier CloakBrowser allows a single concurrent
 * session, so a second overlapping audit would otherwise fail the launch outright.
 */
let activeSessions = 0;
const waiters = [];

function acquireSession() {
  const limit = readMaxConcurrentSessions();
  if (activeSessions < limit) {
    activeSessions += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => { waiters.push(resolve); });
}

function releaseSession() {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  activeSessions = Math.max(0, activeSessions - 1);
}

/* ── Lazy module resolution ── */
let cloakModulePromise = null;

async function loadCloakBrowser() {
  if (!cloakModulePromise) {
    cloakModulePromise = import('cloakbrowser/puppeteer').catch((error) => {
      cloakModulePromise = null;
      throw new Error(
        `CloakBrowser is enabled (LPA_CLOAKBROWSER=1) but the "cloakbrowser" package could not be loaded: ${error?.message || error}. `
        + 'Install it with `npm install cloakbrowser puppeteer-core`, or unset LPA_CLOAKBROWSER to use the standard stealth tier.'
      );
    });
  }
  return cloakModulePromise;
}

/**
 * Launch a CloakBrowser instance exposing the Puppeteer browser API.
 *
 * Returns a browser whose `close()` also releases the concurrency slot, so callers can
 * keep using the existing `try { … } finally { await browser.close(); }` shape.
 */
export async function launchCloakBrowser({ headless = true, timeoutMs = 30_000, args = [] } = {}) {
  const { launch } = await loadCloakBrowser();

  await acquireSession();

  let browser;
  try {
    const licenseKey = String(process.env.CLOAKBROWSER_LICENSE_KEY || '').trim();
    browser = await launch({
      headless,
      args,
      // CloakBrowser's LaunchOptions has no top-level `timeout`; anything meant for
      // puppeteer's own launch() must be nested under `launchOptions`.
      launchOptions: { timeout: timeoutMs },
      // `licenseKey` also falls back to CLOAKBROWSER_LICENSE_KEY internally; passing it
      // explicitly keeps the dependency on that env var visible at the call site.
      ...(licenseKey ? { licenseKey } : {})
    });
  } catch (error) {
    releaseSession();
    throw error;
  }

  const originalClose = browser.close.bind(browser);
  let released = false;
  browser.close = async (...closeArgs) => {
    try {
      return await originalClose(...closeArgs);
    } finally {
      if (!released) {
        released = true;
        releaseSession();
      }
    }
  };

  return browser;
}

export default {
  isCloakBrowserEnabled,
  launchCloakBrowser
};
