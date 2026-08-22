// server/services/cloudinaryService.js
// Handles video and image processing via Cloudinary

import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import stream from 'stream';

// Configure Cloudinary
const cloudinaryConfig = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
};
const unsignedUploadPreset = process.env.CLOUDINARY_UNSIGNED_UPLOAD_PRESET;

const hasExplicitConfig = Object.values(cloudinaryConfig).every(Boolean);
const hasUnsignedConfig = Boolean(cloudinaryConfig.cloud_name && unsignedUploadPreset);
if (hasExplicitConfig) {
  cloudinary.config({ ...cloudinaryConfig, secure: true });
} else {
  cloudinary.config({ secure: true });
}

function isConfigured() {
  return hasExplicitConfig || hasUnsignedConfig;
}

function withUnsignedPreset(options = {}) {
  if (!hasExplicitConfig && hasUnsignedConfig) {
    return {
      ...options,
      upload_preset: unsignedUploadPreset
    };
  }
  return options;
  return hasExplicitConfig;
}

// ============================================================================
// VIDEO UPLOAD
// ============================================================================
async function uploadVideo(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      withUnsignedPreset({
        resource_type: 'video',
        ...options
      }),
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(uploadStream);
  });
}

// ============================================================================
// IMAGE UPLOAD
// ============================================================================
async function uploadImage(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      withUnsignedPreset({
        resource_type: 'image',
        folder: 'creative-studio/images',
        ...options
      }),
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(uploadStream);
  });
}

// ============================================================================
// EXTRACT FRAMES FROM VIDEO
// ============================================================================
async function extractFrames(publicId, count = 5) {
  const frames = [];
  const duration = await getVideoDuration(publicId);

  for (let i = 0; i < count; i++) {
    const timestamp = Math.round((i / (count - 1)) * duration);

    // Generate frame URL with transformation
    const frameUrl = cloudinary.url(publicId, {
      resource_type: 'video',
      format: 'jpg',
      start_offset: timestamp,
      transformation: [
        { width: 640, crop: 'scale' }
      ]
    });

    try {
      // Fetch and convert to base64
      const response = await axios.get(frameUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      frames.push(Buffer.from(response.data).toString('base64'));
    } catch (error) {
      console.error(`Failed to extract frame at ${timestamp}s:`, error.message);
    }
  }

  return frames;
}

// ============================================================================
// GET VIDEO DURATION
// ============================================================================
async function getVideoDuration(publicId) {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: 'video',
      image_metadata: true
    });
    return result.duration || 10;
  } catch (error) {
    console.error('Failed to get video duration:', error);
    return 10; // Default fallback
  }
}

// ============================================================================
// RESIZE VIDEO TO MULTIPLE DIMENSIONS
// ============================================================================
async function resizeVideo(publicId, options = {}) {
  const { smart_crop = true } = options;

  const dimensions = [
    { name: 'feed_square', ratio: '1:1', width: 1080, height: 1080 },
    { name: 'feed_portrait', ratio: '4:5', width: 1080, height: 1350 },
    { name: 'story_reel', ratio: '9:16', width: 1080, height: 1920 },
    { name: 'landscape', ratio: '16:9', width: 1920, height: 1080 },
    { name: 'fb_link', ratio: '1.91:1', width: 1200, height: 628 }
  ];

  const versions = {};

  for (const dim of dimensions) {
    const transformation = smart_crop
      ? `c_fill,w_${dim.width},h_${dim.height},g_auto`
      : `c_fill,w_${dim.width},h_${dim.height},g_center`;

    const baseUrl = cloudinary.url(publicId, { resource_type: 'video' });
    const url = baseUrl.replace('/upload/', `/upload/${transformation}/`);
    const thumbnail = baseUrl
      .replace('/upload/', `/upload/${transformation},so_0/`)
      .replace(/\.\w+$/, '.jpg');
    const downloadUrl = baseUrl.replace('/upload/', `/upload/${transformation},fl_attachment/`);

    versions[dim.name] = {
      url,
      thumbnail,
      downloadUrl,
      width: dim.width,
      height: dim.height,
      ratio: dim.ratio,
      name: dim.name
    };
  }

  return versions;
}

// ============================================================================
// RESIZE IMAGE TO MULTIPLE DIMENSIONS
// ============================================================================
async function resizeImage(publicId, options = {}) {
  const {
    dimensions = [
      { name: 'feed_square', ratio: '1:1', width: 1080, height: 1080 },
      { name: 'feed_portrait', ratio: '4:5', width: 1080, height: 1350 },
      { name: 'story', ratio: '9:16', width: 1080, height: 1920 },
      { name: 'landscape', ratio: '16:9', width: 1200, height: 675 },
      { name: 'fb_link', ratio: '1.91:1', width: 1200, height: 628 }
    ],
    focal_point = null
  } = options;

  const versions = {};

  for (const dim of dimensions) {
    let transformation = [];

    if (focal_point) {
      transformation = [
        {
          width: dim.width,
          height: dim.height,
          crop: 'fill',
          gravity: 'xy_center',
          x: Math.round(focal_point.x * dim.width),
          y: Math.round(focal_point.y * dim.height)
        }
      ];
    } else {
      transformation = [
        {
          width: dim.width,
          height: dim.height,
          crop: 'fill',
          gravity: 'auto'
        }
      ];
    }

    const url = cloudinary.url(publicId, {
      resource_type: 'image',
      transformation,
      format: 'jpg',
      quality: 'auto:best'
    });

    versions[dim.name] = {
      url,
      width: dim.width,
      height: dim.height,
      ratio: dim.ratio,
      name: dim.name
    };
  }

  return versions;
}

// ============================================================================
// FETCH REMOTE IMAGE AS BASE64
// ============================================================================
async function fetchAsBase64(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    return Buffer.from(response.data).toString('base64');
  } catch (error) {
    console.error('Failed to fetch image:', error.message);
    throw new Error('Failed to fetch remote image');
  }
}

// ============================================================================
// DELETE RESOURCE
// ============================================================================
async function deleteResource(publicId, resourceType = 'image') {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return true;
  } catch (error) {
    console.error('Failed to delete resource:', error);
    return false;
  }
}

// ============================================================================
// GENERATE DOWNLOAD URL
// ============================================================================
function getDownloadUrl(publicId, resourceType = 'video', format = 'mp4') {
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    format,
    flags: 'attachment'
  });
}

export {
  isConfigured,
  uploadVideo,
  uploadImage,
  extractFrames,
  getVideoDuration,
  resizeVideo,
  resizeImage,
  fetchAsBase64,
  deleteResource,
  getDownloadUrl
};
