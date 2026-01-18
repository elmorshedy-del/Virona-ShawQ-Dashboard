import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { extractFromMultipleImages } from '../services/testimonialExtractorService.js';
import { renderTestimonials, getPresets } from '../services/testimonialRendererService.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/testimonials';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

/**
 * POST /api/testimonials/extract
 * Extract messages from uploaded screenshots
 */
router.post('/extract', upload.array('screenshots', 10), async (req, res) => {
  const imagePaths = [];
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No screenshots uploaded' });
    }

    req.files.forEach(file => imagePaths.push(file.path));
    console.log('Extracting from images:', imagePaths);

    const messages = await extractFromMultipleImages(imagePaths);

    if (messages.length === 0) {
      return res.status(400).json({
        error: 'Could not extract any messages. Please try a clearer screenshot.'
      });
    }

    res.json({ messages });

  } catch (error) {
    console.error('Extract error:', error);
    if (error.code === 'INSUFFICIENT_FUNDS') {
      return res.status(402).json({
        error: 'Insufficient funds to analyze the screenshot. Please top up and try again.',
        errorCode: 'INSUFFICIENT_FUNDS'
      });
    }
    res.status(500).json({ error: error.message || 'Failed to extract messages' });
  } finally {
    imagePaths.forEach(filePath => {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    });
  }
});

/**
 * POST /api/testimonials/generate
 * Generate testimonial image from messages
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      messages,
      preset = 'raw_bubbles',
      layout = 'stacked',
      collageColumns = 2,
      outputShape,
      borderRadius,
      backgroundType,
      backgroundColor,
      gradientColors,
      bubbleStyle,
      bubbleColor,
      textColor,
      fontSize,
      typographyPreset,
      quoteTreatment,
      weightOption,
      cardPadding,
      lineSpacing,
      maxWidth,
      logoUrl,
      logoPosition
    } = req.body;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    // Validate messages structure
    const validatedMessages = messages.map((msg, index) => ({
      text: String(msg.text || ''),
      quoteText: String(msg.quoteText || msg.text || ''),
      side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
      order: msg.order || (index + 1),
      authorName: msg.authorName ? String(msg.authorName) : '',
      authorRole: msg.authorRole ? String(msg.authorRole) : '',
      avatarPresent: Boolean(msg.avatarPresent || msg.avatarDataUrl),
      avatarShape: msg.avatarShape === 'circle' ? 'circle' : (msg.avatarShape === 'rounded' ? 'rounded' : null),
      avatarBox: msg.avatarBox || null,
      avatarPlacementPct: msg.avatarPlacementPct || null,
      avatarDataUrl: msg.avatarDataUrl || null
    }));

    // Create output directory
    const outputDir = 'uploads/testimonials/output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFilename = `testimonial-${Date.now()}.png`;
    const outputPath = path.join(outputDir, outputFilename);

    // Build options object
    const resolvedCollageColumns = Math.min(4, Math.max(2, parseInt(collageColumns, 10) || 2));
    const options = {
      preset,
      layout,
      collageColumns: resolvedCollageColumns
    };

    // Add custom options if provided
    if (outputShape) options.outputShape = outputShape;
    if (borderRadius !== undefined) options.borderRadius = parseInt(borderRadius);
    if (backgroundType) options.backgroundType = backgroundType;
    if (backgroundColor) options.backgroundColor = backgroundColor;
    if (gradientColors) options.gradientColors = gradientColors;
    if (bubbleStyle) options.bubbleStyle = bubbleStyle;
    if (bubbleColor) options.bubbleColor = bubbleColor;
    if (textColor) options.textColor = textColor;
    if (fontSize) options.fontSize = parseInt(fontSize);
    if (typographyPreset) options.typographyPreset = typographyPreset;
    if (quoteTreatment) options.quoteTreatment = quoteTreatment;
    if (weightOption) options.weightOption = weightOption;
    if (cardPadding) options.cardPadding = cardPadding;
    if (lineSpacing) options.lineSpacing = lineSpacing;
    if (maxWidth) options.maxWidth = maxWidth;
    if (logoUrl) options.logoUrl = logoUrl;
    if (logoPosition) options.logoPosition = logoPosition;

    console.log('Rendering with options:', options);

    const resultPath = await renderTestimonials(validatedMessages, outputPath, options);

    // Read the file and send as base64
    const imageBuffer = fs.readFileSync(resultPath);
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64Image}`;

    // Clean up the file after sending
    setTimeout(() => {
      try {
        fs.unlinkSync(resultPath);
      } catch (err) {
        console.error('Error deleting output file:', err);
      }
    }, 5000); // Delete after 5 seconds

    res.json({
      success: true,
      image: dataUrl,
      filename: outputFilename
    });

  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate testimonial' });
  }
});

/**
 * GET /api/testimonials/presets
 * Get available presets
 */
router.get('/presets', (req, res) => {
  try {
    const presets = getPresets();
    res.json({ presets });
  } catch (error) {
    console.error('Presets error:', error);
    res.status(500).json({ error: 'Failed to get presets' });
  }
});

export default router;
