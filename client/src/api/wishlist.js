import { request } from './client.js';

export const getWishlist = () => request('/api/wishlist');

export const addToWishlist = (itemId) =>
    request(`/api/wishlist/${encodeURIComponent(itemId)}`, { method: 'POST' });

export const removeFromWishlist = (itemId) =>
    request(`/api/wishlist/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
