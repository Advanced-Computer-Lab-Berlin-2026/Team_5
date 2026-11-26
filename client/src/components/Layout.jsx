import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { isDarkPage } from '../theme/routes.js';
import AnimatedContent from './AnimatedContent.jsx';
import { Nav } from './Nav.jsx';
import styles from './Layout.module.css';

export function Layout() {
    const { pathname, hash, state } = useLocation();
    const returningTo = state?.guestY;
    const { isLoggedIn, role } = useAuth();
    // the logged-in catalog and item pages are dark for everyone except members; lenders also get their nav and settings-menu pages dark. entry pages and everything else stay light
    const dark = isLoggedIn && isDarkPage(role, pathname);
    const entry = ['/', '/login', '/register'].includes(pathname);
    const sectional = entry || /^\/items\/[^/]+\/?$/.test(pathname) || /^\/lender\/items\/[^/]+\/edit\/?$/.test(pathname);
    const previousPath = useRef(null);
    // body and the browser canvas sit outside the shell, so they need the theme too or the page edges stay light
    useEffect(() => {
        const root = document.documentElement;
        if (dark) root.setAttribute('data-theme', 'dark');
        else root.removeAttribute('data-theme');
        return () => root.removeAttribute('data-theme');
    }, [dark]);
    useEffect(() => {
        const switchingAccountPanel = entry && ['/', '/login', '/register'].includes(previousPath.current);
        const changedPage = previousPath.current !== pathname;
        previousPath.current = pathname;
        // Query updates may clear an anchor. Keep guest search at its current scroll position.
        if (!changedPage && !hash) return;
        if (switchingAccountPanel && !hash) return;
        if (returningTo !== undefined) return; // coming back to the guest page: WelcomeExpand puts the scroll back where it was
        const frame = window.requestAnimationFrame(() => {
            // arriving on login or register always starts from the In Your Shed logo, so there is no jump to the form
            const target = hash ? document.getElementById(hash.slice(1)) : null;
            if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
            else window.scrollTo(0, 0);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [pathname, hash]);
    return (
        <div className={styles.shell} data-theme={dark ? 'dark' : 'light'}>
            <a className={styles.skip} href="#main-content">Skip to content</a>
            {!entry && <Nav />}
            <main id="main-content" className={`${styles.main} ${sectional ? styles.entry : ''}`}>
                {sectional ? <Outlet /> : (
                    // keyed by path so every page change replays it; the sectional pages animate themselves
                    <AnimatedContent key={pathname} className={styles.page} trigger="mount" distance={24} duration={0.55} ease="power2.out">
                        <Outlet />
                    </AnimatedContent>
                )}
            </main>
        </div>
    );
}
