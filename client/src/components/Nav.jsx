import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { BorrowBasket } from './BorrowBasket.jsx';
import StaggeredMenu from './StaggeredMenu.jsx';
import styles from './Nav.module.css';

// Which links each role sees, after the always-visible ones.
const LINKS_BY_ROLE = {
    member: [['/bookings', 'My bookings'], ['/wishlist', 'Wishlist'], ['/household', 'Household'], ['/notices', 'Notices']],
    lender: [['/lender/items', 'My items'], ['/reservations', 'Reservations'], ['/bookings', 'My bookings'], ['/wishlist', 'Wishlist'], ['/household', 'Household'], ['/notices', 'Notices']],
    admin: [['/admin', 'Users'], ['/admin/items', 'Items'], ['/admin/lender-requests', 'Lender requests'], ['/admin/categories', 'Categories'], ['/admin/promo-codes', 'Promo codes'], ['/admin/create-admin', 'New admin'], ['/admin/reports', 'Reports']]
};

function NavItem({ to, children }) {
    return (
        <NavLink to={to} end={to === '/' || to === '/admin'} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
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
    // a guest looking at one item sees a bare header: just the logo, with no links or log in buttons
    const guestItemView = !isLoggedIn && /^\/items\/[^/]+\/?$/.test(location.pathname);
    // hide while scrolling down past 150px, reveal as soon as the user scrolls up
    const [hidden, setHidden] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    useEffect(() => {
        let previous = window.scrollY;
        const onScroll = () => {
            const current = window.scrollY;
            setHidden(current > previous && current > 150);
            previous = current;
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    async function handleLogout() {
        try { await logout(); } catch { setLogoutError('The server could not confirm logout. Your local session was cleared.'); }
        navigate('/login');
    }

    return (
        <header className={styles.header} data-hidden={hidden && !open && !menuOpen ? '' : undefined}>
          <div className={styles.nav}>
            {/* admins have no Discover link; for them the logo opens the catalog */}
            <Link to={role === 'admin' ? '/items' : '/'} className={styles.brand} aria-label={role === 'admin' ? 'In Your Shed, open the catalog' : 'In Your Shed home'}><span className={styles.logo} role="img" aria-label="In Your Shed, Cairo, est. 2018" /></Link>
            {!guestItemView && <button className={styles.toggle} type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpenPath(open ? null : location.pathname)}><Icon name={open ? 'close' : 'menu'} /></button>}
            {!guestItemView && <nav id="primary-navigation" aria-label="Main navigation" className={`${styles.links} ${open ? styles.open : ''}`} onClick={event => { if (event.target.closest('a')) setOpenPath(null); }} onKeyDown={event => { if (event.key === 'Escape') setOpenPath(null); }}>
            {role !== 'admin' && <NavItem to="/items">Discover</NavItem>}
            {isLoggedIn && (LINKS_BY_ROLE[role] ?? []).map(([to, label]) => (
                <NavItem key={to} to={to}>{label}</NavItem>
            ))}
            </nav>}
            <div className={styles.account}>
            {/* members and lenders both pay for their borrow list at checkout */}
            {isLoggedIn && (role === 'member' || role === 'lender') && <BorrowBasket />}
            {isLoggedIn && <NotificationBell />}
            {isLoggedIn ? (
                <StaggeredMenu
                    items={[
                        // admin pages that are used less often live in this menu instead of the header
                        ...(role === 'admin' ? [
                            { label: 'Support', ariaLabel: 'Questions from members and lenders', link: '/admin/support', onSelect: () => navigate('/admin/support') },
                            { label: 'Mods', ariaLabel: 'Reports about items and people', link: '/admin/moderation', onSelect: () => navigate('/admin/moderation') },
                            { label: 'Notices', ariaLabel: 'Community notices', link: '/notices', onSelect: () => navigate('/notices') }
                        ] : [
                            { label: 'Profile', ariaLabel: 'Go to your profile', link: '/profile', onSelect: () => navigate('/profile') },
                            { label: 'Wallet', ariaLabel: 'Go to your wallet', link: '/wallet', onSelect: () => navigate('/wallet') },
                            { label: 'Member', ariaLabel: 'Your membership plan', link: '/membership', onSelect: () => navigate('/membership') },
                            { label: 'Waitlist', ariaLabel: 'Items you are waiting for', link: '/waitlist', onSelect: () => navigate('/waitlist') },
                            { label: 'Email', ariaLabel: 'Email preferences', link: '/settings/email', onSelect: () => navigate('/settings/email') }
                        ]),
                        ...(role === 'member' ? [{ label: 'Lend', ariaLabel: 'Become a lender', link: '/become-lender', onSelect: () => navigate('/become-lender') }] : []),
                        // members and lenders can ask the admins for help
                        ...(role === 'member' || role === 'lender' ? [{ label: 'Help', ariaLabel: 'Ask the admins for help', link: '/support', onSelect: () => navigate('/support') }] : []),
                        { label: 'Log out', ariaLabel: 'Log out', onSelect: handleLogout }
                    ]}
                    title={`${user.username} · ${role}`}
                    onMenuOpen={() => setMenuOpen(true)}
                    onMenuClose={() => setMenuOpen(false)}
                />
            ) : guestItemView ? null : (
                <>
                    <Button variant="ghost" size="small" to="/login">Log in</Button>
                    <Button size="small" to="/register">Join In Your Shed</Button>
                </>
            )}
            </div>
          </div>
          {logoutError && <p role="status">{logoutError}</p>}
        </header>
    );
}
