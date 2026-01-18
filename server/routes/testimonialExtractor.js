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
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No screenshots uploaded' });
    }

    const imagePaths = req.files.map(file => file.path);
    console.log('Extracting from images:', imagePaths);

    const messages = await extractFromMultipleImages(imagePaths);

    // Clean up uploaded files (async)
    Promise.all(imagePaths.map(filePath => fs.promises.unlink(filePath)))
      .catch(err => console.error('Error deleting uploaded files:', err));

    if (messages.length === 0) {
      return res.status(400).json({
        error: 'Could not extract any messages. Please try a clearer screenshot.'
      });
    }

    res.json({ messages });

  } catch (error) {
    console.error('Extract error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract messages' });
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
      logoUrl,
      logoPosition
    } = req.body;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    // Validate messages structure
    const validatedMessages = messages.map((msg, index) => ({
      text: String(msg.text || ''),
      side: (msg.side === 'left' || msg.side === 'right') ? msg.side : 'left',
      order: msg.order || (index + 1)
    }));

    // Create output directory
    const outputDir = 'uploads/testimonials/output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFilename = `testimonial-${Date.now()}.png`;
    const outputPath = path.join(outputDir, outputFilename);

    // Build options object
    const options = {
      preset,
      layout,
      collageColumns: parseInt(collageColumns) || 2
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
