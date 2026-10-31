import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from './Button.jsx';
import styles from './Nav.module.css';

function NavItem({ to, children }) {
    return (
        <NavLink to={to} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
            {children}
        </NavLink>
    );
}

export function Nav() {
    const { isLoggedIn, isAdmin, user, logout } = useAuth();
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    return (
        <header className={styles.nav}>
            <NavItem to="/">ACL</NavItem>
            <NavItem to="/items">Catalog</NavItem>
            {isLoggedIn && (
                <>
                    <NavItem to="/wishlist">Wishlist</NavItem>
                    <NavItem to="/wallet">Wallet</NavItem>
                    <NavItem to="/household">Household</NavItem>
                    <NavItem to="/profile">Profile</NavItem>
                </>
            )}
            {isAdmin && <NavItem to="/admin">Admin</NavItem>}
            <span className={styles.spacer} />
            {isLoggedIn ? (
                <>
                    <span>{user.username}</span>
                    <Button variant="secondary" onClick={handleLogout}>
                        Log out
                    </Button>
                </>
            ) : (
                <>
                    <NavItem to="/login">Log in</NavItem>
                    <NavItem to="/register">Register</NavItem>
                </>
            )}
        </header>
    );
}
