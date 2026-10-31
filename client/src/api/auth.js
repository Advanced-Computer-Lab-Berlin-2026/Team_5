import { request } from './client.js';

export const login = (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password } });

export const register = (fields) =>
    request('/api/auth/register', { method: 'POST', body: fields });

export const logout = () => request('/api/auth/logout', { method: 'POST' });

export const forgetPassword = (email) =>
    request('/api/auth/forget-password', { method: 'POST', body: { email } });

export const verifyResetOtp = (email, otp) =>
    request('/api/auth/verify-reset-otp', { method: 'POST', body: { email, otp } });

export const resetPassword = (resetToken, newPassword) =>
    request('/api/auth/reset-password', { method: 'POST', body: { resetToken, newPassword } });

export const changePassword = (currentPassword, newPassword) =>
    request('/api/auth/change-password', { method: 'PATCH', body: { currentPassword, newPassword } });
