const DEFAULT_PUPPETEER_HEADLESS_MODE = 'new';
const DEFAULT_PUPPETEER_LAUNCH_TIMEOUT_MS = 30_000;

const BASE_PUPPETEER_ARGS = Object.freeze([
  '--disable-dev-shm-usage',
  '--disable-gpu'
]);

const NO_SANDBOX_PUPPETEER_ARGS = Object.freeze([
  '--no-sandbox',
  '--disable-setuid-sandbox'
]);

function normalizeString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function uniqueArgs(args) {
  const seen = new Set();
  return args.filter((value) => {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function getConfiguredPuppeteerExecutablePath() {
  const executablePath = normalizeString(process.env.PUPPETEER_EXECUTABLE_PATH);
  return executablePath || undefined;
}

export function buildPuppeteerLaunchOptions(options = {}) {
  const {
    additionalArgs = [],
    executablePath = getConfiguredPuppeteerExecutablePath(),
    headless = DEFAULT_PUPPETEER_HEADLESS_MODE,
    includeNoSandboxArgs = false,
    timeoutMs = DEFAULT_PUPPETEER_LAUNCH_TIMEOUT_MS
  } = options;

  const args = uniqueArgs([
    ...BASE_PUPPETEER_ARGS,
    ...additionalArgs,
    ...(includeNoSandboxArgs ? NO_SANDBOX_PUPPETEER_ARGS : [])
  ]);

  const launchOptions = {
    headless,
    args
  };

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    launchOptions.timeout = timeoutMs;
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  return launchOptions;
}
