/*
Documents are uploaded as "authenticated" (private): they can only be opened through a signed link created by the server, not by a public URL.
*/

import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';
import path from 'node:path';


cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret
});

const DOCUMENT_OPTIONS = { folder: 'lender-documents', type: 'authenticated', resource_type: 'image' };
const FORMATS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export function isCloudinaryConfigured() {
    return Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret);
}

export function uploadToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(DOCUMENT_OPTIONS, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        stream.end(buffer);
    });
}

export function deleteFromCloudinary(publicId) {
    return cloudinary.uploader.destroy(publicId, { type: 'authenticated', resource_type: 'image' });
}

// Cloudinary only accepts simple characters in a download name and adds the extension itself.
function downloadName(originalName) {
    const name = path.parse(originalName ?? '').name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    return /[a-zA-Z0-9]/.test(name) ? name : 'document';
}


// A signed link the admin can open (S8). Only the server can create it, because it needs the API secret.
export function getSignedDocumentUrl(document, download = false) {
    const options = { type: 'authenticated', resource_type: 'image', sign_url: true, secure: true, format: FORMATS[document.docType] };
    if (download) options.flags = `attachment:${downloadName(document.originalName)}`;
    return cloudinary.url(document.storedName, options);
}
