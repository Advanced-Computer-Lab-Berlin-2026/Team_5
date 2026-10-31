import { v2 as cloudinary } from 'cloudinary';
import '../config/cloudinary.js';

const MANUAL_OPTIONS = { folder: 'item-manuals', type: 'authenticated', resource_type: 'image', overwrite: true, invalidate: true };

export function manualPublicId(itemId) {
    return `${MANUAL_OPTIONS.folder}/${itemId}`;
}

export function uploadItemManual(buffer, itemId) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ ...MANUAL_OPTIONS, public_id: itemId }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        stream.end(buffer);
    });
}

export function deleteItemManual(itemId) {
    return cloudinary.uploader.destroy(manualPublicId(itemId), { type: MANUAL_OPTIONS.type, resource_type: MANUAL_OPTIONS.resource_type, invalidate: true });
}