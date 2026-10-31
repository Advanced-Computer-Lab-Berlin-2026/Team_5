import multer from 'multer';
import path from 'node:path';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png']
};

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ALLOWED_TYPES[file.mimetype];

    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
        const error = new Error('Only PDF, JPEG, JPG and PNG files are allowed');
        error.status = 400;
        return cb(error);
    }
    cb(null, true);
}

export const uploadLenderDocument = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE, files: 1 }
}).single('file');

export function handleUploadErrors(err, req, res, next) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File is too large (max 5 MB)' });
    }
    if (err instanceof multer.MulterError || err.status === 400) {
        return res.status(400).json({ message: err.message });
    }
    next(err);
}
