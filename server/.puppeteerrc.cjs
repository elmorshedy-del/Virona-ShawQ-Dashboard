const path = require('path');

const executablePath = typeof process.env.PUPPETEER_EXECUTABLE_PATH === 'string'
  ? process.env.PUPPETEER_EXECUTABLE_PATH.trim()
  : '';

module.exports = {
  cacheDirectory:
    process.env.PUPPETEER_CACHE_DIR ||
    path.join(__dirname, '..', '.cache', 'puppeteer'),
  ...(executablePath ? { executablePath } : {})
};
