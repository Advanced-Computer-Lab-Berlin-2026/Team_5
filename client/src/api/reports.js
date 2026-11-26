import { download, request } from './client.js';

const BASE = '/api/admin/reports';

// filters: { month: 'YYYY-MM' } or { from, to }, plus optional item
export const getUsageReport = (filters = {}) => request(`${BASE}/usage`, { query: filters });
export const exportUsageReport = (format, filters = {}) =>
    download(`${BASE}/usage/export`, { query: { ...filters, format }, filename: `usage-report.${format}` });

export const getDamageReport = (status) => request(`${BASE}/damage`, { query: { status } });
export const exportDamageReport = (format, status) =>
    download(`${BASE}/damage/export`, { query: { status, format }, filename: `damage-report.${format}` });

export const getTierDistribution = () => request(`${BASE}/membership-tiers`);
