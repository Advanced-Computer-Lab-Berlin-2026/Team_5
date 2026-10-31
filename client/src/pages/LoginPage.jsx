import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { Button, Card, FormField, Message } from '../components';

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { pending, error, run } = useAction();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await run(() => login(username, password));
        if (ok) navigate(location.state?.from ?? '/items', { replace: true });
    }

    return (
        <Card title="Log in">
            <form onSubmit={handleSubmit}>
                <Message type="success">{location.state?.notice}</Message>
                <FormField label="Username" name="username" value={username} autoComplete="username" required
                    onChange={(event) => setUsername(event.target.value)} />
                <FormField label="Password" name="password" type="password" value={password} autoComplete="current-password" required
                    onChange={(event) => setPassword(event.target.value)} />
                <Message type="error">{error}</Message>
                <Button type="submit" disabled={pending}>{pending ? 'Logging in...' : 'Log in'}</Button>
            </form>
            <p><Link to="/forgot-password">Forgot password?</Link></p>
            <p>No account? <Link to="/register">Register</Link></p>
        </Card>
    );
}
