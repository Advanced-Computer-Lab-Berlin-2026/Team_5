import { request } from './client.js';

export const listCategories = () => request('/api/categories');
