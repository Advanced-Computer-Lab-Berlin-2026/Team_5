import { useEffect, useRef } from 'react';
import { useCardTilt } from '../hooks/useCardTilt.js';
import styles from './ReserveDialog.module.css';

// The amber card used for small forms (like the reserve and household cards): it fades in, tilts toward the pointer and
// closes on Escape, a click outside, or onClose. Put a <form> or any content inside.
export function AmberDialog({ open, label, onClose, children }) {
    const dialog = useRef(null);
    useCardTilt(dialog);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return undefined;
        if (open) {
            delete element.dataset.closing;
            if (!element.open) element.showModal();
            return undefined;
        }
        if (!element.open) return undefined;
        element.dataset.closing = 'true';
        const timer = window.setTimeout(() => { element.close(); delete element.dataset.closing; }, 200);
        return () => window.clearTimeout(timer);
    }, [open]);

    return <dialog ref={dialog} className={styles.dialog} aria-label={label}
        onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
        onClick={event => { if (event.target === dialog.current) onClose(); }}>
        {children}
    </dialog>;
}
