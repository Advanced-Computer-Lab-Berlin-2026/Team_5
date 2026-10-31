import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgetPassword, resetPassword, verifyResetOtp } from '../api/auth.js';
import { useAction } from '../hooks/useAction.js';
import { Button, Card, FormField, Message } from '../components';

// Three steps: ask for the email, check the 6 digit code, then set a new password.
export default function ForgotPasswordPage() {
    const navigate = useNavigate();
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
        if (result) {
            setResetToken(result.resetToken);
            setStep('reset');
        }
    }

    async function handleReset(event) {
        event.preventDefault();
        const ok = await run(() => resetPassword(resetToken, newPassword));
        if (ok) navigate('/login', { state: { notice: 'Password reset. Please log in.' } });
    }

    return (
        <Card title="Reset password">
            <Message type="success">{success}</Message>
            <Message type="error">{error}</Message>
            {step === 'email' && (
                <form onSubmit={handleEmail}>
                    <FormField label="Email" name="email" type="email" value={email} required
                        onChange={(event) => setEmail(event.target.value)} />
                    <Button type="submit" disabled={pending}>Send code</Button>
                </form>
            )}
            {step === 'otp' && (
                <form onSubmit={handleOtp}>
                    <FormField label="6 digit code" name="otp" value={otp} inputMode="numeric" maxLength={6} required
                        onChange={(event) => setOtp(event.target.value)} />
                    <Button type="submit" disabled={pending}>Verify code</Button>
                </form>
            )}
            {step === 'reset' && (
                <form onSubmit={handleReset}>
                    <FormField label="New password" name="newPassword" type="password" value={newPassword} required
                        hint="6 to 40 characters" onChange={(event) => setNewPassword(event.target.value)} />
                    <Button type="submit" disabled={pending}>Reset password</Button>
                </form>
            )}
            <p><Link to="/login">Back to log in</Link></p>
        </Card>
    );
}
