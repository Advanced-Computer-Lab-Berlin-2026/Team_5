import { uploadItemPhoto, deleteItemPhoto } from './itemPhotoStorage.js';

export const deletePhotos = (files) => Promise.allSettled(files.map((file) => deleteItemPhoto(file.public_id)));

// Uploads all files. If one fails, removes the ones that did upload and throws.
export async function uploadPhotos(files) {
    const results = await Promise.allSettled(files.map((file) => uploadItemPhoto(file.buffer)));
    const uploaded = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
        await deletePhotos(uploaded);
        throw failed.reason;
    }
    return uploaded;
}
