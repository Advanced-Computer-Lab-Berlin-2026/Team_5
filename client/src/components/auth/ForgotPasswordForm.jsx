import { useState } from 'react';
import { forgetPassword, resetPassword, verifyResetOtp } from '../../api/auth.js';
import { useAction } from '../../hooks/useAction.js';
import { Button } from '../Button.jsx';
import { FormField } from '../FormField.jsx';
import { Message } from '../Message.jsx';
import styles from './ForgotPasswordForm.module.css';

// Three steps, all on the login card: ask for the email, check the 6 digit code, then set a new password.
// onDone(notice) runs once the password has been reset.
export function ForgotPasswordForm({ onDone }) {
    const { pending, error, success, run } = useAction();
    const [step, setStep] = useState('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [resetToken, setResetToken] = useState('');
    const [newPassword, setNewPassword] = useState('');

    async function handleEmail(event) {
        event.preventDefault();
        const ok = await run(() => forgetPassword(email), 'If the account exists, a code was sent to that email.');
        if (ok) setStep('otp');
    }

    async function handleOtp(event) {
        event.preventDefault();
        const result = await run(() => verifyResetOtp(email, otp));
        if (result) { setResetToken(result.resetToken); setStep('reset'); }
    }

    async function handleReset(event) {
        event.preventDefault();
        const ok = await run(() => resetPassword(resetToken, newPassword));
        if (ok) onDone('Password reset. Please log in.');
    }

    return <div key={step} className={styles.step}>
        <Message type="success">{success}</Message>
        <Message type="error">{error}</Message>
        {step === 'email' && (
            <form onSubmit={handleEmail} aria-label="Reset password">
                <FormField label="Email" name="reset-email" type="email" value={email} required autoComplete="email" onChange={e => setEmail(e.target.value)} />
                <Button type="submit" pending={pending} fullWidth>Send code</Button>
            </form>
        )}
        {step === 'otp' && (
            <form onSubmit={handleOtp} aria-label="Enter the code">
                <FormField label="6 digit code" name="reset-otp" value={otp} inputMode="numeric" maxLength={6} required onChange={e => setOtp(e.target.value)} />
                <Button type="submit" pending={pending} fullWidth>Verify code</Button>
            </form>
        )}
        {step === 'reset' && (
            <form onSubmit={handleReset} aria-label="Choose a new password">
                <FormField label="New password" name="reset-password" type="password" value={newPassword} required autoComplete="new-password"
                    placeholder="6 to 40 characters" onChange={e => setNewPassword(e.target.value)} />
                <Button type="submit" pending={pending} fullWidth>Reset password</Button>
            </form>
        )}
    </div>;
}
