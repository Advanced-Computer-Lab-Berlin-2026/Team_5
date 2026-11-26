import { useEffect, useRef } from 'react';
import styles from './StickerField.module.css';

// w and h are the real sizes of the cut-out files, so each sticker's box can be centered without measuring it.
// dx and dy are where it lands in the final pile, in units of the screen's short side.
const SHRINK = 0.7; // every sticker is drawn at 70% of its old size
// fit: a file's tall or wide shape would otherwise make it look bigger or smaller than the rest, so each one is sized by its longer side
const fit = (w, h) => (w >= h ? 1 : w / h);
const STICKERS = [
    { src: '/images/floaters/cat.png', w: 513, h: 560, size: 1.05, dx: 0.07, dy: -0.06, rot: 5 },
    { src: '/images/floaters/finn.png', w: 560, h: 560, size: 0.78, dx: -0.05, dy: 0.07, rot: 9, pixel: true },
    { src: '/images/floaters/duck.png', w: 560, h: 438, size: 1.12, dx: 0.06, dy: 0.04, rot: -4 },
    { src: '/images/floaters/chef.png', w: 560, h: 363, size: 1.05, dx: 0.05, dy: 0.08, rot: -9, pixel: true },
    { src: '/images/floaters/spidey.png', w: 391, h: 560, size: 0.74, dx: 0.0, dy: 0.0, rot: 3 },
    // the six newest are all sized the same way, by their longer side
    { src: '/images/floaters/cat-paw.png', w: 450, h: 560, size: fit(450, 560), dx: -0.03, dy: -0.08, rot: -5 },
    { src: '/images/floaters/bear.png', w: 430, h: 560, size: fit(430, 560), dx: 0.04, dy: 0.02, rot: 6 },
    { src: '/images/floaters/frog-open.png', w: 404, h: 427, size: fit(404, 427), dx: -0.02, dy: 0.05, rot: -8 },
    { src: '/images/floaters/potato.png', w: 296, h: 472, size: fit(296, 472), dx: 0.08, dy: -0.02, rot: 4 },
    { src: '/images/floaters/snow-leopard.png', w: 360, h: 560, size: fit(360, 560), dx: -0.06, dy: -0.03, rot: 5 },
    { src: '/images/floaters/lego.png', w: 560, h: 523, size: fit(560, 523), dx: 0.02, dy: 0.06, rot: -3 }
];

// While the login is still on screen (before this much of the sequence) the stickers keep circling on their own, and scrolling
// only gives them a push of momentum. Past it, scrolling down takes over: the loop tightens until they meet.
const THRESHOLD = 0.3;
const BASE_SPEED = 0.15; // radians per second when nothing is pushing them
const PUSH = 0.004; // extra radians per second for every pixel scrolled
const COAST = 1.8; // seconds for a push to fade back to the base speed

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const topOf = element => element.getBoundingClientRect().top + window.scrollY;

let triggerExplosion = null;
// Plays the burst in place (no scrolling): everything gathers, flips, and white takes over the screen. Resolves when it is done.
// With dark: true the burst is black instead, so it lands on a dark page without flashing white.
export function playExplosion({ dark = false } = {}) {
    return new Promise(resolve => {
        if (triggerExplosion) triggerExplosion(resolve, dark);
        else resolve();
    });
}

// The stickers are always there behind the page (they show through the opening circle) and spin on their own until you scroll
// down from the login. After that only the scroll drives them, from the moment the login has opened to the end of the spacer:
//   0 - 0.3    they keep circling wide
//   0.3 - 0.62 the loop tightens as you scroll, until they meet
//   0.62 - 0.78 they sit in one overlapping pile
//   0.78 - 1   they flip, scatter, and a white burst takes over the whole screen
export function StickerField() {
    const fieldRef = useRef(null);
    const whiteRef = useRef(null);
    const stickerRefs = useRef([]);

    useEffect(() => {
        const field = fieldRef.current;
        const white = whiteRef.current;
        if (!field || !white) return undefined;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let frame = 0;
        let loop = 0;
        let auto = 0; // angle gained by spinning on their own
        let speed = BASE_SPEED; // current spin speed: the base speed plus any leftover push
        let lastScrollY = window.scrollY;
        let lastP = 0;
        let lastTime = 0;
        let explosion = null; // { start, duration, resolve } while the in-place burst is playing

        const progress = () => {
            const start = document.getElementById('account-access');
            const spacer = document.getElementById('sticker-spacer');
            if (!start || !spacer) return 0;
            const from = topOf(start);
            const to = topOf(spacer) + spacer.offsetHeight - window.innerHeight * 1.0;
            return clamp((window.scrollY - from) / Math.max(1, to - from), 0, 1);
        };

        const render = () => {
            frame = 0;
            const width = field.clientWidth;
            const height = field.clientHeight;
            if (!width || !height) return;
            const p = progress();
            lastP = p;
            const cx = width / 2;
            const cy = height * 0.5;
            const unit = Math.min(width, height);

            if (reduced) {
                // no motion: stay black, then switch to white once the sequence is over
                white.style.clipPath = p > 0.85 ? `circle(${Math.hypot(width, height)}px at ${cx}px ${cy}px)` : 'circle(0px at 50% 50%)';
                stickerRefs.current.forEach(el => { if (el) el.style.opacity = '0'; });
                return;
            }

            // an in-place explosion runs on a clock instead of on scroll: gather first, then flip and burst
            const q = explosion ? clamp((performance.now() - explosion.start) / explosion.duration, 0, 1) : 0;
            const meet = explosion ? Math.max(smooth(THRESHOLD, 0.62, p), smooth(0, 0.55, q)) : smooth(THRESHOLD, 0.62, p); // 0 = wide loop, 1 = everything has met
            const burst = explosion ? smooth(0.6, 1, q) : smooth(0.78, 1, p); // flip, scatter and white
            const fadeOut = explosion ? 1 - smooth(0.9, 1, q) : 1 - smooth(0.94, 1, p);
            if (explosion && q >= 1 && explosion.resolve) { explosion.resolve(); explosion.resolve = null; }

            const maxR = Math.hypot(width, height) / 2 * 1.05;
            white.style.clipPath = burst > 0 ? `circle(${(maxR * (1 - (1 - burst) ** 3)).toFixed(1)}px at ${cx}px ${cy}px)` : 'circle(0px at 50% 50%)';

            STICKERS.forEach((sticker, i) => {
                const el = stickerRefs.current[i];
                if (!el) return;
                const base = i * ((Math.PI * 2) / STICKERS.length); // evenly spaced round the loop
                const theta = base + auto + Math.max(0, p - THRESHOLD) * 2.2 * Math.PI * 2;
                const closeness = 1 - meet;
                const radiusX = width * 0.42 * closeness;
                const radiusY = height * 0.34 * closeness;
                const bobX = Math.sin(p * 9 + i * 1.7) * width * 0.012 * closeness;
                const bobY = Math.cos(p * 8 + i * 2.1) * height * 0.015 * closeness;
                const depth = (Math.sin(theta) + 1) / 2; // 0 = behind the group, 1 = in front of it

                const orbitSize = clamp(unit * 0.26, 110, 230) * sticker.size * SHRINK * (0.8 + 0.3 * depth);
                const pileSize = unit * 0.3 * sticker.size * SHRINK;
                const pulse = 1 + 0.3 * Math.sin(Math.PI * burst);
                const w = lerp(orbitSize, pileSize, meet) * pulse * (1 + burst * 0.5);
                const h = w * (sticker.h / sticker.w);

                // scatter outward during the burst, each along its own direction
                const scatter = burst * burst * unit * 0.6;
                const x = cx + Math.cos(theta) * radiusX + bobX + sticker.dx * unit * meet + Math.cos(base) * scatter;
                const y = cy + Math.sin(theta) * radiusY + bobY + sticker.dy * unit * meet + Math.sin(base) * scatter * 0.8;
                const rotation = lerp(Math.sin(base + p * 4) * 14, sticker.rot, meet) + burst * (i % 2 ? 40 : -40);
                const flip = burst * 180;

                el.style.width = `${w}px`;
                el.style.opacity = String(fadeOut);
                el.style.zIndex = String(Math.round(depth * 6 * (1 - meet) + i * meet) + 1);
                el.style.transform = `translate3d(${x - w / 2}px, ${y - h / 2}px, 0) perspective(900px) rotateY(${flip}deg) rotate(${rotation}deg)`;
            });
        };

        // free spin: only while the page hasn't been scrolled down from the login; it eases to a stop as scrolling takes over
        const tick = now => {
            loop = 0;
            const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
            lastTime = now;
            // a scroll push fades back to the base speed; once scrolling takes over (past the threshold) the free spin eases out
            speed += (BASE_SPEED - speed) * (1 - Math.exp(-dt / COAST));
            auto += explosion ? dt * 1.4 : dt * speed * (1 - smooth(THRESHOLD, THRESHOLD + 0.04, lastP)); // the swirl speeds up as the explosion gathers
            render();
            const running = explosion ? performance.now() - explosion.start < explosion.duration + 100 : lastP < THRESHOLD + 0.04;
            if (running && !document.hidden) loop = requestAnimationFrame(tick);
            else lastTime = 0;
        };
        const spin = () => { if (!reduced && !loop && (explosion || lastP < THRESHOLD + 0.04)) loop = requestAnimationFrame(tick); };
        triggerExplosion = (resolve, dark) => {
            white.style.background = dark ? 'var(--color-black, #141414)' : '';
            document.documentElement.dataset.exploding = 'true';
            if (reduced) { window.setTimeout(resolve, 150); return; }
            explosion = { start: performance.now(), duration: 2600, resolve };
            spin();
        };
        const schedule = () => {
            // scrolling gives the stickers a push (down speeds them up, up slows or reverses them) while the login is still showing
            const y = window.scrollY;
            if (!explosion && lastP < THRESHOLD) speed = clamp(speed + (y - lastScrollY) * PUSH, -4, 4);
            lastScrollY = y;
            if (!frame) frame = requestAnimationFrame(() => { render(); spin(); });
        };
        render();
        spin();
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const observer = new ResizeObserver(schedule);
        observer.observe(document.body);
        document.addEventListener('visibilitychange', spin);
        return () => {
            cancelAnimationFrame(frame);
            cancelAnimationFrame(loop);
            triggerExplosion = null;
            delete document.documentElement.dataset.exploding;
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            document.removeEventListener('visibilitychange', spin);
            observer.disconnect();
        };
    }, []);

    return (
        <div ref={fieldRef} className={styles.field} aria-hidden="true">
            <div ref={whiteRef} className={styles.white} />
            {STICKERS.map((sticker, i) => (
                <img key={sticker.src} ref={el => { stickerRefs.current[i] = el; }} className={`${styles.sticker} ${sticker.pixel ? styles.pixel : ''}`}
                    src={sticker.src} alt="" width={sticker.w} height={sticker.h} draggable={false} />
            ))}
        </div>
    );
}

export function StickerSpacer() {
    return <div id="sticker-spacer" className={styles.spacer} aria-hidden="true" />;
}
