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
    "side": "left",
    "order": 1,
    "authorName": "if present, otherwise null",
    "authorRole": "if present, otherwise null",
    "bodyBox": {
      "x": 0,
      "y": 0,
      "width": 0,
      "height": 0
    }
  }
]

RULES:
- "text": Copy the EXACT text, preserve emojis, punctuation, spelling
- "side": "left" if bubble is on left side of screen, "right" if on right side
- "order": Number messages from top to bottom starting at 1
- Include ALL messages visible in the screenshot
- If you see multiple screenshots, extract from all of them
- "bodyBox" is a tight pixel bounding box around the message text itself (not including the avatar).`;

const INSUFFICIENT_FUNDS_CODE = 'INSUFFICIENT_FUNDS';
const GEMINI_TIMEOUT_MS = 30000;
const FACE_MODEL_PATH = path.resolve(process.cwd(), '../models');
const REQUIRED_SSD_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json'
];
const MIN_FACE_CONFIDENCE = 0.5;

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

const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug', 'testimonial-avatars');
const TEXTURE_VARIANCE_THRESHOLD = 25;
const SATURATION_VARIANCE_THRESHOLD = 0.015;

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBodyBox(bodyBox, imageWidth, imageHeight) {
  if (!bodyBox) return null;
  if (!imageWidth || !imageHeight) return null;

  const rawWidth = bodyBox.width ?? bodyBox.w ?? bodyBox.W;
  const rawHeight = bodyBox.height ?? bodyBox.h ?? bodyBox.H;
  const rawX = bodyBox.x;
  const rawY = bodyBox.y;

  if (![rawWidth, rawHeight, rawX, rawY].every(Number.isFinite)) {
    return null;
  }

  let width = Number(rawWidth);
  let height = Number(rawHeight);
  let x = Number(rawX);
  let y = Number(rawY);

  const normalized = width <= 1.5 && height <= 1.5 && x <= 1.5 && y <= 1.5;
  if (normalized) {
    width *= imageWidth;
    height *= imageHeight;
    x *= imageWidth;
    y *= imageHeight;
  }

  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  x = Math.round(x);
  y = Math.round(y);

  x = clampValue(x, 0, imageWidth - 1);
  y = clampValue(y, 0, imageHeight - 1);
  width = clampValue(width, 1, imageWidth - x);
  height = clampValue(height, 1, imageHeight - y);

  return { x, y, width, height };
}

function computeAvatarSearchRegion(bodyBox, side, sourceWidth, sourceHeight) {
  if (!bodyBox || !sourceWidth || !sourceHeight) return null;
  const size = clampValue(Math.round(0.55 * bodyBox.height), 40, 180);

  const ry1 = Math.max(0, bodyBox.y - Math.round(0.25 * bodyBox.height));
  const ry2 = Math.min(sourceHeight, bodyBox.y + Math.round(1.1 * bodyBox.height));

  let rx1;
  let rx2;
  if (side === 'right') {
    rx1 = Math.min(sourceWidth, bodyBox.x + bodyBox.width + Math.round(0.15 * size));
    rx2 = Math.min(sourceWidth, bodyBox.x + bodyBox.width + Math.round(1.8 * size));
  } else {
    rx1 = Math.max(0, bodyBox.x - Math.round(1.8 * size));
    rx2 = Math.max(0, bodyBox.x - Math.round(0.15 * size));
  }

  const regionWidth = Math.max(1, rx2 - rx1);
  const regionHeight = Math.max(1, ry2 - ry1);
  const centerX = rx1 + regionWidth / 2;
  const centerY = ry1 + regionHeight / 2;

  return {
    region: {
      x: rx1,
      y: ry1,
      width: regionWidth,
      height: regionHeight
    },
    expectedCenter: { x: centerX, y: centerY },
    expectedSize: size
  };
}

function ensureDebugOutputDir() {
  if (!fs.existsSync(DEBUG_OUTPUT_DIR)) {
    fs.mkdirSync(DEBUG_OUTPUT_DIR, { recursive: true });
  }
}

async function detectFacesInRegion(image, region) {
  try {
    const ready = await loadFaceModels();
    if (!ready || !faceapi.nets.ssdMobilenetv1.isLoaded) {
      console.warn('Face detection models not ready.');
      return [];
    }

    const detectWidth = Math.max(1, Math.round(region.width * 2));
    const detectHeight = Math.max(1, Math.round(region.height * 2));

    const detectionCanvas = createCanvas(detectWidth, detectHeight);
    const ctx = detectionCanvas.getContext('2d');
    ctx.drawImage(
      image,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      detectWidth,
      detectHeight
    );

    const detections = await faceapi.detectAllFaces(
      detectionCanvas,
      new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_FACE_CONFIDENCE })
    );

    const scaleX = region.width / detectWidth;
    const scaleY = region.height / detectHeight;

    return detections.map(det => {
      const detectBox = det.box;
      return {
        x: region.x + detectBox.x * scaleX,
        y: region.y + detectBox.y * scaleY,
        width: detectBox.width * scaleX,
        height: detectBox.height * scaleY
      };
    });
  } catch (error) {
    console.warn('Face detection failed:', error);
    return [];
  }
}

function computeSquareBoxFromCenter(centerX, centerY, size, imageWidth, imageHeight) {
  const half = size / 2;
  const x = clampValue(Math.round(centerX - half), 0, imageWidth - 1);
  const y = clampValue(Math.round(centerY - half), 0, imageHeight - 1);
  const width = clampValue(Math.round(size), 1, imageWidth - x);
  const height = clampValue(Math.round(size), 1, imageHeight - y);
  return { x, y, width, height };
}

function computeDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeVariance(values, mean) {
  if (!values.length) return 0;
  const avg = mean ?? values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + (val - avg) ** 2, 0) / values.length;
  return variance;
}

function computeTextureStats(buffer, info, box) {
  const channels = info.channels;
  const values = [];
  const saturationValues = [];
  const startX = clampValue(Math.round(box.x), 0, info.width - 1);
  const startY = clampValue(Math.round(box.y), 0, info.height - 1);
  const endX = clampValue(Math.round(box.x + box.width), 1, info.width);
  const endY = clampValue(Math.round(box.y + box.height), 1, info.height);

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const idx = (y * info.width + x) * channels;
      const r = buffer[idx];
      const g = buffer[idx + 1];
      const b = buffer[idx + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      values.push(gray);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      saturationValues.push(sat);
    }
  }

  const variance = computeVariance(values);
  const saturationVariance = computeVariance(saturationValues);

  return { variance, saturationVariance };
}

function computeEdgeMap(gray, width, height) {
  const magnitude = new Float32Array(width * height);
  let maxMag = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx =
        -gray[idx - width - 1] + gray[idx - width + 1] +
        -2 * gray[idx - 1] + 2 * gray[idx + 1] +
        -gray[idx + width - 1] + gray[idx + width + 1];
      const gy =
        gray[idx - width - 1] + 2 * gray[idx - width] + gray[idx - width + 1] -
        gray[idx + width - 1] - 2 * gray[idx + width] - gray[idx + width + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      magnitude[idx] = mag;
      if (mag > maxMag) {
        maxMag = mag;
      }
    }
  }

  const threshold = Math.max(30, maxMag * 0.3);
  const edges = new Uint8Array(width * height);
  for (let i = 0; i < magnitude.length; i += 1) {
    edges[i] = magnitude[i] >= threshold ? 1 : 0;
  }

  return edges;
}

function findEdgeComponents(edges, width, height) {
  const visited = new Uint8Array(edges.length);
  const components = [];
  const stack = [];

  for (let i = 0; i < edges.length; i += 1) {
    if (!edges[i] || visited[i]) continue;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let perimeter = 0;

    stack.push(i);
    visited[i] = 1;

    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = Math.floor(idx / width);

      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [
        idx - 1,
        idx + 1,
        idx - width,
        idx + width
      ];

      let edgeBoundary = false;
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= edges.length || !edges[neighbor]) {
          edgeBoundary = true;
          continue;
        }
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
      if (edgeBoundary) perimeter += 1;
    }

    components.push({
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1),
      area,
      perimeter: Math.max(1, perimeter)
    });
  }

  return components;
}

async function detectAvatarByContours(imageData, region, expectedCenter, expectedSize) {
  const regionBuffer = await sharp(imageData)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = regionBuffer;
  const gray = new Uint8Array(info.width * info.height);

  for (let i = 0; i < info.width * info.height; i += 1) {
    const idx = i * info.channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  const edges = computeEdgeMap(gray, info.width, info.height);
  const components = findEdgeComponents(edges, info.width, info.height);

  let bestCandidate = null;
  const expectedCenterLocal = {
    x: expectedCenter.x - region.x,
    y: expectedCenter.y - region.y
  };
  const regionDiagonal = Math.hypot(info.width, info.height) || 1;

  for (const component of components) {
    const cw = component.width;
    const ch = component.height;
    const minSide = Math.min(cw, ch);
    const maxSide = Math.max(cw, ch);
    const squareness = minSide / maxSide;

    if (squareness < 0.75) continue;
    if (minSide < 0.55 * expectedSize || minSide > 1.6 * expectedSize) continue;

    const area = cw * ch;
    const circularity = 4 * Math.PI * area / (component.perimeter ** 2);
    const smoothness = component.perimeter / (2 * (cw + ch));
    const roundedSquarePass = squareness >= 0.85 && smoothness >= 0.7 && smoothness <= 1.6;

    if (circularity < 0.7 && !roundedSquarePass) continue;

    const centerX = component.x + cw / 2;
    const centerY = component.y + ch / 2;
    const distance = computeDistance({ x: centerX, y: centerY }, expectedCenterLocal);

    const stats = computeTextureStats(data, info, component);
    const varianceScore = Math.min(1, stats.variance / 400);
    const saturationScore = Math.min(1, stats.saturationVariance / 0.05);
    const distancePenalty = distance / regionDiagonal;

    const score = circularity + varianceScore + saturationScore - distancePenalty;

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        component,
        score,
        stats
      };
    }
  }

  if (!bestCandidate) return null;

  const { component, score } = bestCandidate;
  const padding = Math.round(0.08 * Math.max(component.width, component.height));
  const size = Math.max(component.width, component.height) + padding * 2;
  const centerX = component.x + component.width / 2;
  const centerY = component.y + component.height / 2;
  const boxLocal = computeSquareBoxFromCenter(centerX, centerY, size, info.width, info.height);

  return {
    avatarBox: {
      x: region.x + boxLocal.x,
      y: region.y + boxLocal.y,
      width: boxLocal.width,
      height: boxLocal.height
    },
    score
  };
}

async function drawDebugImages({ imagePath, bodyBox, searchRegion, avatarBox, messageIndex, methodUsed }) {
  ensureDebugOutputDir();
  const img = await canvas.loadImage(imagePath);
  const debugCanvas = createCanvas(img.width, img.height);
  const ctx = debugCanvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  function drawRect(rect, color) {
    if (!rect) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  drawRect(bodyBox, '#00FF5A');
  drawRect(searchRegion, '#4B9CFF');
  drawRect(avatarBox, '#FF4B4B');

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '16px Arial';
  ctx.fillText(`msg-${messageIndex}-${methodUsed}`, 10, 20);

  const baseName = path.basename(imagePath, path.extname(imagePath));
  const debugPath = path.join(DEBUG_OUTPUT_DIR, `${baseName}-msg-${messageIndex}-debug.png`);
  const avatarPath = path.join(DEBUG_OUTPUT_DIR, `${baseName}-msg-${messageIndex}-avatar.png`);

  fs.writeFileSync(debugPath, debugCanvas.toBuffer('image/png'));

  if (avatarBox) {
    try {
      const cropped = await sharp(imagePath)
        .extract({
          left: avatarBox.x,
          top: avatarBox.y,
          width: avatarBox.width,
          height: avatarBox.height
        })
        .png()
        .toBuffer();
      fs.writeFileSync(avatarPath, cropped);
    } catch (error) {
      console.warn('Avatar debug crop failed:', error);
    }
  }

  return { debugPath, avatarPath };
}

export async function ensureFaceModelsLoaded() {
  const loaded = await loadFaceModels();
  if (!loaded || !faceapi.nets.ssdMobilenetv1.isLoaded) {
    throw new Error('SSD Mobilenet V1 model failed to load. Check ../models.');
  }
}

async function extractAvatarForMessage({
  imagePath,
  imageData,
  imageWidth,
  imageHeight,
  messageIndex,
  message,
  image
}) {
  const rawBodyBox = message.bodyBox || message.body_box || message.bodybox || null;
  const bodyBox = normalizeBodyBox(rawBodyBox, imageWidth, imageHeight);
  const preferredSide = message.side === 'right' ? 'right' : (message.side === 'left' ? 'left' : null);
  const sidesToTry = preferredSide ? [preferredSide] : ['left', 'right'];

  if (!bodyBox) {
    console.log('Avatar extraction result:', {
      messageIndex,
      methodUsed: 'none',
      searchRegion: null,
      avatarBox: null,
      avatarScore: null,
      facesFound: 0
    });
    return {
      avatarPresent: false,
      avatarShape: null,
      avatarBox: null,
      avatarPlacementPct: null,
      avatarDataUrl: null,
      methodUsed: 'none',
      searchRegion: null,
      avatarScore: null,
      facesFound: 0
    };
  }

  for (let i = 0; i < sidesToTry.length; i += 1) {
    const side = sidesToTry[i];
    const search = computeAvatarSearchRegion(bodyBox, side, imageWidth, imageHeight);
    if (!search) continue;

    const { region, expectedCenter, expectedSize } = search;
    let facesFound = 0;
    let methodUsed = 'none';
    let avatarBox = null;
    let avatarScore = null;
    let avatarPresent = false;
    let avatarShape = null;

    const faces = await detectFacesInRegion(image, region);
    facesFound = faces.length;

    if (facesFound > 0) {
      const sortedFaces = faces.sort((a, b) => {
        const centerA = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
        const centerB = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        const distanceA = computeDistance(centerA, expectedCenter);
        const distanceB = computeDistance(centerB, expectedCenter);
        return distanceA - distanceB;
      });

      const faceBox = sortedFaces[0];
      const faceCenter = {
        x: faceBox.x + faceBox.width / 2,
        y: faceBox.y + faceBox.height / 2
      };
      const avatarSize = Math.max(expectedSize, faceBox.width * 1.6);
      avatarBox = computeSquareBoxFromCenter(faceCenter.x, faceCenter.y, avatarSize, imageWidth, imageHeight);
      avatarPresent = true;
      avatarShape = 'circle';
      methodUsed = 'faceapi';
      avatarScore = 1;
    } else {
      const contourResult = await detectAvatarByContours(imageData, region, expectedCenter, expectedSize);
      if (contourResult) {
        avatarBox = contourResult.avatarBox;
        avatarPresent = true;
        avatarShape = 'rounded';
        methodUsed = 'contour';
        avatarScore = contourResult.score;
      } else {
        const avatarSize = expectedSize;
        const offset = Math.round(0.2 * bodyBox.height);
        const ax = side === 'right'
          ? clampValue(bodyBox.x + bodyBox.width + offset, 0, imageWidth - avatarSize)
          : clampValue(bodyBox.x - avatarSize - offset, 0, imageWidth - avatarSize);
        const ay = clampValue(bodyBox.y + Math.round(0.08 * bodyBox.height), 0, imageHeight - avatarSize);
        avatarBox = {
          x: Math.round(ax),
          y: Math.round(ay),
          width: avatarSize,
          height: avatarSize
        };

        const regionBuffer = await sharp(imageData)
          .extract({
            left: avatarBox.x,
            top: avatarBox.y,
            width: avatarBox.width,
            height: avatarBox.height
          })
          .raw()
          .toBuffer({ resolveWithObject: true });

        const stats = computeTextureStats(regionBuffer.data, regionBuffer.info, {
          x: 0,
          y: 0,
          width: regionBuffer.info.width,
          height: regionBuffer.info.height
        });

        if (stats.variance < TEXTURE_VARIANCE_THRESHOLD && stats.saturationVariance < SATURATION_VARIANCE_THRESHOLD) {
          avatarPresent = false;
          avatarShape = null;
          methodUsed = 'none';
          avatarScore = 0;
        } else {
          avatarPresent = true;
          avatarShape = null;
          methodUsed = 'geometry';
          avatarScore = stats.variance + stats.saturationVariance;
        }
      }
    }

    const isFinalAttempt = avatarPresent || preferredSide || i === sidesToTry.length - 1;
    if (isFinalAttempt) {
      await drawDebugImages({
        imagePath,
        bodyBox,
        searchRegion: region,
        avatarBox,
        messageIndex,
        methodUsed
      });

      let avatarDataUrl = null;
      if (avatarBox) {
        try {
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
        } catch (cropError) {
          console.warn('Avatar crop failed:', cropError);
          avatarPresent = false;
        }
      }

      const result = {
        avatarPresent,
        avatarShape,
        avatarBox,
        avatarPlacementPct: null,
        avatarDataUrl,
        methodUsed,
        searchRegion: region,
        avatarScore,
        facesFound
      };

      console.log('Avatar extraction result:', {
        messageIndex,
        methodUsed,
        searchRegion: region,
        avatarBox,
        avatarScore,
        facesFound
      });

      return result;
    }
  }

  return {
    avatarPresent: false,
    avatarShape: null,
    avatarBox: null,
    avatarPlacementPct: null,
    avatarDataUrl: null,
    methodUsed: 'none',
    searchRegion: null,
    avatarScore: null,
    facesFound: 0
  };
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

    const detectionImage = await canvas.loadImage(imagePath);

    // Ensure required fields exist
    const validated = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const avatarExtraction = await extractAvatarForMessage({
        imagePath,
        imageData,
        imageWidth,
        imageHeight,
        messageIndex: i + 1,
        message: msg,
        image: detectionImage
      });

      validated.push({
        text: String(msg.text || ''),
        quoteText: String(msg.text || ''),
        side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
        order: msg.order || (i + 1),
        authorName: msg.authorName ? String(msg.authorName) : '',
        authorRole: msg.authorRole ? String(msg.authorRole) : '',
        bodyBox: normalizeBodyBox(msg.bodyBox || msg.body_box || msg.bodybox || null, imageWidth, imageHeight),
        avatarPresent: avatarExtraction.avatarPresent,
        avatarShape: avatarExtraction.avatarShape,
        avatarBox: avatarExtraction.avatarBox,
        avatarPlacementPct: avatarExtraction.avatarPlacementPct,
        avatarDataUrl: avatarExtraction.avatarDataUrl,
        methodUsed: avatarExtraction.methodUsed,
        searchRegion: avatarExtraction.searchRegion,
        avatarScore: avatarExtraction.avatarScore,
        facesFound: avatarExtraction.facesFound
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
