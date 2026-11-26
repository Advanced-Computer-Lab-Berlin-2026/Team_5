import { useEffect, useState } from 'react';
import ScrollExpand from './vendor/ScrollExpand.jsx';
import Grainient from '../Grainient.jsx';
import { Icon } from '../Icon.jsx';
import styles from './WelcomeExpand.module.css';

// Glides the window to a scroll position slowly, and lets any wheel, touch or key press take over.
function glideTo(to) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { window.scrollTo(0, to); return; }
    const from = window.scrollY;
    const direction = Math.sign(to - from) || 1;
    const distance = Math.abs(to - from);
    const SPEED = 1 / 1.75; // pixels per millisecond: the steady pace
    let travelled = 0;
    let last = performance.now();
    let frame = 0;
    const finish = () => {
        cancelAnimationFrame(frame);
        ['wheel', 'touchstart', 'keydown'].forEach(name => window.removeEventListener(name, finish));
    };
    ['wheel', 'touchstart', 'keydown'].forEach(name => window.addEventListener(name, finish, { passive: true }));
    const step = now => {
        const dt = Math.min(64, now - last);
        last = now;
        // steady speed for most of the trip, then it eases up to double that speed over the final stretch
        const progress = travelled / distance;
        const t = Math.min(1, Math.max(0, (progress - 0.55) / 0.2));
        const boost = 1 + t * t * (3 - 2 * t);
        travelled = Math.min(distance, travelled + SPEED * boost * dt);
        window.scrollTo(0, from + direction * travelled);
        if (travelled < distance) frame = requestAnimationFrame(step);
        else finish();
    };
    frame = requestAnimationFrame(step);
}

const topOf = element => element.getBoundingClientRect().top + window.scrollY;

export function WelcomeExpand({ children }) {
    useEffect(() => {
        // always begin at the logo: no remembered scroll position from a reload or the back button
        if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
        const spot = window.history.state?.usr?.guestY;
        let frame = 0;
        let timer = 0;
        if (typeof spot === 'number') {
            // coming back from an item: return to where the guest page was left. the catalog may still be loading and the page not tall
            // enough yet, so keep trying for a moment
            const until = performance.now() + 2000;
            const restore = () => {
                window.scrollTo(0, spot);
                if (Math.abs(window.scrollY - spot) > 1 && performance.now() < until) frame = requestAnimationFrame(restore);
            };
            restore();
            // once it has settled, forget the spot so that a reload still starts at the logo
            timer = window.setTimeout(() => { const st = window.history.state ?? {}; window.history.replaceState({ ...st, usr: { ...(st.usr ?? {}), guestY: undefined } }, ''); }, 2200);
        } else if (!window.location.hash) window.scrollTo(0, 0);
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(timer);
            if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'auto';
        };
    }, []);
    // scroll until the "Find your next possibility." title is at the top of the page
    function handleCue() {
        // from the logo screen, the first press only goes as far as the login; pressing again carries on to the catalog
        const account = document.getElementById('account-access');
        if (account && window.scrollY < topOf(account) - 40) { glideTo(topOf(account)); return; }
        const intro = document.getElementById('guest-intro');
        if (!intro) return;
        glideTo(topOf(document.querySelector('#guest-intro > :first-child') ?? intro) - 24);
    }
    const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const change = event => setReducedMotion(event.matches);
        preference.addEventListener('change', change);
        return () => preference.removeEventListener('change', change);
    }, []);

    // warm amber gradient in the site's colors, starting from the page's near-black
    const background = <Grainient colors={['#141414', '#2a1608', '#8a4a14', '#f3a348', '#fde3bd']} angle={55} flow={0.8} silk={0.35} grainAmount={0.08} scale={2.2} variation={3} />;
    const title = <div className={styles.heading}>
        <h1 className="sr-only">Welcome to In-Your-Shed</h1>
        <span className={styles.logo} role="img" aria-label="In Your Shed, Cairo, est. 2018" />
    </div>;
    const account = <div className={styles.revealContent}>{children}</div>;

    return <section className={styles.welcome} data-theme="dark" aria-label="Welcome to In-Your-Shed">
        {reducedMotion ? <><div className={styles.staticWelcome}>{title}</div><div id="account-access" className={styles.staticAccount}>{account}</div></> :
            <ScrollExpand useWindowScroll fitContent accountAnchorId="account-access" mediaNode={background} title={title} shape="circle" invert startSize={0} endRadius={0} mediaZoom={1} scrollDistance={0.75} holdDistance={0.9} smoothing={0.06} overlayScrim={0} className={styles.expand}>
                {account}
            </ScrollExpand>}
        <nav className={styles.shortcuts} aria-label="Skip welcome animation"><a href="#account-access">Skip to log in / register</a></nav>
        {/* one text button through the whole welcome section; it inverts whatever is behind it */}
        <div className={styles.guestDock}>
            <button type="button" className={styles.guestButton} onClick={handleCue}>Scroll to browse as guest <Icon name="down" size={16} /></button>
        </div>
    </section>;
}
