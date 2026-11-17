import { useEffect, useRef } from 'react';
import styles from './Cursor.module.css';

const INTERACTIVE = 'a[href], button, summary, label, select, [role="button"], [role="option"], [role="combobox"], [data-interactive]';
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]';

// A small pointer arrow that inverts the colours of whatever it is over (a white shape blended with "difference"), so it shows on any page.
// It grows a little over anything clickable and presses in on click. Over text fields and dialogs the normal cursor is used instead.
// Only for mouse-like pointers.
export default function Cursor() {
    const posRef = useRef(null);
    const arrowRef = useRef(null);

    useEffect(() => {
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
        const pos = posRef.current;
        const arrow = arrowRef.current;
        const root = document.documentElement;
        let seen = false;

        const move = event => {
            if (event.pointerType === 'touch') return;
            pos.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
            if (!seen) { seen = true; root.dataset.cursor = 'custom'; }
            const target = event.target instanceof Element ? event.target : null;
            arrow.dataset.state = target?.closest(`dialog, ${TEXT_FIELD}`) ? 'native' : target?.closest(INTERACTIVE) ? 'active' : 'idle';
        };
        const leave = () => { arrow.dataset.state = 'hidden'; };
        const down = () => { arrow.dataset.pressed = ''; };
        const up = () => { delete arrow.dataset.pressed; };

        document.addEventListener('pointermove', move, { passive: true });
        document.addEventListener('pointerdown', down, { passive: true });
        document.addEventListener('pointerup', up, { passive: true });
        root.addEventListener('pointerleave', leave);
        window.addEventListener('blur', leave);
        arrow.dataset.state = 'hidden';
        return () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerdown', down);
            document.removeEventListener('pointerup', up);
            root.removeEventListener('pointerleave', leave);
            window.removeEventListener('blur', leave);
            delete root.dataset.cursor;
        };
    }, []);

    return <div className={styles.layer} aria-hidden="true">
        <div ref={posRef} className={styles.pos}>
            <svg ref={arrowRef} className={styles.arrow} width="15" height="15" viewBox="0 0 30 30">
                <path d="M5.5 3.5 L26.5 11.8 Q29 13 26.4 14.4 L18 18.2 L14.2 27 Q13 29.6 11.4 27 Z" />
            </svg>
        </div>
    </div>;
}
