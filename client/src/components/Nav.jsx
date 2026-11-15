import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
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
    const location = useLocation();
    const [openPath, setOpenPath] = useState(null);
    const [logoutError, setLogoutError] = useState('');
    const open = openPath === location.pathname;

    async function handleLogout() {
        try { await logout(); } catch { setLogoutError('The server could not confirm logout. Your local session was cleared.'); }
        navigate('/login');
    }

    return (
        <header className={styles.header}>
          <div className={styles.nav}>
            <Link to="/" className={styles.brand} aria-label="ACL home">ACL<span className={styles.brandDot}>.</span></Link>
            <button className={styles.toggle} type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpenPath(open ? null : location.pathname)}><Icon name={open ? 'close' : 'menu'} /></button>
            <nav id="primary-navigation" aria-label="Main navigation" className={`${styles.links} ${open ? styles.open : ''}`} onClick={event => { if (event.target.closest('a')) setOpenPath(null); }} onKeyDown={event => { if (event.key === 'Escape') setOpenPath(null); }}>
            <NavItem to="/items">Discover</NavItem>
            {isLoggedIn && (LINKS_BY_ROLE[role] ?? []).map(([to, label]) => (
                <NavItem key={to} to={to}>{label}</NavItem>
            ))}
            </nav>
            <div className={styles.account}>
            {isLoggedIn ? (
                <>
                    <span className={styles.identity}>{user.username}<small>{role}</small></span>
                    <Button variant="secondary" size="small" onClick={handleLogout}>
                        Log out
                    </Button>
                </>
            ) : (
                <>
                    <Button variant="ghost" size="small" to="/login">Log in</Button>
                    <Button size="small" to="/register">Join ACL</Button>
                </>
            )}
            </div>
          </div>
          {logoutError && <p role="status">{logoutError}</p>}
        </header>
    );
}
