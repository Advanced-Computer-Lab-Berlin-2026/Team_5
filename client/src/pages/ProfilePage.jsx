import { useState } from 'react';
import { updateProfile } from '../api/profile.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { Button, Card, FormField, Message, Row } from '../components';

export default function ProfilePage() {
    const { user } = useAuth();
    const { pending, error, success, run } = useAction();
    const [phoneNumber, setPhoneNumber] = useState('');
    const [homeAddress, setHomeAddress] = useState('');

    async function handleSubmit(event) {
        event.preventDefault();
        // The server needs at least one field, and an empty box means "leave this alone".
        const fields = {};
        if (phoneNumber) fields.phoneNumber = phoneNumber;
        if (homeAddress) fields.homeAddress = homeAddress;
        await run(() => updateProfile(fields), 'Profile updated.');
    }

    return (
        <>
            <h1>Profile</h1>
            <Card title={user.name}>
                <p>Username: {user.username}</p>
                <p>Email: {user.email}</p>
            </Card>
            <Card title="Update contact details">
                <form onSubmit={handleSubmit}>
                    <FormField label="Phone" name="phoneNumber" value={phoneNumber}
                        hint="International format, e.g. +491701234567. Leave blank to keep the current one."
                        onChange={(event) => setPhoneNumber(event.target.value)} />
                    <FormField label="Home address" name="homeAddress" value={homeAddress}
                        hint="Leave blank to keep the current one."
                        onChange={(event) => setHomeAddress(event.target.value)} />
                    <Message type="success">{success}</Message>
                    <Message type="error">{error}</Message>
                    <Row>
                        <Button type="submit" disabled={pending || (!phoneNumber && !homeAddress)}>Save</Button>
                        <Button variant="secondary" to="/change-password">Change password</Button>
                    </Row>
                </form>
            </Card>
        </>
    );
}
