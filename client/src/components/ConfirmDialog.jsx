import { useEffect, useRef } from 'react';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { Button } from './Button.jsx';
import { Message } from './Message.jsx';
import styles from './ConfirmDialog.module.css';

// An "are you sure" card in the middle of the screen, in the same amber as the other dialogs.
// The red button does the thing; the other one (or Escape, or a click outside) keeps things as they are.
// tone: 'danger' (red confirm button, the default) or 'dark' (a black confirm button, for something that is not destructive, like paying)
export function ConfirmDialog({ open, title, children, confirmLabel = 'Yes', cancelLabel = 'Keep it', pending = false, error = '', tone = 'danger', onConfirm, onClose }) {
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

    return <dialog ref={dialog} className={styles.dialog} aria-label={title}
        onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} onClose={onClose}
        onClick={event => { if (event.target === dialog.current && !pending) onClose(); }}>
        <div className={styles.body}>
            <h2>{title}</h2>
            {children && <p className={styles.text}>{children}</p>}
            <Message type="error">{error}</Message>
            <div className={styles.buttons}>
                <Button variant={tone === 'dark' ? 'primary' : 'destructive'} className={tone === 'dark' ? styles.dark : undefined} pending={pending} onClick={onConfirm}>{confirmLabel}</Button>
                <Button variant="secondary" disabled={pending} onClick={onClose}>{cancelLabel}</Button>
            </div>
        </div>
    </dialog>;
}
