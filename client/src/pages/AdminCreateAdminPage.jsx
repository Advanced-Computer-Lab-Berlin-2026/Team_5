import { useState } from 'react';
import { createAdmin } from '../api/admin.js';
import { useAction } from '../hooks/useAction.js';
import { Button, Card, FormField, Message } from '../components';

const EMPTY_FORM = { username: '', email: '', password: '' };

export default function AdminCreateAdminPage() {
    const { pending, error, success, run } = useAction();
    const [form, setForm] = useState(EMPTY_FORM);

    const bind = (field) => ({
        name: field,
        value: form[field],
        onChange: (event) => setForm({ ...form, [field]: event.target.value })
    });

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await run(() => createAdmin(form), 'Admin created.');
        if (ok) setForm(EMPTY_FORM);
    }

    return (
        <Card title="Create an admin">
            <form onSubmit={handleSubmit}>
                <FormField label="Username" hint="4 to 20 characters" required {...bind('username')} />
                <FormField label="Email" type="email" required {...bind('email')} />
                <FormField label="Password" type="password" hint="6 to 40 characters" required {...bind('password')} />
                <Message type="success">{success}</Message>
                <Message type="error">{error}</Message>
                <Button type="submit" disabled={pending}>Create admin</Button>
            </form>
        </Card>
    );
}
