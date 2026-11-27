import { request } from './client.js';

export const getWalletBalance = () => request('/api/wallet');

// members: late fees charged for returning items late. { fees: [{ reservation, amount, status, date, createdAt }] }
export const getLateFees = () => request('/api/wallet/late-fees');
