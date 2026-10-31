import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from './Button.jsx';
import styles from './Nav.module.css';

// Which links each role sees, after the always-visible ones.
const LINKS_BY_ROLE = {
    member: [['/wishlist', 'Wishlist'], ['/wallet', 'Wallet'], ['/household', 'Household'], ['/notices', 'Notices'], ['/become-lender', 'Become a lender'], ['/profile', 'Profile']],
    lender: [['/lender/items', 'My items'], ['/wishlist', 'Wishlist'], ['/wallet', 'Wallet'], ['/household', 'Household'], ['/notices', 'Notices'], ['/profile', 'Profile']],
    admin: [['/admin', 'Admin'], ['/notices', 'Notices']]
};

function NavItem({ to, children }) {
    return (
        <NavLink to={to} end={to === '/'} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
            {children}
        </NavLink>
    );
}

export function Nav() {
    const { isLoggedIn, role, user, logout } = useAuth();
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    return (
        <header className={styles.nav}>
            <NavItem to="/">ACL</NavItem>
            <NavItem to="/items">Catalog</NavItem>
            {isLoggedIn && (LINKS_BY_ROLE[role] ?? []).map(([to, label]) => (
                <NavItem key={to} to={to}>{label}</NavItem>
            ))}
            <span className={styles.spacer} />
            {isLoggedIn ? (
                <>
                    <span>{user.username} ({role})</span>
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
