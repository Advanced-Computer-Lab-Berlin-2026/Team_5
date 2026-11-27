import { request } from './client.js';

// { referralCode, referralLink, referredBy, referrals: [{ referred, status: 'sent' | 'converted', creditsIssued, createdAt }] }
export const getMyReferrals = () => request('/api/referrals/me');

// once per account: the code of the person who invited you. The credit is paid when you finish your first borrow
export const applyReferralCode = (referralCode) => request('/api/referrals/apply', { method: 'POST', body: { referralCode } });
