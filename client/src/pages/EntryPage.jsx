import { useEffect, useRef } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getLoginDestination } from '../theme/routes.js';
import { PageSection, Spinner } from '../components';
import { LoginForm } from '../components/auth/LoginForm.jsx';
import { RegisterForm } from '../components/auth/RegisterForm.jsx';
import CatalogPage from './CatalogPage.jsx';
import { WelcomeExpand } from '../components/scroll/WelcomeExpand.jsx';
import { AnimatedHeight } from '../components/AnimatedHeight.jsx';
import { GuestIntroduction } from '../components/scroll/GuestIntroduction.jsx';
import styles from './EntryPage.module.css';

export default function EntryPage() {
    const { isLoggedIn, checking, role } = useAuth();
    const location = useLocation();
    const registering = location.pathname === '/register';
    const initialAccountJump = useRef(false);
    useEffect(() => {
        if (checking || initialAccountJump.current) return;
        if (location.pathname === '/' || window.location.hash) { initialAccountJump.current = true; return; }
        const frame = window.requestAnimationFrame(() => {
            document.getElementById('account-access')?.scrollIntoView({ behavior: 'instant' });
            initialAccountJump.current = true;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [checking, location.pathname]);
    if (checking) return <Spinner label="Checking your session…" />;
    if (isLoggedIn) return <Navigate to={getLoginDestination(location.state?.from, role)} replace />;

    return <>
        <WelcomeExpand registering={registering}>
            <section className={styles.auth} data-theme="dark" aria-labelledby="entry-heading">
                <nav className={styles.switch} aria-label="Account access">
                    <Link to={`/login${location.search}`} state={location.state} className={!registering ? styles.active : ''} aria-current={!registering ? 'page' : undefined}>Log in</Link>
                    <Link to={`/register${location.search}`} state={location.state} className={registering ? styles.active : ''} aria-current={registering ? 'page' : undefined}>Register</Link>
                </nav>
                <AnimatedHeight>
                <div className={`${styles.authContent} ${registering ? styles.registerReveal : styles.loginReveal}`}>
                <div className={styles.formHeading}>
                    <p className="eyebrow">Your community, connected</p>
                    <h2 id="entry-heading">{registering ? 'Make yourself at home.' : 'Welcome back.'}</h2>
                    <p className="muted">{registering ? 'Create an account to save your favorite finds.' : 'Log in to keep your next idea moving.'}</p>
                </div>
                <div hidden={registering}><LoginForm /></div>
                <div hidden={!registering}><RegisterForm /></div>
                </div>
                </AnimatedHeight>
            </section>
        </WelcomeExpand>
        <section id="guest-catalog" className={styles.guestSection} data-theme="light" aria-label="Guest catalog">
        <section className={styles.themeBridge} aria-label="Guest introduction">
            <GuestIntroduction />
        </section>
        <PageSection theme="light" contentClassName={styles.catalog} aria-label="Browse items">
            <CatalogPage embedded showIntroduction={false} />
        </PageSection>
        </section>
    </>;
}
