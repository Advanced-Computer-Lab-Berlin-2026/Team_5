
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getLoginDestination } from '../theme/routes.js';
import { Button, Icon, PageSection, Spinner } from '../components';
import TiltedCard from '../components/TiltedCard.jsx';
import { LoginForm } from '../components/auth/LoginForm.jsx';
import { ForgotPasswordForm } from '../components/auth/ForgotPasswordForm.jsx';
import { RegisterForm } from '../components/auth/RegisterForm.jsx';
import CatalogPage from './CatalogPage.jsx';
import { StickerField, StickerSpacer } from '../components/scroll/StickerField.jsx';
import { isHoldingRedirect } from '../components/scroll/transition.js';
import { WelcomeExpand } from '../components/scroll/WelcomeExpand.jsx';
import { GuestIntroduction } from '../components/scroll/GuestIntroduction.jsx';
import styles from './EntryPage.module.css';

export default function EntryPage() {
    const { isLoggedIn, checking, role } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const registering = location.pathname === '/register';
    // the login side of the card turns into the reset-password view in place
    const [forgot, setForgot] = useState(Boolean(location.state?.forgot));
    // flipping the card also moves the address between /login and /register, keeping any redirect state
    const flipTo = path => navigate(`${path}${location.search}`, { state: location.state });
    if (checking) return <Spinner label="Checking your session…" />;
    if (isLoggedIn && !isHoldingRedirect()) return <Navigate to={getLoginDestination(location.state?.from, role)} replace />;

    return <>
        <StickerField />
        <WelcomeExpand>
            <TiltedCard containerWidth="100%" containerHeight="var(--auth-card-height)" imageWidth="100%" imageHeight="100%" className={styles.card} radius={12}
                rotateAmplitude={3} scaleOnHover={1.01} glare={0.1} shadow={0.4} parallax={0} showTooltip={false} intro={false}
                altText="Account access" flipped={registering} flipOnClick={false}
                backContent={
                    <section className={styles.face} aria-label="Register" inert={!registering}>
                        <RegisterForm />
                        <div className={styles.footer}>
                            <button type="button" className={styles.flip} onClick={() => flipTo('/login')}>Log in <Icon name="reset" size={20} /></button>
                        </div>
                    </section>
                }>
                <section className={`${styles.face} ${styles.loginFace}`} aria-label="Log in" inert={registering}>
                    {forgot ? <div key="forgot" className={`${styles.view} ${styles.fromRight}`}>
                        <div className={styles.faceHead}>
                            <button type="button" className={styles.back} onClick={() => setForgot(false)} aria-label="Back to log in" title="Back to log in"><Icon name="back" size={28} /></button>
                            <h2 id="entry-heading">Reset password</h2>
                        </div>
                        <ForgotPasswordForm onDone={notice => { setForgot(false); navigate('/login', { replace: true, state: { notice } }); }} />
                    </div> : <div key="login" className={`${styles.view} ${styles.fromLeft}`}>
                        <h2 id="entry-heading">Welcome back.</h2>
                        <LoginForm onForgot={() => setForgot(true)} />
                        <div className={styles.footer}>
                            <button type="button" className={styles.flip} onClick={() => flipTo('/register')}>Register <Icon name="reset" size={20} /></button>
                        </div>
                    </div>}
                </section>
            </TiltedCard>
        </WelcomeExpand>
        <section id="guest-catalog" className={styles.guestSection} data-theme="light" aria-label="Guest catalog">
        <section className={styles.themeBridge} aria-label="Guest introduction">
            <StickerSpacer />
            <GuestIntroduction />
            <Button variant="secondary" to="/register#account-access" state={{ from: '/become-lender' }}>Apply to become a lender</Button>
        </section>
        <PageSection theme="light" contentClassName={styles.catalog} aria-label="Browse items">
            <CatalogPage embedded showIntroduction={false} />
        </PageSection>
        </section>
    </>;
}
