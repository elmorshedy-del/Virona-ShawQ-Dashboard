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
    "bodyBox": { "x": 0, "y": 0, "w": 0, "h": 0 }
  }
]

RULES:
- "text": Copy the EXACT text, preserve emojis, punctuation, spelling
- "side": "left" if bubble is on left side of screen, "right" if on right side
- "order": Number messages from top to bottom starting at 1
- Include ALL messages visible in the screenshot
- "bodyBox": tight bounding box around the message text bubble, in absolute pixels (x,y,w,h)
- If you see multiple screenshots, extract from all of them`;

const INSUFFICIENT_FUNDS_CODE = 'INSUFFICIENT_FUNDS';
const GEMINI_TIMEOUT_MS = 30000;
const FACE_MODEL_PATH = path.resolve(process.cwd(), '../models');
const REQUIRED_SSD_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json'
];
const MIN_FACE_CONFIDENCE = 0.5;
const MIN_AVATAR_SIZE = 40;
const MAX_AVATAR_SIZE = 180;
const DEFAULT_AVATAR_PADDING_RATIO = 0.08;
const GEOMETRY_VARIANCE_THRESHOLD = 0.005;
const GEOMETRY_SATURATION_VARIANCE_THRESHOLD = 0.002;

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isInsufficientFundsError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('insufficient') || message.includes('quota') || message.includes('billing');
}

function normalizeBodyBox(bodyBox, imageWidth, imageHeight) {
  if (!bodyBox || !imageWidth || !imageHeight) return null;
  const x = Number(bodyBox.x ?? bodyBox.left ?? 0);
  const y = Number(bodyBox.y ?? bodyBox.top ?? 0);
  const width = Number(bodyBox.w ?? bodyBox.width ?? 0);
  const height = Number(bodyBox.h ?? bodyBox.height ?? 0);

  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;

  const clampedX = clamp(Math.round(x), 0, imageWidth - 1);
  const clampedY = clamp(Math.round(y), 0, imageHeight - 1);
  const clampedWidth = clamp(Math.round(width), 1, imageWidth - clampedX);
  const clampedHeight = clamp(Math.round(height), 1, imageHeight - clampedY);

  return {
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight
  };
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

function computeSearchRegion(bodyBox, side, sourceWidth, sourceHeight) {
  const avatarSize = clamp(Math.round(0.55 * bodyBox.height), MIN_AVATAR_SIZE, MAX_AVATAR_SIZE);
  let rx1;
  let rx2;
  if (side === 'right') {
    rx1 = Math.min(sourceWidth, bodyBox.x + bodyBox.width + Math.round(0.15 * avatarSize));
    rx2 = Math.min(sourceWidth, bodyBox.x + bodyBox.width + Math.round(1.8 * avatarSize));
  } else {
    rx1 = Math.max(0, bodyBox.x - Math.round(1.8 * avatarSize));
    rx2 = Math.max(0, bodyBox.x - Math.round(0.15 * avatarSize));
  }
  const ry1 = Math.max(0, bodyBox.y - Math.round(0.25 * bodyBox.height));
  const ry2 = Math.min(sourceHeight, bodyBox.y + Math.round(1.1 * bodyBox.height));

  const x = Math.min(rx1, rx2);
  const y = Math.min(ry1, ry2);
  const width = Math.max(1, Math.round(Math.abs(rx2 - rx1)));
  const height = Math.max(1, Math.round(Math.abs(ry2 - ry1)));

  return {
    x,
    y,
    width: Math.min(width, sourceWidth - x),
    height: Math.min(height, sourceHeight - y),
    expectedSize: avatarSize
  };
}

function computeExpectedCenter(region) {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2
  };
}

async function detectFacesInRegion(imageData, region) {
  try {
    const ready = await loadFaceModels();
    if (!ready || !faceapi.nets.ssdMobilenetv1.isLoaded) {
      console.warn('Face detection models not ready. Skipping face detection.');
      return [];
    }
  } catch (error) {
    console.warn('Face detection unavailable:', error.message || error);
    return [];
  }

  if (!region || region.width <= 0 || region.height <= 0) {
    return [];
  }

  const regionBuffer = await sharp(imageData)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .png()
    .toBuffer();

  const img = await canvas.loadImage(regionBuffer);
  const sourceWidth = img.width;
  const sourceHeight = img.height;
  const detectWidth = Math.max(1, sourceWidth * 2);
  const detectHeight = Math.max(1, sourceHeight * 2);

  const detectionCanvas = createCanvas(detectWidth, detectHeight);
  if (detectionCanvas.width !== detectWidth || detectionCanvas.height !== detectHeight) {
    return [];
  }

  const ctx = detectionCanvas.getContext('2d');
  ctx.drawImage(img, 0, 0, detectWidth, detectHeight);

  if (img.width !== sourceWidth || img.height !== sourceHeight) {
    return [];
  }

  let detections = [];
  try {
    detections = await faceapi.detectAllFaces(
      detectionCanvas,
      new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_FACE_CONFIDENCE })
    );
  } catch (error) {
    console.warn('Face detection failed:', error.message || error);
    return [];
  }

  const scaleX = sourceWidth / detectWidth;
  const scaleY = sourceHeight / detectHeight;

  const mappedDetections = detections.map(det => {
    const detectBox = det.box;
    return {
      x: detectBox.x * scaleX + region.x,
      y: detectBox.y * scaleY + region.y,
      width: detectBox.width * scaleX,
      height: detectBox.height * scaleY
    };
  });

  return mappedDetections;
}

async function getRegionPixels(imageData, region) {
  const { data, info } = await sharp(imageData)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels
  };
}

function computeGrayscale(pixels, channels) {
  const length = pixels.length / channels;
  const gray = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const idx = i * channels;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

function computeEdgeMap(gray, width, height) {
  const edge = new Uint8Array(width * height);
  const magnitudes = new Float32Array(width * height);
  let sum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = (
        -gray[idx - width - 1] - 2 * gray[idx - 1] - gray[idx + width - 1]
        + gray[idx - width + 1] + 2 * gray[idx + 1] + gray[idx + width + 1]
      );
      const gy = (
        -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1]
        + gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1]
      );
      const mag = Math.sqrt(gx * gx + gy * gy);
      magnitudes[idx] = mag;
      sum += mag;
      count += 1;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  const threshold = Math.max(20, mean * 1.5);

  for (let i = 0; i < magnitudes.length; i++) {
    edge[i] = magnitudes[i] >= threshold ? 1 : 0;
  }

  return edge;
}

function analyzeComponents(edgeMap, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const directions = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];

  for (let i = 0; i < edgeMap.length; i++) {
    if (!edgeMap[i] || visited[i]) continue;
    const queue = [i];
    visited[i] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let area = 0;
    let perimeter = 0;

    while (queue.length > 0) {
      const idx = queue.pop();
      const x = idx % width;
      const y = Math.floor(idx / width);
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      let neighborEdges = 0;
      for (const dir of directions) {
        const nIdx = idx + dir;
        if (nIdx < 0 || nIdx >= edgeMap.length) continue;
        if (edgeMap[nIdx]) {
          neighborEdges += 1;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
      if (neighborEdges < directions.length / 2) {
        perimeter += 1;
      }
    }

    components.push({
      minX,
      maxX,
      minY,
      maxY,
      area,
      perimeter
    });
  }

  return components;
}

function computeVariance(values) {
  if (!values.length) return 0;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) ** 2;
  return variance / values.length;
}

function computeRegionVariance(gray, width, height, box) {
  const values = [];
  const startX = clamp(box.minX, 0, width - 1);
  const endX = clamp(box.maxX, 0, width - 1);
  const startY = clamp(box.minY, 0, height - 1);
  const endY = clamp(box.maxY, 0, height - 1);

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      values.push(gray[y * width + x]);
    }
  }

  return computeVariance(values);
}

function scoreContourCandidate(component, gray, width, height, region, expectedCenter, expectedSize) {
  const cw = component.maxX - component.minX + 1;
  const ch = component.maxY - component.minY + 1;
  const minSize = 0.55 * expectedSize;
  const maxSize = 1.6 * expectedSize;
  const size = Math.min(cw, ch);
  if (size < minSize || size > maxSize) return null;

  const squareness = Math.min(cw, ch) / Math.max(cw, ch);
  if (squareness < 0.75) return null;

  const perimeter = component.perimeter || 1;
  const circularity = (4 * Math.PI * component.area) / (perimeter * perimeter);
  const smoothness = perimeter / (2 * (cw + ch));
  const roundedSquare = squareness >= 0.85 && smoothness <= 1.35;
  if (circularity < 0.7 && !roundedSquare) return null;

  const textureVariance = computeRegionVariance(gray, width, height, component);
  const textureScore = textureVariance / (255 * 255);
  const cx = region.x + component.minX + cw / 2;
  const cy = region.y + component.minY + ch / 2;
  const distance = Math.hypot(cx - expectedCenter.x, cy - expectedCenter.y);
  const maxDistance = Math.hypot(region.width, region.height) || 1;
  const distanceScore = distance / maxDistance;

  const score = circularity + textureScore - distanceScore + (roundedSquare ? 0.1 : 0);

  return {
    score,
    circularity,
    textureScore,
    squareness,
    center: { x: cx, y: cy },
    size: Math.max(cw, ch)
  };
}

async function detectContourAvatar(imageData, region, expectedSize) {
  if (!region || region.width <= 0 || region.height <= 0) return null;
  const { data, width, height, channels } = await getRegionPixels(imageData, region);
  const gray = computeGrayscale(data, channels);
  const edgeMap = computeEdgeMap(gray, width, height);
  const components = analyzeComponents(edgeMap, width, height);
  if (components.length === 0) return null;

  const expectedCenter = computeExpectedCenter(region);
  let best = null;

  for (const component of components) {
    const candidate = scoreContourCandidate(
      component,
      gray,
      width,
      height,
      region,
      expectedCenter,
      expectedSize
    );
    if (!candidate) continue;
    if (!best || candidate.score > best.score) {
      best = {
        ...candidate,
        component
      };
    }
  }

  if (!best) return null;

  const padding = Math.round(best.size * DEFAULT_AVATAR_PADDING_RATIO);
  const finalSize = best.size + padding * 2;
  const half = finalSize / 2;
  const x = clamp(Math.round(best.center.x - half), 0, region.x + region.width - finalSize);
  const y = clamp(Math.round(best.center.y - half), 0, region.y + region.height - finalSize);

  return {
    box: {
      x,
      y,
      width: finalSize,
      height: finalSize
    },
    score: best.score
  };
}

function computeSaturationVariance(pixels, channels) {
  const sats = [];
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    sats.push(sat);
  }
  return computeVariance(sats);
}

async function evaluateGeometryCrop(imageData, avatarBox) {
  const { data, channels } = await sharp(imageData)
    .extract({
      left: avatarBox.x,
      top: avatarBox.y,
      width: avatarBox.width,
      height: avatarBox.height
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray = computeGrayscale(data, channels);
  const variance = computeVariance(gray) / (255 * 255);
  const saturationVariance = computeSaturationVariance(data, channels);

  return {
    variance,
    saturationVariance
  };
}

function buildGeometryAvatarBox(bodyBox, side, avatarSize, sourceWidth, sourceHeight) {
  const offset = Math.round(0.2 * bodyBox.height);
  let ax;
  if (side === 'right') {
    ax = clamp(bodyBox.x + bodyBox.width + offset, 0, sourceWidth - avatarSize);
  } else {
    ax = clamp(bodyBox.x - avatarSize - offset, 0, sourceWidth - avatarSize);
  }
  const ay = clamp(bodyBox.y + Math.round(0.08 * bodyBox.height), 0, sourceHeight - avatarSize);
  return {
    x: ax,
    y: ay,
    width: avatarSize,
    height: avatarSize
  };
}

function drawDebugBox(ctx, box, color) {
  if (!box) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
}

async function writeDebugImages({
  imageData,
  outputDir,
  debugBase,
  index,
  bodyBox,
  searchRegion,
  avatarBox
}) {
  const img = await canvas.loadImage(imageData);
  const debugCanvas = createCanvas(img.width, img.height);
  const ctx = debugCanvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  drawDebugBox(ctx, bodyBox, '#00ff5a');
  drawDebugBox(ctx, searchRegion, '#3a7bff');
  drawDebugBox(ctx, avatarBox, '#ff4d4d');

  const debugPath = path.join(outputDir, `${debugBase}-msg-${index + 1}-debug.png`);
  const cropPath = path.join(outputDir, `${debugBase}-msg-${index + 1}-avatar.png`);

  await fs.promises.writeFile(debugPath, debugCanvas.toBuffer('image/png'));

  if (avatarBox) {
    await sharp(imageData)
      .extract({
        left: avatarBox.x,
        top: avatarBox.y,
        width: avatarBox.width,
        height: avatarBox.height
      })
      .png()
      .toFile(cropPath);
  } else {
    await fs.promises.writeFile(cropPath, Buffer.from(''));
  }
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

    const debugDir = path.resolve(process.cwd(), 'uploads/testimonials/debug');
    await fs.promises.mkdir(debugDir, { recursive: true });
    const debugBase = `${path.basename(imagePath, path.extname(imagePath))}-${Date.now()}`;

    // Ensure required fields exist
    const validated = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const sideInput = msg.side === 'right' ? 'right' : (msg.side === 'left' ? 'left' : null);
      const bodyBox = normalizeBodyBox(msg.bodyBox, imageWidth, imageHeight);
      const sideOptions = sideInput ? [sideInput] : ['left', 'right'];
      let avatarBox = null;
      let avatarPresent = false;
      let avatarDataUrl = null;
      let avatarScore = null;
      let methodUsed = 'none';
      let facesFound = 0;
      let searchRegion = null;
      const avatarShape = 'circle';

      if (bodyBox) {
        for (const side of sideOptions) {
          const region = computeSearchRegion(bodyBox, side, imageWidth, imageHeight);
          searchRegion = region;
          const expectedCenter = computeExpectedCenter(region);
          const faceDetections = await detectFacesInRegion(imageData, region);
          facesFound = faceDetections.length;

          if (faceDetections.length > 0) {
            const bestFace = faceDetections.reduce((best, face) => {
              const center = {
                x: face.x + face.width / 2,
                y: face.y + face.height / 2
              };
              const distance = Math.hypot(center.x - expectedCenter.x, center.y - expectedCenter.y);
              if (!best || distance < best.distance) {
                return { face, distance };
              }
              return best;
            }, null);

            if (bestFace) {
              const face = bestFace.face;
              const avatarSize = Math.max(region.expectedSize, face.width * 1.6);
              const centerX = face.x + face.width / 2;
              const centerY = face.y + face.height / 2;
              const half = avatarSize / 2;
              avatarBox = normalizeAvatarBox({
                x: Math.round(centerX - half),
                y: Math.round(centerY - half),
                width: Math.round(avatarSize),
                height: Math.round(avatarSize)
              }, imageWidth, imageHeight);
              if (avatarBox) {
                avatarPresent = true;
                methodUsed = 'faceapi';
                avatarScore = 1;
                break;
              }
            }
          }

          const contourResult = await detectContourAvatar(imageData, region, region.expectedSize);
          if (contourResult && contourResult.box) {
            avatarBox = normalizeAvatarBox(contourResult.box, imageWidth, imageHeight);
            if (avatarBox) {
              avatarPresent = true;
              methodUsed = 'contour';
              avatarScore = contourResult.score;
              break;
            }
          }

          const geometryBox = buildGeometryAvatarBox(bodyBox, side, region.expectedSize, imageWidth, imageHeight);
          avatarBox = normalizeAvatarBox(geometryBox, imageWidth, imageHeight);
          if (avatarBox) {
            const geometryStats = await evaluateGeometryCrop(imageData, avatarBox);
            avatarScore = geometryStats.variance + geometryStats.saturationVariance;
            avatarPresent = !(
              geometryStats.variance < GEOMETRY_VARIANCE_THRESHOLD &&
              geometryStats.saturationVariance < GEOMETRY_SATURATION_VARIANCE_THRESHOLD
            );
            methodUsed = 'geometry';
            break;
          }
        }
      }

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

      await writeDebugImages({
        imageData,
        outputDir: debugDir,
        debugBase,
        index: i,
        bodyBox,
        searchRegion,
        avatarBox
      });

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
        methodUsed,
        searchRegion,
        avatarScore,
        facesFound
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
