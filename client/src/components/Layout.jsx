import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Nav } from './Nav.jsx';
import styles from './Layout.module.css';

export function Layout() {
    const { pathname, hash } = useLocation();
    const entry = ['/', '/login', '/register'].includes(pathname);
    const sectional = entry || /^\/items\/[^/]+\/?$/.test(pathname);
    const previousPath = useRef(null);
    useEffect(() => {
        const switchingAccountPanel = entry && ['/', '/login', '/register'].includes(previousPath.current);
        const changedPage = previousPath.current !== pathname;
        previousPath.current = pathname;
        // Query updates may clear an anchor. Keep guest search at its current scroll position.
        if (!changedPage && !hash) return;
        if (switchingAccountPanel && !hash) return;
        const frame = window.requestAnimationFrame(() => {
            const target = hash ? document.getElementById(hash.slice(1)) : ['/login', '/register'].includes(pathname) ? document.getElementById('account-access') : null;
            if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
            else window.scrollTo(0, 0);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [pathname, hash]);
    return (
        <div className={styles.shell} data-theme="light">
            <a className={styles.skip} href="#main-content">Skip to content</a>
            {!entry && <Nav />}
            <main id="main-content" className={`${styles.main} ${sectional ? styles.entry : ''}`}>
                <Outlet />
            </main>
            <footer className={styles.footer}>
                <Link to="/" className={styles.brand}>ACL<span> / shared possibilities</span></Link>
                <p>Good things are better shared.</p>
                <Link to="/items">Explore the catalog</Link>
            </footer>
        </div>
    );
}
