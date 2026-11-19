import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { AppDeps } from '../../app';
import { AppError, badRequest } from '../../lib/errors';
import { sniffImage } from '../../lib/sniff-image';
import type { UploadResult } from '../../shared';

export { sniffImage };

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
