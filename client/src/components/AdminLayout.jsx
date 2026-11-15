import { NavLink, Outlet } from 'react-router-dom';
import styles from './AdminLayout.module.css';

const LINKS = [
    ['/admin', 'Users'],
    ['/admin/items', 'Items'],
    ['/admin/lender-requests', 'Lender requests'],
    ['/admin/categories', 'Categories'],
    ['/admin/create-admin', 'New admin']
];

// Wraps every admin page with the admin menu.
export function AdminLayout() {
    return (
        <>
            <nav className={styles.tabs} aria-label="Administration">
                {LINKS.map(([to, label]) => (
                    <NavLink key={to} end={to === '/admin'} className={({ isActive }) => isActive ? styles.active : ''} to={to}>{label}</NavLink>
                ))}
            </nav>
            <Outlet />
        </>
    );
}
