import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { AppDeps } from '../../app';
import { AppError, badRequest } from '../../lib/errors';
import type { UploadResult } from '../../shared';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Detected = { ext: 'jpg' | 'png' | 'webp'; contentType: string };

/** Identifies the image by its first bytes; the client-sent type is never trusted. */
export function sniffImage(b: Buffer): Detected | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6, fieldSize: 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new AppError(415, 'unsupported_media_type'));
  },
}).single('file');

export function createAdminUploadsRouter({ storage }: AppDeps): Router {
  const r = Router();

  r.post(
    '/uploads',
    (req, res, next) => {
      upload(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
          next(
            err.code === 'LIMIT_FILE_SIZE'
              ? new AppError(413, 'file_too_large')
              : badRequest('upload_failed'),
          );
          return;
        }
        next(err);
      });
    },
    async (req, res) => {
      if (!req.file) throw badRequest('file_required');
      const kind = sniffImage(req.file.buffer);
      if (!kind) throw new AppError(415, 'unsupported_media_type');
      const url = await storage.put(
        `media/${randomUUID()}.${kind.ext}`,
        req.file.buffer,
        kind.contentType,
      );
      const body: UploadResult = { url };
      res.status(201).json(body);
    },
  );

  return r;
}
