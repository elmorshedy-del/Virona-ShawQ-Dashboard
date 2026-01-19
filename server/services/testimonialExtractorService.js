import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import * as faceapi from 'face-api.js';
import canvas from 'canvas';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISION_PROMPT = `Analyze this chat screenshot. Extract every message bubble you see.

Return ONLY a valid JSON array, nothing else before or after:

[
  {
    "text": "exact message text including emojis",
    "bodyBox": { "x": 0, "y": 0, "w": 0, "h": 0 },
    "side": "left",
    "order": 1,
    "authorName": "if present, otherwise null",
    "authorRole": "if present, otherwise null"
  }
]

RULES:
- "text": Copy the EXACT text, preserve emojis, punctuation, spelling
- "bodyBox": tight box around the message text in PIXELS relative to the screenshot (x,y top-left, w,h size)
- "side": "left" if bubble is on left side of screen, "right" if on right side
- "order": Number messages from top to bottom starting at 1
- Include ALL messages visible in the screenshot
- If you see multiple screenshots, extract from all of them`;

const INSUFFICIENT_FUNDS_CODE = 'INSUFFICIENT_FUNDS';
const GEMINI_TIMEOUT_MS = 30000;
const FACE_MODEL_PATH = path.resolve(process.cwd(), '../models');
const REQUIRED_SSD_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json'
];
const MIN_FACE_CONFIDENCE = 0.5;
const AVATAR_SIZE_MIN = 40;
const AVATAR_SIZE_MAX = 180;
const AVATAR_DEBUG_DIR = path.resolve(process.cwd(), 'debug', 'testimonial-avatars');
const EDGE_THRESHOLD_MIN = 20;
const GEOMETRY_LUMA_VARIANCE_THRESHOLD = 30;
const GEOMETRY_SATURATION_VARIANCE_THRESHOLD = 0.012;

const { Canvas, Image, ImageData, createCanvas } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let faceModelsReady = null;

function assertFaceModelFiles() {
  if (!fs.existsSync(FACE_MODEL_PATH)) {
    throw new Error(`Face API models missing. Expected directory: ${FACE_MODEL_PATH}`);
  }

  const entries = fs.readdirSync(FACE_MODEL_PATH);
  const missing = REQUIRED_SSD_FILES.filter(file => !entries.includes(file));
  const hasShard = entries.some(entry => entry.startsWith('ssd_mobilenetv1_model-shard'));

  if (missing.length > 0 || !hasShard) {
    const details = [
      missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
      !hasShard ? 'Missing: ssd_mobilenetv1_model-shard*' : null
    ].filter(Boolean).join(' | ');
    throw new Error(`Face API models not found in ${FACE_MODEL_PATH}. ${details}`);
  }
}

async function loadFaceModels() {
  if (!faceModelsReady) {
    faceModelsReady = (async () => {
      assertFaceModelFiles();
      console.log('Loading face detection models from:', FACE_MODEL_PATH);
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(FACE_MODEL_PATH);
      console.log('Face detection models loaded successfully');
      return true;
    })();
  }
  return faceModelsReady;
}

function isInsufficientFundsError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('insufficient') || message.includes('quota') || message.includes('billing');
}

function normalizeAvatarBox(avatarBox, imageWidth, imageHeight) {
  if (!avatarBox) return null;
  if (!imageWidth || !imageHeight) return null;
  const x = Math.max(0, Math.floor(Number(avatarBox.x ?? 0)));
  const y = Math.max(0, Math.floor(Number(avatarBox.y ?? 0)));
  const width = Math.max(1, Math.floor(Number(avatarBox.width ?? 0)));
  const height = Math.max(1, Math.floor(Number(avatarBox.height ?? 0)));

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

function normalizeBodyBox(bodyBox, imageWidth, imageHeight) {
  if (!bodyBox) return null;
  if (!imageWidth || !imageHeight) return null;
  const x = Math.max(0, Math.floor(Number(bodyBox.x ?? 0)));
  const y = Math.max(0, Math.floor(Number(bodyBox.y ?? 0)));
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampBoxToBounds(box, sourceWidth, sourceHeight) {
  if (!box) return null;
  const x = clamp(Math.round(box.x), 0, Math.max(0, sourceWidth - 1));
  const y = clamp(Math.round(box.y), 0, Math.max(0, sourceHeight - 1));
  const width = clamp(Math.round(box.width), 1, sourceWidth - x);
  const height = clamp(Math.round(box.height), 1, sourceHeight - y);
  return { x, y, width, height };
}

function computeAvatarSearchRegion(bodyBox, side, sourceWidth, sourceHeight) {
  if (!bodyBox) return null;
  const bodyHeight = Number(bodyBox.h ?? bodyBox.height ?? 0);
  const bodyWidth = Number(bodyBox.w ?? bodyBox.width ?? 0);
  const bodyX = Number(bodyBox.x ?? 0);
  const bodyY = Number(bodyBox.y ?? 0);

  if (!Number.isFinite(bodyHeight) || !Number.isFinite(bodyWidth)) return null;

  const size = clamp(Math.round(0.55 * bodyHeight), AVATAR_SIZE_MIN, AVATAR_SIZE_MAX);
  const ry1 = Math.max(0, Math.round(bodyY - 0.25 * bodyHeight));
  const ry2 = Math.min(sourceHeight, Math.round(bodyY + 1.1 * bodyHeight));

  let rx1;
  let rx2;
  if (side === 'right') {
    rx1 = Math.min(sourceWidth, Math.round(bodyX + bodyWidth + 0.15 * size));
    rx2 = Math.min(sourceWidth, Math.round(bodyX + bodyWidth + 1.8 * size));
  } else {
    rx1 = Math.max(0, Math.round(bodyX - 1.8 * size));
    rx2 = Math.max(0, Math.round(bodyX - 0.15 * size));
  }

  const width = Math.max(0, rx2 - rx1);
  const height = Math.max(0, ry2 - ry1);

  if (width <= 0 || height <= 0) return null;

  return {
    x: clamp(rx1, 0, sourceWidth),
    y: clamp(ry1, 0, sourceHeight),
    width: clamp(width, 1, sourceWidth - rx1),
    height: clamp(height, 1, sourceHeight - ry1),
    size
  };
}

function computeExpectedCenter(region) {
  if (!region) return null;
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2
  };
}

function buildSquareBoxFromCenter(center, size, sourceWidth, sourceHeight) {
  const half = size / 2;
  const x = clamp(Math.round(center.x - half), 0, sourceWidth - size);
  const y = clamp(Math.round(center.y - half), 0, sourceHeight - size);
  return {
    x,
    y,
    width: size,
    height: size
  };
}

function computeDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

async function getRegionPixels(imageData, region) {
  if (!region) return null;
  try {
    const { x, y, width, height } = region;
    const buffer = await sharp(imageData)
      .extract({ left: x, top: y, width, height })
      .ensureAlpha()
      .raw()
      .toBuffer();
    return { data: buffer, width, height };
  } catch (error) {
    console.warn('Failed to extract region pixels:', error);
    return null;
  }
}

function computeGrayscale(pixelData, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < pixelData.length; i += 4, p += 1) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];
    gray[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return gray;
}

function computeVariance(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
  }
  const mean = sum / values.length;
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) {
    const diff = values[i] - mean;
    variance += diff * diff;
  }
  return variance / values.length;
}

function computeRegionVariance(gray, width, height, box) {
  const { x, y, width: boxWidth, height: boxHeight } = box;
  const values = [];
  for (let row = y; row < y + boxHeight; row += 1) {
    for (let col = x; col < x + boxWidth; col += 1) {
      const idx = row * width + col;
      values.push(gray[idx]);
    }
  }
  return computeVariance(values);
}

function computeSaturationVariance(pixelData, width, height, box) {
  const { x, y, width: boxWidth, height: boxHeight } = box;
  const values = [];
  for (let row = y; row < y + boxHeight; row += 1) {
    for (let col = x; col < x + boxWidth; col += 1) {
      const idx = (row * width + col) * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      values.push(sat);
    }
  }
  return computeVariance(values);
}

function computeEdgeMap(gray, width, height) {
  const edges = new Uint8Array(width * height);
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx =
        -gray[idx - width - 1] - 2 * gray[idx - 1] - gray[idx + width - 1] +
        gray[idx - width + 1] + 2 * gray[idx + 1] + gray[idx + width + 1];
      const gy =
        -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1] +
        gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      sum += mag;
      count += 1;
      edges[idx] = mag;
    }
  }
  const mean = count > 0 ? sum / count : 0;
  let variance = 0;
  for (let i = 0; i < edges.length; i += 1) {
    const diff = edges[i] - mean;
    variance += diff * diff;
  }
  const std = Math.sqrt(variance / Math.max(1, edges.length));
  const threshold = Math.max(EDGE_THRESHOLD_MIN, mean + std * 0.5);
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < edges.length; i += 1) {
    if (edges[i] >= threshold) {
      binary[i] = 1;
    }
  }
  return binary;
}

function findEdgeComponents(edgeMap, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!edgeMap[idx] || visited[idx]) continue;
      const queue = [idx];
      visited[idx] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let edgeCount = 0;
      const rowBounds = new Map();

      while (queue.length) {
        const current = queue.pop();
        const cy = Math.floor(current / width);
        const cx = current - cy * width;
        edgeCount += 1;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        const rowKey = cy;
        const rowEntry = rowBounds.get(rowKey) || { min: cx, max: cx };
        rowEntry.min = Math.min(rowEntry.min, cx);
        rowEntry.max = Math.max(rowEntry.max, cx);
        rowBounds.set(rowKey, rowEntry);

        for (const [dx, dy] of neighbors) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (edgeMap[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      let filledArea = 0;
      for (const bounds of rowBounds.values()) {
        filledArea += bounds.max - bounds.min + 1;
      }

      components.push({
        minX,
        maxX,
        minY,
        maxY,
        boxWidth,
        boxHeight,
        edgeCount,
        filledArea
      });
    }
  }

  return components;
}

async function detectFaces(imagePath) {
  console.log('CALLING FACE DETECTION:', imagePath);
  console.log('FILE EXISTS:', fs.existsSync(imagePath));

  const ready = await loadFaceModels();
  if (!ready) {
    throw new Error('Face detection models not ready. Ensure SSD Mobilenet V1 is loaded.');
  }

  console.log('MODELS LOADED:', faceapi.nets.ssdMobilenetv1.isLoaded);

  const img = await canvas.loadImage(imagePath);
  const sourceWidth = img.width;
  const sourceHeight = img.height;
  const detectWidth = sourceWidth * 2;
  const detectHeight = sourceHeight * 2;

  if (!sourceWidth || !sourceHeight || !detectWidth || !detectHeight) {
    throw new Error('Invalid image dimensions (0).');
  }

  const detectionCanvas = createCanvas(detectWidth, detectHeight);
  if (detectionCanvas.width !== detectWidth || detectionCanvas.height !== detectHeight) {
    throw new Error('Detection canvas size mismatch.');
  }

  const ctx = detectionCanvas.getContext('2d');
  ctx.drawImage(img, 0, 0, detectWidth, detectHeight);

  console.log('FACE DETECTION DIMENSIONS:', {
    sourceWidth,
    sourceHeight,
    detectWidth,
    detectHeight,
    imgWidth: img.width,
    imgHeight: img.height,
    detectionCanvasWidth: detectionCanvas.width,
    detectionCanvasHeight: detectionCanvas.height
  });

  if (img.width !== sourceWidth || img.height !== sourceHeight) {
    throw new Error('Image intrinsic size mismatch.');
  }

  const detections = await faceapi.detectAllFaces(
    detectionCanvas,
    new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_FACE_CONFIDENCE })
  );

  console.log('FACES FOUND:', detections.length);

  const scaleX = sourceWidth / detectWidth;
  const scaleY = sourceHeight / detectHeight;

  const mappedDetections = detections.map((det, i) => {
    const detectBox = det.box;
    const mappedBox = {
      x: detectBox.x * scaleX,
      y: detectBox.y * scaleY,
      width: detectBox.width * scaleX,
      height: detectBox.height * scaleY
    };
    console.log(`FACE ${i + 1} DETECT BOX:`, detectBox);
    console.log(`FACE ${i + 1} SOURCE BOX:`, mappedBox);
    return mappedBox;
  });

  return mappedDetections;
}

async function detectFacesInRegion(imageData, region) {
  const ready = await loadFaceModels();
  if (!ready) {
    throw new Error('Face detection models not ready. Ensure SSD Mobilenet V1 is loaded.');
  }
  if (!region) return [];
  const { x, y, width, height } = region;
  if (width <= 0 || height <= 0) return [];

  const regionBuffer = await sharp(imageData)
    .extract({ left: x, top: y, width, height })
    .toBuffer();

  const img = await canvas.loadImage(regionBuffer);
  const detectCanvas = createCanvas(width, height);
  const ctx = detectCanvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const detections = await faceapi.detectAllFaces(
    detectCanvas,
    new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_FACE_CONFIDENCE })
  );

  return detections.map(det => ({
    x: det.box.x + x,
    y: det.box.y + y,
    width: det.box.width,
    height: det.box.height
  }));
}

async function detectAvatarByContour({ imageData, region, expectedCenter, size, sourceWidth, sourceHeight }) {
  const regionPixels = await getRegionPixels(imageData, region);
  if (!regionPixels) return null;
  const { data, width, height } = regionPixels;
  const gray = computeGrayscale(data, width, height);
  const edgeMap = computeEdgeMap(gray, width, height);
  const components = findEdgeComponents(edgeMap, width, height);

  const minSize = 0.55 * size;
  const maxSize = 1.6 * size;
  let best = null;

  for (const component of components) {
    const cw = component.boxWidth;
    const ch = component.boxHeight;
    const shortSide = Math.min(cw, ch);
    const longSide = Math.max(cw, ch);
    if (shortSide < minSize || shortSide > maxSize) continue;

    const squareness = shortSide / longSide;
    if (squareness < 0.75) continue;

    const area = component.filledArea;
    const perimeter = component.edgeCount;
    const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
    const smoothness = perimeter / Math.max(1, 2 * (cw + ch));
    const roundedSquare = squareness >= 0.85 && smoothness < 2.5;
    if (!(circularity >= 0.7 || roundedSquare)) continue;

    const candidateBox = {
      x: component.minX,
      y: component.minY,
      width: cw,
      height: ch
    };
    const textureVariance = computeRegionVariance(gray, width, height, candidateBox);
    const textureScore = clamp(textureVariance / 5000, 0, 1);
    const center = {
      x: region.x + component.minX + cw / 2,
      y: region.y + component.minY + ch / 2
    };
    const distance = expectedCenter ? computeDistance(center, expectedCenter) : 0;
    const distancePenalty = distance / Math.max(1, size * 2);
    const score = circularity + textureScore - distancePenalty;

    if (!best || score > best.score) {
      best = {
        center,
        size: Math.max(cw, ch),
        score,
        circularity,
        textureVariance,
        distance,
        squareness
      };
    }
  }

  if (!best) return null;

  const padding = Math.round(0.08 * best.size);
  const finalSize = Math.round(best.size + padding * 2);
  const avatarBox = buildSquareBoxFromCenter(best.center, finalSize, sourceWidth, sourceHeight);
  return {
    avatarBox,
    score: best.score,
    debug: {
      circularity: best.circularity,
      textureVariance: best.textureVariance,
      distance: best.distance,
      squareness: best.squareness
    }
  };
}

async function computeGeometryAvatar({ imageData, bodyBox, side, sourceWidth, sourceHeight, size }) {
  if (!bodyBox) return null;
  const bodyHeight = Number(bodyBox.h ?? bodyBox.height ?? 0);
  const bodyWidth = Number(bodyBox.w ?? bodyBox.width ?? 0);
  const bodyX = Number(bodyBox.x ?? 0);
  const bodyY = Number(bodyBox.y ?? 0);
  if (!Number.isFinite(bodyHeight) || !Number.isFinite(bodyWidth)) return null;

  const avatarSize = size;
  const offset = Math.round(0.2 * bodyHeight);
  let ax;
  if (side === 'right') {
    ax = clamp(Math.round(bodyX + bodyWidth + offset), 0, sourceWidth - avatarSize);
  } else {
    ax = clamp(Math.round(bodyX - avatarSize - offset), 0, sourceWidth - avatarSize);
  }
  const ay = clamp(Math.round(bodyY + 0.08 * bodyHeight), 0, sourceHeight - avatarSize);

  const avatarBox = {
    x: ax,
    y: ay,
    width: avatarSize,
    height: avatarSize
  };

  const regionPixels = await getRegionPixels(imageData, avatarBox);
  if (!regionPixels) return { avatarBox, avatarPresent: false, score: null };

  const { data, width, height } = regionPixels;
  const gray = computeGrayscale(data, width, height);
  const lumaVariance = computeVariance(gray);
  const saturationVariance = computeSaturationVariance(data, width, height, {
    x: 0,
    y: 0,
    width,
    height
  });

  const avatarPresent = !(lumaVariance < GEOMETRY_LUMA_VARIANCE_THRESHOLD &&
    saturationVariance < GEOMETRY_SATURATION_VARIANCE_THRESHOLD);

  return {
    avatarBox,
    avatarPresent,
    score: {
      lumaVariance,
      saturationVariance
    }
  };
}

async function saveAvatarDebugImages({
  imagePath,
  messageIndex,
  bodyBox,
  searchRegion,
  avatarBox
}) {
  try {
    await fs.promises.mkdir(AVATAR_DEBUG_DIR, { recursive: true });
    const img = await canvas.loadImage(imagePath);
    const debugCanvas = createCanvas(img.width, img.height);
    const ctx = debugCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, img.width, img.height);

    if (bodyBox) {
      ctx.strokeStyle = '#00BFFF';
      ctx.lineWidth = 3;
      ctx.strokeRect(bodyBox.x, bodyBox.y, bodyBox.w ?? bodyBox.width, bodyBox.h ?? bodyBox.height);
    }
    if (searchRegion) {
      ctx.strokeStyle = '#FF9900';
      ctx.lineWidth = 3;
      ctx.strokeRect(searchRegion.x, searchRegion.y, searchRegion.width, searchRegion.height);
    }
    if (avatarBox) {
      ctx.strokeStyle = '#00FF6A';
      ctx.lineWidth = 3;
      ctx.strokeRect(avatarBox.x, avatarBox.y, avatarBox.width, avatarBox.height);
    }

    const debugPath = path.join(AVATAR_DEBUG_DIR, `message-${messageIndex}-debug.png`);
    const out = fs.createWriteStream(debugPath);
    const stream = debugCanvas.createPNGStream();
    stream.pipe(out);
    await new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
    });

    if (avatarBox) {
      const cropBuffer = await sharp(imagePath)
        .extract({
          left: avatarBox.x,
          top: avatarBox.y,
          width: avatarBox.width,
          height: avatarBox.height
        })
        .png()
        .toBuffer();
      const cropPath = path.join(AVATAR_DEBUG_DIR, `message-${messageIndex}-avatar.png`);
      await fs.promises.writeFile(cropPath, cropBuffer);
    }
  } catch (error) {
    console.warn('Failed to write avatar debug images:', error);
  }
}

async function extractAvatarForMessage({
  msg,
  imageData,
  imagePath,
  imageWidth,
  imageHeight,
  messageIndex
}) {
  const normalizedBodyBox = normalizeBodyBox(msg.bodyBox, imageWidth, imageHeight);
  const bodyBoxForSearch = normalizedBodyBox
    ? {
        x: normalizedBodyBox.x,
        y: normalizedBodyBox.y,
        w: normalizedBodyBox.width,
        h: normalizedBodyBox.height
      }
    : null;
  const sides = (msg.side === 'left' || msg.side === 'right') ? [msg.side] : ['left', 'right'];
  let avatarBox = null;
  let avatarPresent = false;
  let avatarShape = null;
  let avatarScore = null;
  let methodUsed = 'none';
  let facesFound = 0;
  let searchRegion = null;
  let usedSide = sides[0];
  let avatarSize = null;

  for (const side of sides) {
    usedSide = side;
    const region = computeAvatarSearchRegion(bodyBoxForSearch, side, imageWidth, imageHeight);
    if (!region) continue;
    avatarSize = region.size;
    searchRegion = clampBoxToBounds(region, imageWidth, imageHeight);
    const expectedCenter = computeExpectedCenter(region);
    let faces = [];
    try {
      faces = await detectFacesInRegion(imageData, region);
    } catch (error) {
      console.warn('Face detection failed in region:', error);
      faces = [];
    }
    facesFound = faces.length;
    if (faces.length > 0) {
      const bestFace = faces.reduce((best, face) => {
        const faceCenter = { x: face.x + face.width / 2, y: face.y + face.height / 2 };
        const distance = expectedCenter ? computeDistance(faceCenter, expectedCenter) : 0;
        if (!best || distance < best.distance) {
          return { face, distance };
        }
        return best;
      }, null);
      const faceBox = bestFace.face;
      const faceCenter = { x: faceBox.x + faceBox.width / 2, y: faceBox.y + faceBox.height / 2 };
      const targetSize = Math.round(Math.max(avatarSize, faceBox.width * 1.6));
      const finalSize = Math.min(targetSize, imageWidth, imageHeight);
      avatarBox = buildSquareBoxFromCenter(faceCenter, finalSize, imageWidth, imageHeight);
      avatarPresent = true;
      avatarShape = 'circle';
      avatarScore = { distance: bestFace.distance };
      methodUsed = 'faceapi';
      break;
    }

    const contourResult = await detectAvatarByContour({
      imageData,
      region,
      expectedCenter,
      size: avatarSize,
      sourceWidth: imageWidth,
      sourceHeight: imageHeight
    });
    if (contourResult?.avatarBox) {
      avatarBox = contourResult.avatarBox;
      avatarPresent = true;
      avatarShape = contourResult.debug?.squareness >= 0.9 ? 'rounded' : 'circle';
      avatarScore = { score: contourResult.score, ...contourResult.debug };
      methodUsed = 'contour';
      break;
    }
  }

  if (!avatarBox && bodyBoxForSearch) {
    if (!avatarSize) {
      avatarSize = clamp(Math.round(0.55 * bodyBoxForSearch.h), AVATAR_SIZE_MIN, AVATAR_SIZE_MAX);
    }
    const geometryResult = await computeGeometryAvatar({
      imageData,
      bodyBox: bodyBoxForSearch,
      side: usedSide,
      sourceWidth: imageWidth,
      sourceHeight: imageHeight,
      size: avatarSize
    });
    if (geometryResult) {
      avatarBox = geometryResult.avatarBox;
      avatarPresent = geometryResult.avatarPresent;
      avatarShape = null;
      avatarScore = geometryResult.score;
      methodUsed = 'geometry';
    }
  }

  const normalizedAvatarBox = avatarBox ? normalizeAvatarBox(avatarBox, imageWidth, imageHeight) : null;
  await saveAvatarDebugImages({
    imagePath,
    messageIndex,
    bodyBox: bodyBoxForSearch,
    searchRegion,
    avatarBox: normalizedAvatarBox
  });

  return {
    avatarBox: normalizedAvatarBox,
    avatarPresent,
    avatarShape,
    avatarScore,
    methodUsed,
    searchRegion,
    facesFound
  };
}

export async function ensureFaceModelsLoaded() {
  const loaded = await loadFaceModels();
  if (!loaded || !faceapi.nets.ssdMobilenetv1.isLoaded) {
    throw new Error('SSD Mobilenet V1 model failed to load. Check ../models.');
  }
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

    const validated = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const avatarDetails = await extractAvatarForMessage({
        msg,
        imageData,
        imagePath,
        imageWidth,
        imageHeight,
        messageIndex: i + 1
      });

      let avatarDataUrl = null;
      if (avatarDetails.avatarBox && avatarDetails.avatarPresent) {
        try {
          const cropped = await sharp(imageData)
            .extract({
              left: avatarDetails.avatarBox.x,
              top: avatarDetails.avatarBox.y,
              width: avatarDetails.avatarBox.width,
              height: avatarDetails.avatarBox.height
            })
            .png()
            .toBuffer();
          avatarDataUrl = `data:image/png;base64,${cropped.toString('base64')}`;
        } catch (cropError) {
          console.warn('Avatar crop failed:', cropError);
        }
      }

      validated.push({
        text: String(msg.text || ''),
        quoteText: String(msg.text || ''),
        side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
        order: msg.order || (i + 1),
        authorName: msg.authorName ? String(msg.authorName) : '',
        authorRole: msg.authorRole ? String(msg.authorRole) : '',
        bodyBox: normalizeBodyBox(msg.bodyBox, imageWidth, imageHeight),
        avatarPresent: Boolean(avatarDetails.avatarPresent),
        avatarShape: avatarDetails.avatarShape || null,
        avatarBox: avatarDetails.avatarBox,
        avatarPlacementPct: null,
        avatarDataUrl,
        avatarMethodUsed: avatarDetails.methodUsed,
        avatarSearchRegion: avatarDetails.searchRegion,
        avatarScore: avatarDetails.avatarScore,
        facesFound: avatarDetails.facesFound
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

  for (const path of imagePaths) {
    const messages = await extractMessagesFromImage(path);
    for (const msg of messages) {
      msg.order = msg.order + orderOffset;
      allMessages.push(msg);
    }
    orderOffset = allMessages.length;
  }

  return allMessages;
}
