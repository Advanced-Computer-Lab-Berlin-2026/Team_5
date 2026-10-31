import { v2 as cloudinary } from 'cloudinary';
import '../config/cloudinary.js'

const PHOTO_OPTIONS = { folder: 'item-photos', type: 'upload', resource_type: 'image'};

export function uploadItemPhoto(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(PHOTO_OPTIONS, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        stream.end(buffer);
    });
}

export function deleteItemPhoto(publicId) {
    return cloudinary.uploader.destroy(publicId, { type: PHOTO_OPTIONS.type, resource_type: PHOTO_OPTIONS.resource_type });
}