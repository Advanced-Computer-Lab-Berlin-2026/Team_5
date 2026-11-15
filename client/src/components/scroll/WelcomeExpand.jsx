import { useEffect, useState } from 'react';
import ScrollExpand from './vendor/ScrollExpand.jsx';
import { Icon } from '../Icon.jsx';
import styles from './WelcomeExpand.module.css';

export function WelcomeExpand({ children, registering = false }) {
    const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const change = event => setReducedMotion(event.matches);
        preference.addEventListener('change', change);
        return () => preference.removeEventListener('change', change);
    }, []);

    const title = <div className={styles.heading}><p className="eyebrow">More possibilities. Less to own.</p><h1>Welcome to<br /><span>In-Your-Shed</span><span className={styles.dot}>.</span></h1></div>;
    const openCue = <a href="#account-access">Scroll to open your shed <Icon name="down" size={16} /></a>;
    const account = <div className={`${styles.revealContent} ${registering ? styles.wide : ''}`}>{children}<a className={styles.guestCue} href="#guest-catalog">Scroll to browse as guest <Icon name="down" size={16} /></a></div>;

    return <section className={styles.welcome} data-theme="dark" aria-label="Welcome to In-Your-Shed">
        {reducedMotion ? <><div className={styles.staticWelcome}>{title}{openCue}</div><div id="account-access" className={styles.staticAccount}>{account}</div></> :
            <ScrollExpand useWindowScroll fitContent accountAnchorId="account-access" src="/images/shared-gear.png" alt="Shared camera, tools, and camping gear" title={title} scrollHint={openCue} startWidth={64} startHeight={62} startRadius={20} endRadius={0} mediaZoom={1.15} scrollDistance={0.75} holdDistance={0.12} smoothing={0.06} overlayScrim={1} className={styles.expand}>
                {account}
            </ScrollExpand>}
        <nav className={styles.shortcuts} aria-label="Skip welcome animation"><a href="#account-access">Skip to log in / register</a><a href="#guest-catalog">Skip to guest browsing</a></nav>
    </section>;
}
