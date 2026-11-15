import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { register } from '../../api/auth.js';
import { useAction } from '../../hooks/useAction.js';
import { Button } from '../Button.jsx';
import { FormField } from '../FormField.jsx';
import { Message } from '../Message.jsx';
import styles from './RegisterForm.module.css';

const EMPTY_FORM = { username: '', name: '', email: '', password: '', phoneNumber: '', homeAddress: '' };

export function RegisterForm() {
    const navigate = useNavigate();
    const location = useLocation();
    const action = useAction();
    const [form, setForm] = useState(EMPTY_FORM);
    const bind = field => ({ name: `register-${field}`, value: form[field], onChange: event => setForm({ ...form, [field]: event.target.value }) });

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await action.run(() => register(form));
        if (ok) {
            setForm(EMPTY_FORM);
            navigate(`/login${location.search}`, { replace: true, state: { notice: 'Registration successful. Please log in.', from: location.state?.from } });
        }
    }

    return <form onSubmit={handleSubmit} aria-label="Register">
        <fieldset className={styles.fields} disabled={action.pending}>
            <FormField label="Username" hint="4 to 20 characters" autoComplete="username" minLength={4} maxLength={20} required {...bind('username')} />
            <FormField label="Full name" autoComplete="name" minLength={2} maxLength={20} required {...bind('name')} />
            <FormField label="Email" type="email" autoComplete="email" required {...bind('email')} />
            <FormField label="Password" type="password" autoComplete="new-password" minLength={6} maxLength={40} hint="6 to 40 characters with uppercase, lowercase, and a number" required {...bind('password')} />
            <FormField label="Phone (optional)" type="tel" autoComplete="tel" hint="International format, e.g. +491701234567" {...bind('phoneNumber')} />
            <FormField label="Home address (optional)" autoComplete="street-address" {...bind('homeAddress')} />
        </fieldset>
        <Message type="error">{action.error}</Message>
        <Button type="submit" pending={action.pending} fullWidth>{action.pending ? 'Creating account…' : 'Create account'}</Button>
    </form>;
}
