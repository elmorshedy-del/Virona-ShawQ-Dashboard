import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import sharp from 'sharp';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISION_PROMPT = `Analyze this chat screenshot. Extract every message bubble you see.

Return ONLY a valid JSON array, nothing else before or after:

[
  {
    "text": "exact message text including emojis",
    "quoteText": "same as text",
    "side": "left",
    "order": 1,
    "authorName": "if present, otherwise null",
    "authorRole": "if present, otherwise null",
    "avatarPresent": true,
    "avatarShape": "circle|rounded|null",
    "avatarBox": { "x": 10, "y": 20, "width": 50, "height": 50 }
  }
]

RULES:
- "text": Copy the EXACT text, preserve emojis, punctuation, spelling
- "quoteText": same as text (keep in sync)
- "side": "left" if bubble is on left side of screen, "right" if on right side
- "order": Number messages from top to bottom starting at 1
- Include ALL messages visible in the screenshot
- If you see an avatar/profile photo, set avatarPresent=true and provide avatarBox in PIXELS relative to the image
- If no avatar exists for a message, set avatarPresent=false and avatarBox=null
- If you see multiple screenshots, extract from all of them`;

const INSUFFICIENT_FUNDS_CODE = 'INSUFFICIENT_FUNDS';

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

function computeAvatarPlacementPct(avatarBox, imageWidth, imageHeight) {
  if (!avatarBox) return null;
  if (!imageWidth || !imageHeight) return null;
  return {
    xPct: Number(((avatarBox.x / imageWidth) * 100).toFixed(2)),
    yPct: Number(((avatarBox.y / imageHeight) * 100).toFixed(2)),
    wPct: Number(((avatarBox.width / imageWidth) * 100).toFixed(2)),
    hPct: Number(((avatarBox.height / imageHeight) * 100).toFixed(2))
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

    const result = await model.generateContent([VISION_PROMPT, imagePart]);
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

    // Ensure required fields exist
    const validated = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const avatarBox = normalizeAvatarBox(msg.avatarBox, imageWidth, imageHeight);
      let avatarDataUrl = null;
      let avatarPlacementPct = null;
      let avatarPresent = Boolean(msg.avatarPresent && avatarBox);
      let avatarShape = msg.avatarShape === 'circle' ? 'circle' : (msg.avatarShape === 'rounded' ? 'rounded' : null);

      if (avatarPresent && avatarBox) {
        avatarPlacementPct = computeAvatarPlacementPct(avatarBox, imageWidth, imageHeight);
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
          avatarShape = null;
          avatarPlacementPct = null;
        }
      }

      validated.push({
        text: String(msg.text || msg.quoteText || ''),
        quoteText: String(msg.quoteText || msg.text || ''),
        side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
        order: msg.order || (i + 1),
        authorName: msg.authorName ? String(msg.authorName) : '',
        authorRole: msg.authorRole ? String(msg.authorRole) : '',
        avatarPresent,
        avatarShape,
        avatarBox: avatarPresent ? avatarBox : null,
        avatarPlacementPct: avatarPresent ? avatarPlacementPct : null,
        avatarDataUrl
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
