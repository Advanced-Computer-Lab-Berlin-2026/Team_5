import { useState } from 'react';
import { changePassword } from '../api/auth.js';
import { useAction } from '../hooks/useAction.js';
import { Button, Card, FormField, Message } from '../components';

export default function ChangePasswordPage() {
    const { pending, error, success, run } = useAction();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await run(() => changePassword(currentPassword, newPassword), 'Password changed.');
        if (ok) {
            setCurrentPassword('');
            setNewPassword('');
        }
    }

    return (
        <Card title="Change password">
            <form onSubmit={handleSubmit}>
                <FormField label="Current password" name="currentPassword" type="password" value={currentPassword} required
                    onChange={(event) => setCurrentPassword(event.target.value)} />
                <FormField label="New password" name="newPassword" type="password" value={newPassword} required
                    hint="6 to 40 characters with an uppercase letter, a lowercase letter and a number"
                    onChange={(event) => setNewPassword(event.target.value)} />
                <Message type="success">{success}</Message>
                <Message type="error">{error}</Message>
                <Button type="submit" disabled={pending}>Change password</Button>
            </form>
        </Card>
    );
}
