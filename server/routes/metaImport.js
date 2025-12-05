import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  parseXlsFile,
  importXlsData,
  getImports,
  getImportById,
  deleteImport,
  previewXlsFile
} from '../services/xlsImportService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `meta-import-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xls', '.xlsx', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xls, .xlsx, and .csv files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Get all imports for a store
router.get('/', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const imports = getImports(store);
    res.json(imports);
  } catch (error) {
    console.error('Get imports error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single import details
router.get('/:id', (req, res) => {
  try {
    const importRecord = getImportById(req.params.id);
    if (!importRecord) {
      return res.status(404).json({ error: 'Import not found' });
    }
    res.json(importRecord);
  } catch (error) {
    console.error('Get import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Preview file before importing
router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const preview = await previewXlsFile(req.file.path);

    // Clean up preview file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting preview file:', err);
    });

    res.json({
      originalFilename: req.file.originalname,
      ...preview
    });
  } catch (error) {
    // Clean up file on error
    if (req.file) {
      fs.unlink(req.file.path, () => { });
    }
    console.error('Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload and import XLS file
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const store = req.query.store || req.body.store || 'vironax';
    const notes = req.body.notes || '';

    // Parse the file
    const parsedData = await parseXlsFile(req.file.path);

    // Import the data
    const result = await importXlsData(store, parsedData, req.file.originalname, notes);

    // Clean up uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting uploaded file:', err);
    });

    res.json({
      success: true,
      message: `Successfully imported ${result.recordCount} records`,
      ...result
    });
  } catch (error) {
    // Clean up file on error
    if (req.file) {
      fs.unlink(req.file.path, () => { });
    }
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete an import and all associated data
router.delete('/:id', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const result = deleteImport(req.params.id, store);
    res.json(result);
  } catch (error) {
    console.error('Delete import error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
