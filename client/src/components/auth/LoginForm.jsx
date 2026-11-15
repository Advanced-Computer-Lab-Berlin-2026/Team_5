import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useAction } from '../../hooks/useAction.js';
import { getLoginDestination } from '../../theme/routes.js';
import { Button } from '../Button.jsx';
import { FormField } from '../FormField.jsx';
import { Message } from '../Message.jsx';

export function LoginForm() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const action = useAction();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    async function handleSubmit(event) {
        event.preventDefault();
        const user = await action.run(() => login(username, password));
        if (user) navigate(getLoginDestination(location.state?.from, user.role), { replace: true });
    }

    return <form onSubmit={handleSubmit} aria-label="Log in">
        <Message type="success">{location.state?.notice}</Message>
        <fieldset disabled={action.pending}>
            <FormField label="Username" name="login-username" value={username} autoComplete="username" required onChange={e => setUsername(e.target.value)} />
            <FormField label="Password" name="login-password" type="password" value={password} autoComplete="current-password" required onChange={e => setPassword(e.target.value)} />
        </fieldset>
        <p><Link to="/forgot-password">Forgot password?</Link></p>
        <Message type="error">{action.error}</Message>
        <Button type="submit" pending={action.pending} fullWidth>{action.pending ? 'Logging in…' : 'Log in'} </Button>
    </form>;
}
