import multer from 'multer';
import path from 'node:path';

export const MAX_PHOTOS = 5; // per item, and per request
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB each
const ALLOWED_TYPES = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png']
};

function fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ALLOWED_TYPES[file.mimetype];

    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
        const error = new Error('Only JPEG, JPG and PNG photos are allowed');
        error.status = 400;
        return cb(error);
    }
    cb(null, true);
}

// Reads up to MAX_PHOTOS files from the form field "photos" into memory
export const uploadItemPhotos = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_PHOTOS }
}).array('photos', MAX_PHOTOS);

export function handleItemPhotoUploadErrors(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Each photo must be 5 MB or smaller' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ message: `Unexpected file field, expected "photos"` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ message: `You can upload at most ${MAX_PHOTOS} photos at once, in the field "photos"` });
        }
        return res.status(400).json({ message: err.message });
    }
    if (err.status === 400) return res.status(400).json({ message: err.message });
    next(err);
}