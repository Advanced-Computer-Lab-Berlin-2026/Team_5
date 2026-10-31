import { request } from './client.js';

export const getWalletBalance = () => request('/api/wallet');
