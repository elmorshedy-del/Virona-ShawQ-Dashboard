import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// DISABLED: face-api.js - replaced with SCRFD Python microservice
// =============================================================================
// import * as faceapi from 'face-api.js';
// import canvas from 'canvas';
// =============================================================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISION_PROMPT = `Analyze this chat screenshot. Extract every message bubble you see.

Return ONLY a valid JSON array, nothing else before or after:

[
  {
    "text": "exact message text including emojis",
    "side": "left",
    "order": 1,
    "authorName": "if present, otherwise null",
    "authorRole": "if present, otherwise null",
    "bodyBox": { "x": 123, "y": 456, "w": 300, "h": 80 }
  }
]

RULES:
- "text": Copy the EXACT text, preserve emojis, punctuation, spelling
- "side": "left" if bubble is on left side of screen, "right" if on right side
- "order": Number messages from top to bottom starting at 1
- Include ALL messages visible in the screenshot
- "bodyBox": tight bounding box around the message text itself (not the avatar), in pixels relative to the original image
- If you see multiple screenshots, extract from all of them`;

const INSUFFICIENT_FUNDS_CODE = 'INSUFFICIENT_FUNDS';
const GEMINI_TIMEOUT_MS = 30000;
const MIN_FACE_CONFIDENCE = 0.3; // Lower threshold for SCRFD (it's more accurate)

// =============================================================================
// DISABLED: face-api.js model loading - now using SCRFD Python service
// =============================================================================
// const FACE_MODEL_PATH = path.resolve(process.cwd(), '../models');
// const REQUIRED_SSD_FILES = [
//   'ssd_mobilenetv1_model-weights_manifest.json'
// ];
// 
// const { Canvas, Image, ImageData, createCanvas } = canvas;
// faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
// 
// let faceModelsReady = null;
// 
// function assertFaceModelFiles() {
//   if (!fs.existsSync(FACE_MODEL_PATH)) {
//     throw new Error(`Face API models missing. Expected directory: ${FACE_MODEL_PATH}`);
//   }
// 
//   const entries = fs.readdirSync(FACE_MODEL_PATH);
//   const missing = REQUIRED_SSD_FILES.filter(file => !entries.includes(file));
//   const hasShard = entries.some(entry => entry.startsWith('ssd_mobilenetv1_model-shard'));
// 
//   if (missing.length > 0 || !hasShard) {
//     const details = [
//       missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
//       !hasShard ? 'Missing: ssd_mobilenetv1_model-shard*' : null
//     ].filter(Boolean).join(' | ');
//     throw new Error(`Face API models not found in ${FACE_MODEL_PATH}. ${details}`);
//   }
// }
// 
// async function loadFaceModels() {
//   if (!faceModelsReady) {
//     faceModelsReady = (async () => {
//       assertFaceModelFiles();
//       console.log('Loading face detection models from:', FACE_MODEL_PATH);
//       await faceapi.nets.ssdMobilenetv1.loadFromDisk(FACE_MODEL_PATH);
//       console.log('Face detection models loaded successfully');
//       return true;
//     })();
//   }
//   return faceModelsReady;
// }
// =============================================================================

// SCRFD Python service configuration
const SCRFD_SERVICE_URL = process.env.SCRFD_SERVICE_URL || 'http://localhost:5050';
const SCRFD_TIMEOUT_MS = 10000;
const SCRFD_HEALTH_TIMEOUT_MS = 5000;
const SCRFD_STARTUP_TIMEOUT_MS = 15000;
const SCRFD_AUTO_START = process.env.SCRFD_AUTO_START !== '0';
const SCRFD_START_SCRIPT = process.env.SCRFD_START_SCRIPT
  || path.resolve(__dirname, '..', 'scrfd', 'start_face_server.sh');

let scrfdStartPromise = null;

function isInsufficientFundsError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('insufficient') || message.includes('quota') || message.includes('billing');
}

function normalizeBodyBox(bodyBox, imageWidth, imageHeight) {
  if (!bodyBox || !imageWidth || !imageHeight) return null;
  const x = Math.max(0, Math.floor(Number(bodyBox.x ?? bodyBox.left ?? 0)));
  const y = Math.max(0, Math.floor(Number(bodyBox.y ?? bodyBox.top ?? 0)));
  const width = Math.max(1, Math.floor(Number(bodyBox.w ?? bodyBox.width ?? 0)));
  const height = Math.max(1, Math.floor(Number(bodyBox.h ?? bodyBox.height ?? 0)));

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  if (x >= imageWidth || y >= imageHeight) {
    return null;
  }

  const clampedWidth = Math.min(width, imageWidth - x);
  const clampedHeight = Math.min(height, imageHeight - y);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight
  };
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampBoxToImage(box, imageWidth, imageHeight) {
  if (!box) return null;
  const x = clampValue(Math.round(box.x), 0, imageWidth - 1);
  const y = clampValue(Math.round(box.y), 0, imageHeight - 1);
  const width = clampValue(Math.round(box.width), 1, imageWidth - x);
  const height = clampValue(Math.round(box.height), 1, imageHeight - y);
  return { x, y, width, height };
}

function getDefaultBodyBox(imageWidth, imageHeight) {
  const width = Math.round(imageWidth * 0.5);
  const height = Math.round(imageHeight * 0.2);
  const x = Math.round((imageWidth - width) / 2);
  const y = Math.round(imageHeight * 0.4);
  return { x, y, width, height };
}

function getAvatarSearchRegion(bodyBox, side, sourceWidth, sourceHeight) {
  const safeBodyBox = bodyBox || getDefaultBodyBox(sourceWidth, sourceHeight);
  const bodyHeight = safeBodyBox.height;
  const S = clampValue(Math.round(0.55 * bodyHeight), 40, 180);
  const ry1 = Math.max(0, safeBodyBox.y - Math.round(0.25 * bodyHeight));
  const ry2 = Math.min(sourceHeight, safeBodyBox.y + Math.round(1.1 * bodyHeight));

  let rx1;
  let rx2;

  if (side === 'right') {
    rx1 = Math.min(sourceWidth, safeBodyBox.x + safeBodyBox.width + Math.round(0.15 * S));
    rx2 = Math.min(sourceWidth, safeBodyBox.x + safeBodyBox.width + Math.round(1.8 * S));
  } else {
    rx1 = Math.max(0, safeBodyBox.x - Math.round(1.8 * S));
    rx2 = Math.max(0, safeBodyBox.x - Math.round(0.15 * S));
  }

  const region = {
    x: Math.min(rx1, rx2),
    y: Math.min(ry1, ry2),
    width: Math.max(1, Math.abs(rx2 - rx1)),
    height: Math.max(1, Math.abs(ry2 - ry1))
  };

  return {
    region: clampBoxToImage(region, sourceWidth, sourceHeight),
    expectedSize: S
  };
}

function getExpectedCenter(region) {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2
  };
}

function getSquareBoxAroundCenter(center, size, imageWidth, imageHeight) {
  const clampedSize = Math.max(1, Math.min(Math.round(size), imageWidth, imageHeight));
  const half = clampedSize / 2;
  const x = clampValue(Math.round(center.x - half), 0, imageWidth - clampedSize);
  const y = clampValue(Math.round(center.y - half), 0, imageHeight - clampedSize);
  return {
    x,
    y,
    width: Math.min(clampedSize, imageWidth - x),
    height: Math.min(clampedSize, imageHeight - y)
  };
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function checkScrfdHealth(timeoutMs = SCRFD_HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SCRFD_SERVICE_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) {
      return false;
    }
    const health = await response.json().catch(() => null);
    if (health && health.detector_ready === false) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForScrfdReady(timeoutMs = SCRFD_STARTUP_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkScrfdHealth(1500)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function startScrfdService() {
  if (!SCRFD_AUTO_START) {
    return false;
  }
  if (scrfdStartPromise) {
    return scrfdStartPromise;
  }

  scrfdStartPromise = (async () => {
    if (!fs.existsSync(SCRFD_START_SCRIPT)) {
      console.warn(`SCRFD start script not found: ${SCRFD_START_SCRIPT}`);
      return false;
    }

    try {
      console.log(`Starting SCRFD service via ${SCRFD_START_SCRIPT}`);
      const child = spawn('bash', [SCRFD_START_SCRIPT], {
        cwd: path.dirname(SCRFD_START_SCRIPT),
        stdio: 'ignore',
        detached: true
      });
      child.unref();
    } catch (error) {
      console.warn('Failed to start SCRFD service:', error.message);
      return false;
    }

    const ready = await waitForScrfdReady();
    if (!ready) {
      console.warn('SCRFD service did not become ready in time.');
    }
    return ready;
  })();

  return scrfdStartPromise;
}

// =============================================================================
// NEW: SCRFD-based face detection via Python microservice
// =============================================================================
async function detectFacesInRegion(imageData, region, fullWidth = 1080, fullHeight = 1920) {
  console.log('CALLING SCRFD FACE DETECTION FOR REGION:', region);
  if (!region || region.width <= 0 || region.height <= 0) {
    return [];
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCRFD_TIMEOUT_MS);
    // NUCLEAR FIX: Send FULL IMAGE, not just region
    const fullRegion = { x: 0, y: 0, width: fullWidth, height: fullHeight };
    const response = await fetch(`${SCRFD_SERVICE_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageData.toString('base64'),
        region: fullRegion,
        min_confidence: 0.05
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.warn('SCRFD service error:', response.status, response.statusText);
      return [];
    }
    const allFaces = await response.json();
    console.log('SCRFD TOTAL FACES IN IMAGE:', allFaces.length);
    // Filter faces near expected region
    const regionCenterX = region.x + region.width / 2;
    const regionCenterY = region.y + region.height / 2;
    const maxDistance = Math.max(region.width, region.height) * 2.5;
    const nearbyFaces = allFaces.filter(f => {
      const faceCenterX = f.x + f.width / 2;
      const faceCenterY = f.y + f.height / 2;
      const distance = Math.hypot(faceCenterX - regionCenterX, faceCenterY - regionCenterY);
      return distance < maxDistance;
    });
    console.log('SCRFD FACES NEAR REGION:', nearbyFaces.length);
    return nearbyFaces.map(f => ({ x: f.x, y: f.y, width: f.width, height: f.height, score: f.score }));
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('SCRFD service timeout');
    } else {
      console.warn('SCRFD service unavailable:', error.message);
    }
    return [];
  }
}

// =============================================================================
// DISABLED: Original face-api.js detection function
// =============================================================================
// async function detectFacesInRegion(imageData, region) {
//   console.log('CALLING FACE DETECTION FOR REGION:', region);
//
//   const ready = await loadFaceModels();
//   if (!ready) {
//     throw new Error('Face detection models not ready. Ensure SSD Mobilenet V1 is loaded.');
//   }
//
//   console.log('MODELS LOADED:', faceapi.nets.ssdMobilenetv1.isLoaded);
//
//   if (!region || region.width <= 0 || region.height <= 0) {
//     return [];
//   }
//
//   const croppedBuffer = await sharp(imageData)
//     .extract({
//       left: region.x,
//       top: region.y,
//       width: region.width,
//       height: region.height
//     })
//     .png()
//     .toBuffer();
//
//   const img = await canvas.loadImage(croppedBuffer);
//   const sourceWidth = img.width;
//   const sourceHeight = img.height;
//   const detectWidth = sourceWidth * 2;
//   const detectHeight = sourceHeight * 2;
//
//   if (!sourceWidth || !sourceHeight || !detectWidth || !detectHeight) {
//     throw new Error('Invalid image dimensions (0).');
//   }
//
//   const detectionCanvas = createCanvas(detectWidth, detectHeight);
//   if (detectionCanvas.width !== detectWidth || detectionCanvas.height !== detectHeight) {
//     throw new Error('Detection canvas size mismatch.');
//   }
//
//   const ctx = detectionCanvas.getContext('2d');
//   ctx.drawImage(img, 0, 0, detectWidth, detectHeight);
//
//   console.log('FACE DETECTION DIMENSIONS:', {
//     sourceWidth,
//     sourceHeight,
//     detectWidth,
//     detectHeight,
//     imgWidth: img.width,
//     imgHeight: img.height,
//     detectionCanvasWidth: detectionCanvas.width,
//     detectionCanvasHeight: detectionCanvas.height
//   });
//
//   if (img.width !== sourceWidth || img.height !== sourceHeight) {
//     throw new Error('Image intrinsic size mismatch.');
//   }
//
//   const detections = await faceapi.detectAllFaces(
//     detectionCanvas,
//     new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_FACE_CONFIDENCE })
//   );
//
//   console.log('FACES FOUND:', detections.length);
//
//   const scaleX = sourceWidth / detectWidth;
//   const scaleY = sourceHeight / detectHeight;
//
//   const mappedDetections = detections.map((det, i) => {
//     const detectBox = det.box;
//     const mappedBox = {
//       x: detectBox.x * scaleX + region.x,
//       y: detectBox.y * scaleY + region.y,
//       width: detectBox.width * scaleX,
//       height: detectBox.height * scaleY
//     };
//     console.log(`FACE ${i + 1} DETECT BOX:`, detectBox);
//     console.log(`FACE ${i + 1} SOURCE BOX:`, mappedBox);
//     return mappedBox;
//   });
//
//   return mappedDetections;
// }
// =============================================================================

function calculateVariance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return variance;
}

function getPixelLuma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getPixelSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

async function findContourCandidate(imageData, region, expectedSize, expectedCenter, imageWidth, imageHeight) {
  if (!region) return null;
  const { data, info } = await sharp(imageData)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const pixelCount = width * height;
  const channels = info.channels;

  if (!pixelCount || channels < 3) {
    return null;
  }

  let borderCount = 0;
  let borderSumR = 0;
  let borderSumG = 0;
  let borderSumB = 0;
  const borderIndices = [];

  const addBorderPixel = (idx) => {
    const offset = idx * channels;
    borderSumR += data[offset];
    borderSumG += data[offset + 1];
    borderSumB += data[offset + 2];
    borderCount += 1;
    borderIndices.push(idx);
  };

  for (let x = 0; x < width; x++) {
    addBorderPixel(x);
    addBorderPixel((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    addBorderPixel(y * width);
    addBorderPixel(y * width + (width - 1));
  }

  if (!borderCount) {
    return null;
  }

  const meanR = borderSumR / borderCount;
  const meanG = borderSumG / borderCount;
  const meanB = borderSumB / borderCount;

  let varianceSum = 0;
  for (const idx of borderIndices) {
    const offset = idx * channels;
    const dr = data[offset] - meanR;
    const dg = data[offset + 1] - meanG;
    const db = data[offset + 2] - meanB;
    varianceSum += dr * dr + dg * dg + db * db;
  }

  const borderStd = Math.sqrt(varianceSum / borderCount);
  const threshold = Math.max(20, borderStd * 2);

  const mask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const dr = data[offset] - meanR;
    const dg = data[offset + 1] - meanG;
    const db = data[offset + 2] - meanB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist >= threshold) {
      mask[i] = 1;
    }
  }

  const visited = new Uint8Array(pixelCount);
  const candidates = [];
  const minSize = 0.55 * expectedSize;
  const maxSize = 1.6 * expectedSize;

  const pushNeighbor = (queue, nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const nIdx = ny * width + nx;
    if (!visited[nIdx] && mask[nIdx]) {
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  };

  for (let idx = 0; idx < pixelCount; idx++) {
    if (!mask[idx] || visited[idx]) continue;
    const queue = [idx];
    visited[idx] = 1;
    let area = 0;
    let perimeter = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let lumaSum = 0;
    let lumaSumSq = 0;

    while (queue.length) {
      const current = queue.pop();
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const offset = current * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const luma = getPixelLuma(r, g, b);
      lumaSum += luma;
      lumaSumSq += luma * luma;

      const neighbors = [
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 }
      ];

      neighbors.forEach(({ x: nx, y: ny }) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          perimeter += 1;
          return;
        }
        const nIdx = ny * width + nx;
        if (!mask[nIdx]) {
          perimeter += 1;
        } else if (!visited[nIdx]) {
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      });
    }

    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const squareness = Math.min(cw, ch) / Math.max(cw, ch);
    if (Math.min(cw, ch) < minSize || Math.min(cw, ch) > maxSize) continue;
    if (squareness < 0.75) continue;

    const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
    const roundedSquare = squareness >= 0.85 && circularity >= 0.55;
    if (circularity < 0.7 && !roundedSquare) continue;

    const meanLuma = lumaSum / area;
    const textureVariance = Math.max(0, lumaSumSq / area - meanLuma * meanLuma);
    const center = {
      x: region.x + minX + cw / 2,
      y: region.y + minY + ch / 2
    };
    const distance = distanceBetween(center, expectedCenter);
    const distancePenalty = distance / Math.max(region.width, region.height);
    const textureScore = Math.min(1, textureVariance / 500);
    const score = circularity + textureScore - distancePenalty;

    candidates.push({
      bounds: { x: region.x + minX, y: region.y + minY, width: cw, height: ch },
      circularity,
      textureVariance,
      score
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const size = Math.max(best.bounds.width, best.bounds.height);
  const padding = Math.round(size * 0.08);
  const center = {
    x: best.bounds.x + best.bounds.width / 2,
    y: best.bounds.y + best.bounds.height / 2
  };
  const avatarBox = getSquareBoxAroundCenter(center, size + padding * 2, imageWidth, imageHeight);

  return {
    avatarBox,
    score: best.score,
    circularity: best.circularity,
    textureVariance: best.textureVariance
  };
}

async function analyzeCropVariance(imageData, avatarBox) {
  const { data, info } = await sharp(imageData)
    .extract({
      left: avatarBox.x,
      top: avatarBox.y,
      width: avatarBox.width,
      height: avatarBox.height
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const count = width * height;
  const lumas = [];
  const sats = [];

  for (let i = 0; i < count; i++) {
    const offset = i * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    lumas.push(getPixelLuma(r, g, b));
    sats.push(getPixelSaturation(r, g, b));
  }

  return {
    lumaVariance: calculateVariance(lumas),
    saturationVariance: calculateVariance(sats)
  };
}

async function drawDebugImages(imageData, imageWidth, imageHeight, debugData, outputPrefix) {
  const { bodyBox, searchRegion, avatarBox } = debugData;
  const rectangles = [
    bodyBox ? `<rect x="${bodyBox.x}" y="${bodyBox.y}" width="${bodyBox.width}" height="${bodyBox.height}" fill="none" stroke="#3b82f6" stroke-width="3" />` : '',
    searchRegion ? `<rect x="${searchRegion.x}" y="${searchRegion.y}" width="${searchRegion.width}" height="${searchRegion.height}" fill="none" stroke="#f97316" stroke-width="3" />` : '',
    avatarBox ? `<rect x="${avatarBox.x}" y="${avatarBox.y}" width="${avatarBox.width}" height="${avatarBox.height}" fill="none" stroke="#22c55e" stroke-width="3" />` : ''
  ].join('');

  const svg = `
    <svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
      ${rectangles}
    </svg>
  `;

  await sharp(imageData)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(`${outputPrefix}-debug.png`);

  if (avatarBox) {
    await sharp(imageData)
      .extract({
        left: avatarBox.x,
        top: avatarBox.y,
        width: avatarBox.width,
        height: avatarBox.height
      })
      .png()
      .toFile(`${outputPrefix}-avatar.png`);
  }
}

// =============================================================================
// DISABLED: Original face-api.js model check
// =============================================================================
// export async function ensureFaceModelsLoaded() {
//   const loaded = await loadFaceModels();
//   if (!loaded || !faceapi.nets.ssdMobilenetv1.isLoaded) {
//     throw new Error('SSD Mobilenet V1 model failed to load. Check ../models.');
//   }
// }
// =============================================================================

// NEW: Health check for SCRFD service (replaces ensureFaceModelsLoaded)
export async function ensureFaceModelsLoaded() {
  const healthy = await checkScrfdHealth();
  if (healthy) {
    console.log('SCRFD service health check passed');
    return true;
  }

  if (SCRFD_AUTO_START) {
    console.warn('SCRFD service not available. Attempting auto-start...');
    const started = await startScrfdService();
    if (started) {
      console.log('SCRFD service started successfully');
      return true;
    }
  } else {
    console.warn('SCRFD service not available. Auto-start disabled (SCRFD_AUTO_START=0).');
  }

  console.warn('Face detection will fall back to contour/geometry methods');
  return false;
}

/**
 * Extract messages from a single image using Gemini Vision
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<Array>} Array of message objects
 */
export async function extractMessagesFromImage(imagePath) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // Read image file
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    const imageMeta = await sharp(imageData).metadata();
    const imageWidth = imageMeta.width || 0;
    const imageHeight = imageMeta.height || 0;

    // Determine mime type from file extension
    const ext = imagePath.toLowerCase().split('.').pop();
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'gif': 'image/gif'
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: mimeType
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let result;
    try {
      result = await model.generateContent([VISION_PROMPT, imagePart], {
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const response = result.response;
    let resultText = response.text().trim();

    console.log('Raw Gemini response:', resultText);

    // Clean up response - Gemini sometimes wraps in markdown
    if (resultText.includes('```json')) {
      const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        resultText = jsonMatch[1];
      }
    } else if (resultText.includes('```')) {
      const codeMatch = resultText.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        resultText = codeMatch[1];
      }
    }

    // Remove any text before the JSON array
    const arrayStartIndex = resultText.indexOf('[');
    if (arrayStartIndex > 0) {
      resultText = resultText.substring(arrayStartIndex);
    }

    // Remove any text after the JSON array
    const arrayEndIndex = resultText.lastIndexOf(']');
    if (arrayEndIndex > 0 && arrayEndIndex < resultText.length - 1) {
      resultText = resultText.substring(0, arrayEndIndex + 1);
    }

    resultText = resultText.trim();

    let messages;
    try {
      messages = JSON.parse(resultText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Attempted to parse:', resultText);
      return [];
    }

    // Validate structure
    if (!Array.isArray(messages)) {
      console.error('Response is not an array:', messages);
      return [];
    }

    const debugDir = path.join('uploads', 'testimonials', 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    // Ensure required fields exist
    const validated = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const normalizedBodyBox = normalizeBodyBox(msg.bodyBox, imageWidth, imageHeight) || getDefaultBodyBox(imageWidth, imageHeight);
      const sideCandidates = (msg.side === 'left' || msg.side === 'right') ? [msg.side] : ['left', 'right'];
      let avatarDataUrl = null;
      let avatarPresent = false;
      let avatarShape = 'circle';
      let avatarBox = null;
      let methodUsed = 'none';
      let searchRegion = null;
      let facesFound = 0;
      let score = null;
      let geometryFallback = null;

      for (const side of sideCandidates) {
        const { region, expectedSize } = getAvatarSearchRegion(normalizedBodyBox, side, imageWidth, imageHeight);
        if (!region) continue;
        const expectedCenter = getExpectedCenter(region);
        searchRegion = region;

        try {
          const faces = await detectFacesInRegion(imageData, region, imageWidth, imageHeight);
          facesFound += faces.length;
          if (faces.length > 0) {
            const closestFace = faces.reduce((best, face) => {
              const faceCenter = { x: face.x + face.width / 2, y: face.y + face.height / 2 };
              const distance = distanceBetween(faceCenter, expectedCenter);
              if (!best || distance < best.distance) {
                return { face, distance };
              }
              return best;
            }, null);

            if (closestFace) {
              const faceCenter = { x: closestFace.face.x + closestFace.face.width / 2, y: closestFace.face.y + closestFace.face.height / 2 };
              const avatarSize = Math.max(expectedSize, closestFace.face.width * 1.6);
              avatarBox = getSquareBoxAroundCenter(faceCenter, avatarSize, imageWidth, imageHeight);
              avatarPresent = true;
              avatarShape = 'circle';
              methodUsed = 'scrfd';  // Changed from 'faceapi'
              score = closestFace.face.score || Math.max(0, 1 - closestFace.distance / Math.max(region.width, region.height));
            }
          }
        } catch (faceError) {
          console.warn('Face detection failed for region:', faceError);
        }

        if (avatarPresent && avatarBox) {
          break;
        }

        try {
          const contour = await findContourCandidate(imageData, region, expectedSize, expectedCenter, imageWidth, imageHeight);
          if (contour?.avatarBox) {
            avatarBox = contour.avatarBox;
            avatarPresent = true;
            methodUsed = 'contour';
            score = contour.score;
            avatarShape = contour.circularity >= 0.7 ? 'circle' : 'rounded';
            break;
          }
        } catch (contourError) {
          console.warn('Contour detection failed:', contourError);
        }

        const avatarSize = expectedSize;
        const offset = Math.round(0.2 * normalizedBodyBox.height);
        const ax = side === 'right'
          ? clampValue(normalizedBodyBox.x + normalizedBodyBox.width + offset, 0, imageWidth - avatarSize)
          : clampValue(normalizedBodyBox.x - avatarSize - offset, 0, imageWidth - avatarSize);
        const ay = clampValue(normalizedBodyBox.y + Math.round(0.08 * normalizedBodyBox.height), 0, imageHeight - avatarSize);
        const geometryBox = clampBoxToImage({ x: ax, y: ay, width: avatarSize, height: avatarSize }, imageWidth, imageHeight);
        let varianceScore = 0;
        let present = false;
        try {
          const variance = await analyzeCropVariance(imageData, geometryBox);
          varianceScore = variance.lumaVariance + variance.saturationVariance * 255;
          present = !(variance.lumaVariance < 40 && variance.saturationVariance < 0.01);
        } catch (geometryError) {
          console.warn('Geometry analysis failed:', geometryError);
        }
        if (!geometryFallback || varianceScore > geometryFallback.score) {
          geometryFallback = {
            avatarBox: geometryBox,
            avatarPresent: present,
            score: varianceScore,
            searchRegion: region
          };
        }
      }

      if (!avatarPresent && geometryFallback) {
        avatarBox = geometryFallback.avatarBox;
        avatarPresent = geometryFallback.avatarPresent;
        methodUsed = 'geometry';
        score = geometryFallback.score;
        searchRegion = geometryFallback.searchRegion;
      }

      if (avatarBox) {
        try {
          if (avatarPresent) {
            const cropped = await sharp(imageData)
              .extract({
                left: avatarBox.x,
                top: avatarBox.y,
                width: avatarBox.width,
                height: avatarBox.height
              })
              .png()
              .toBuffer();
            avatarDataUrl = `data:image/png;base64,${cropped.toString('base64')}`;
          }
        } catch (cropError) {
          console.warn('Avatar crop failed:', cropError);
          avatarPresent = false;
        }
      }

      const debugPrefix = path.join(debugDir, `${path.basename(imagePath, path.extname(imagePath))}-msg-${i + 1}`);
      try {
        await drawDebugImages(imageData, imageWidth, imageHeight, {
          bodyBox: normalizedBodyBox,
          searchRegion,
          avatarBox
        }, debugPrefix);
      } catch (debugError) {
        console.warn('Debug image generation failed:', debugError);
      }

      const avatarDebug = {
        methodUsed,
        searchRegion,
        avatarBox,
        score,
        facesFound
      };

      console.log('Avatar debug info:', avatarDebug);

      validated.push({
        text: String(msg.text || ''),
        quoteText: String(msg.text || ''),
        side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
        order: msg.order || (i + 1),
        authorName: msg.authorName ? String(msg.authorName) : '',
        authorRole: msg.authorRole ? String(msg.authorRole) : '',
        avatarPresent,
        avatarShape,
        avatarBox: avatarBox || null,
        avatarPlacementPct: null,
        avatarDataUrl,
        bodyBox: normalizedBodyBox,
        avatarDebug
      });
    }

    // Sort by order
    validated.sort((a, b) => a.order - b.order);

    return validated;

  } catch (error) {
    console.error('Extraction error:', error);
    if (isInsufficientFundsError(error)) {
      const fundsError = new Error('Insufficient funds to analyze the image.');
      fundsError.code = INSUFFICIENT_FUNDS_CODE;
      throw fundsError;
    }
    throw error;
  }
}

/**
 * Extract messages from multiple images and combine them
 * @param {Array<string>} imagePaths - Array of image file paths
 * @returns {Promise<Array>} Combined array of message objects
 */
export async function extractFromMultipleImages(imagePaths) {
  const allMessages = [];
  let orderOffset = 0;

  for (const imagePath of imagePaths) {
    const messages = await extractMessagesFromImage(imagePath);
    for (const msg of messages) {
      msg.order = msg.order + orderOffset;
      allMessages.push(msg);
    }
    orderOffset = allMessages.length;
  }

  return allMessages;
}
