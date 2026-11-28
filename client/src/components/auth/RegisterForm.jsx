import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { register } from '../../api/auth.js';
import { applyReferralCode } from '../../api/referrals.js';
import { useAction } from '../../hooks/useAction.js';
import { Button } from '../Button.jsx';
import { FormField } from '../FormField.jsx';
import { Message } from '../Message.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { getLoginDestination, isDarkPage } from '../../theme/routes.js';
import { playExplosion } from '../scroll/StickerField.jsx';
import { holdRedirect } from '../scroll/transition.js';
import styles from './RegisterForm.module.css';

const EMPTY_FORM = { username: '', name: '', email: '', password: '', phoneNumber: '', homeAddress: '' };

export function RegisterForm() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const location = useLocation();
    const action = useAction();
    const [form, setForm] = useState(EMPTY_FORM);
    const bind = field => ({ name: `register-${field}`, value: form[field], onChange: event => setForm({ ...form, [field]: event.target.value }) });

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await action.run(() => register(form));
        if (!ok) return;
        // sign the new member straight in, then explode into their catalog
        holdRedirect(true);
        try {
            const user = await login(form.username, form.password);
            setForm(EMPTY_FORM);
            const referral = new URLSearchParams(location.search).get('ref');
        let destination = getLoginDestination(location.state?.from, user.role);
        if (referral && ['member', 'lender'].includes(user.role)) {
            try { await applyReferralCode(referral); }
            catch { destination = '/profile?ref=' + encodeURIComponent(referral); }
        }
            await playExplosion({ dark: isDarkPage(user.role, destination) });
                holdRedirect(false);
                navigate(destination, { replace: true });
        } catch {
            // signing in failed, so fall back to asking them to log in themselves
            holdRedirect(false);
            setForm(EMPTY_FORM);
            navigate(`/login${location.search}`, { replace: true, state: { notice: 'Registration successful. Please log in.', from: location.state?.from } });
        }
    }

    return <form onSubmit={handleSubmit} aria-label="Register">
        <fieldset className={styles.fields} disabled={action.pending}>
            <FormField label="Username *" placeholder="4 to 20 characters" autoComplete="username" minLength={4} maxLength={20} required {...bind('username')} />
            <FormField label="Full name *" autoComplete="name" minLength={2} maxLength={20} required {...bind('name')} />
            <FormField label="Email *" type="email" autoComplete="email" required {...bind('email')} />
            <FormField label="Password *" type="password" placeholder="6 to 40 chars, Aa1" autoComplete="new-password" minLength={6} maxLength={40} required {...bind('password')} />
            <FormField label="Phone *" type="tel" placeholder="+491701234567" autoComplete="tel" required {...bind('phoneNumber')} />
            <FormField label="Home address *" autoComplete="street-address" required maxLength={500} {...bind('homeAddress')} />
        </fieldset>
        <Message type="error">{action.error}</Message>
        <Button type="submit" pending={action.pending} fullWidth>{action.pending ? 'Creating account…' : 'Create account'}</Button>
    </form>;
}
