import { useEffect } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ScrollReveal from './reveal-vendor/ScrollReveal.jsx';
import styles from './GuestIntroduction.module.css';

// Account resizing changes the following text's scroll positions. Refresh only
// once layout has settled, rather than measuring on every animation frame.
export function GuestIntroduction() {
    useEffect(() => {
        let timer;
        const refresh = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => ScrollTrigger.refresh(), 140);
        };
        const observer = new ResizeObserver(refresh);
        const main = document.getElementById('main-content');
        if (main) observer.observe(main);
        return () => { observer.disconnect(); window.clearTimeout(timer); };
    }, []);

    const settings = { enableBlur: true, baseOpacity: 0.15, baseRotation: 0, blurStrength: 4, smoothing: 0.15, wordAnimationEnd: 'bottom 45%', rotationEnd: 'bottom 45%' };
    return <header className={styles.intro}>
        <ScrollReveal {...settings} as="p" containerClassName={styles.label} textClassName={styles.labelText}>Take a look around</ScrollReveal>
        <ScrollReveal {...settings} containerClassName={styles.title} textClassName={styles.titleText}>Find your next possibility.</ScrollReveal>
        <ScrollReveal {...settings} as="p" containerClassName={styles.description} textClassName={styles.descriptionText}>Browse freely. Log in when you find something worth saving.</ScrollReveal>
    </header>;
}
