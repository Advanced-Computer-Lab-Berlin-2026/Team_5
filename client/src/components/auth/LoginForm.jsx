import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useAction } from '../../hooks/useAction.js';
import { getLoginDestination, isDarkPage } from '../../theme/routes.js';
import { Button } from '../Button.jsx';
import { FormField } from '../FormField.jsx';
import { Message } from '../Message.jsx';
import { playExplosion } from '../scroll/StickerField.jsx';
import { holdRedirect } from '../scroll/transition.js';
import styles from './LoginForm.module.css';

// onForgot() swaps the card over to the reset-password view
export function LoginForm({ onForgot }) {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const action = useAction();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    async function handleSubmit(event) {
        event.preventDefault();
        holdRedirect(true); // keep this page on screen while the explosion plays
        const user = await action.run(() => login(username, password));
        if (!user) { holdRedirect(false); return; }
        const destination = getLoginDestination(location.state?.from, user.role);
        await playExplosion({ dark: isDarkPage(user.role, destination) });
        holdRedirect(false);
        navigate(destination, { replace: true });
    }

    return <form onSubmit={handleSubmit} aria-label="Log in">
        <Message type="success">{location.state?.notice}</Message>
        <fieldset disabled={action.pending}>
            <FormField label="Username" name="login-username" value={username} autoComplete="username" required onChange={e => setUsername(e.target.value)} />
            <FormField label="Password" name="login-password" type="password" value={password} autoComplete="current-password" required onChange={e => setPassword(e.target.value)} />
        </fieldset>
        <p><button type="button" className={styles.linkButton} onClick={onForgot}>Forgot password?</button></p>
        <Message type="error">{action.error}</Message>
        <Button type="submit" pending={action.pending} fullWidth>{action.pending ? 'Logging in…' : 'Log in'} </Button>
    </form>;
}
