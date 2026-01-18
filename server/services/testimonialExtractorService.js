import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISION_PROMPT = `Analyze this chat screenshot. Extract every message bubble you see.

Return ONLY a valid JSON array, nothing else before or after:

[
  {
    "text": "exact message text including emojis",
    "side": "left",
    "order": 1
  }
]

RULES:
- "text": Copy the EXACT text, preserve emojis, punctuation, spelling
- "side": "left" if bubble is on left side of screen, "right" if on right side
- "order": Number messages from top to bottom starting at 1
- Include ALL messages visible in the screenshot
- If you see multiple screenshots, extract from all of them`;

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
      validated.push({
        text: String(msg.text || ''),
        side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
        order: msg.order || (i + 1)
      });
    }

    // Sort by order
    validated.sort((a, b) => a.order - b.order);

    return validated;

  } catch (error) {
    console.error('Extraction error:', error);
    return [];
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
