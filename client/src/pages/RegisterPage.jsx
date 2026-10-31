import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../api/auth.js';
import { useAction } from '../hooks/useAction.js';
import { Button, Card, FormField, Message } from '../components';

const EMPTY_FORM = { username: '', name: '', email: '', password: '', phoneNumber: '', homeAddress: '' };

export default function RegisterPage() {
    const navigate = useNavigate();
    const { pending, error, run } = useAction();
    const [form, setForm] = useState(EMPTY_FORM);

    const bind = (field) => ({
        name: field,
        value: form[field],
        onChange: (event) => setForm({ ...form, [field]: event.target.value })
    });

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await run(() => register(form));
        if (ok) navigate('/login', { state: { notice: 'Registration successful. Please log in.' } });
    }

    return (
        <Card title="Register">
            <form onSubmit={handleSubmit}>
                <FormField label="Username" hint="4 to 20 characters" required {...bind('username')} />
                <FormField label="Name" hint="2 to 20 characters" required {...bind('name')} />
                <FormField label="Email" type="email" required {...bind('email')} />
                <FormField label="Password" type="password" hint="6 to 40 characters" required {...bind('password')} />
                <FormField label="Phone (optional)" hint="International format, e.g. +491701234567" {...bind('phoneNumber')} />
                <FormField label="Home address (optional)" {...bind('homeAddress')} />
                <Message type="error">{error}</Message>
                <Button type="submit" disabled={pending}>{pending ? 'Registering...' : 'Register'}</Button>
            </form>
            <p>Already registered? <Link to="/login">Log in</Link></p>
        </Card>
    );
}
