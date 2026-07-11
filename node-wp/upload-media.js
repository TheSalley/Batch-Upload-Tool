import FormData from 'form-data';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import axios from 'axios';
import cfg from './config.js';
import { getBaseHeaders } from './wp-auth.js';

function getMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };
  return map[ext] || 'image/jpeg';
}

export async function uploadMedia(filePath) {
  await fs.ensureDir(cfg.local.tempDir);
  const originalName = path.basename(filePath);
  const tempFile = path.join(cfg.local.tempDir, originalName);

  await sharp(filePath)
    .resize({ width: cfg.image.maxWidth, withoutEnlargement: true })
    .toFile(tempFile);

  const buffer = await fs.readFile(tempFile);
  const form = new FormData();
  form.append('file', buffer, {
    filename: originalName,
    contentType: getMime(originalName)
  });

  const headers = {
    ...getBaseHeaders(),
    ...form.getHeaders(),
    'Content-Disposition': `form-data; name="file"; filename="${encodeURIComponent(originalName)}"`
  };

  const resp = await axios.post(
    `${cfg.wp.url}${cfg.wp.apiPrefix}/media`,
    form,
    { headers }
  );

  await fs.remove(tempFile);
  return resp.data.id;
}
