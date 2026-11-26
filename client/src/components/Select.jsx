import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import styles from './Select.module.css';

// A dropdown that matches the rest of the app. options: [{ value, label }].
// It keeps the same interface as a native <select>: value, onChange(event) with event.target.value and .name, plus id / name / disabled / aria-*.
// Keyboard: Enter, Space or the arrow keys open it; arrows move, Home / End jump, typing a letter jumps, Enter picks, Escape closes.
export function Select({ options, value, onChange, name, id, disabled, className = '', 'aria-label': ariaLabel, 'aria-describedby': describedBy, 'aria-invalid': invalid, required, ...rest }) {
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const wrapRef = useRef(null);
    const buttonRef = useRef(null);
    const listRef = useRef(null);
    const typed = useRef({ text: '', timer: 0 });
    const listId = useId();

    // a required field's empty "Choose a ..." option is only a prompt (the closed box already shows it), so it is not listed again
    const listed = options.filter(option => !(required && String(option.value) === ''));
    const current = options.find(option => String(option.value) === String(value)) ?? null;
    const currentIndex = listed.findIndex(option => String(option.value) === String(value));

    function show() {
        setHighlight(Math.max(0, currentIndex));
        setOpen(true);
    }

    function close(refocus = true) {
        setOpen(false);
        if (refocus) buttonRef.current?.focus();
    }

    function pick(index) {
        const option = listed[index];
        close();
        if (option && String(option.value) !== String(value)) onChange?.({ target: { name, value: option.value }, currentTarget: { name, value: option.value } });
    }

    useEffect(() => {
        if (!open) return undefined;
        const outside = event => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);

    // keep the highlighted row in view when there are more options than fit
    useEffect(() => {
        if (open) listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
    }, [open, highlight]);

    function handleKeyDown(event) {
        const last = listed.length - 1;
        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
            return;
        }
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        else if (event.key === 'Tab') setOpen(false);
        else if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(index => Math.min(last, index + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(index => Math.max(0, index - 1)); }
        else if (event.key === 'Home') { event.preventDefault(); setHighlight(0); }
        else if (event.key === 'End') { event.preventDefault(); setHighlight(last); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(highlight); }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            // typing jumps to the next option starting with those letters
            window.clearTimeout(typed.current.timer);
            typed.current.text += event.key.toLowerCase();
            typed.current.timer = window.setTimeout(() => { typed.current.text = ''; }, 600);
            const found = listed.findIndex(option => String(option.label).toLowerCase().startsWith(typed.current.text));
            if (found >= 0) setHighlight(found);
        }
    }

    return (
        <div ref={wrapRef} className={`${styles.wrap} ${className}`}>
            <button ref={buttonRef} id={id} type="button" className={styles.trigger} disabled={disabled}
                role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
                aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
                aria-label={ariaLabel} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required || undefined}
                onClick={() => (open ? close(false) : show())} onKeyDown={handleKeyDown} {...rest}>
                <span className={styles.value}>{current?.label ?? ''}</span>
                <span className={styles.chevron} data-open={open || undefined}><Icon name="down" size={16} /></span>
            </button>
            {name && <input type="hidden" name={name} value={value ?? ''} />}
            {open && (
                <ul ref={listRef} id={listId} role="listbox" className={styles.panel} aria-label={ariaLabel}>
                    {listed.map((option, index) => {
                        const selected = String(option.value) === String(value);
                        return (
                            <li key={String(option.value)} id={`${listId}-${index}`} role="option" aria-selected={selected}
                                className={styles.option} data-highlight={index === highlight || undefined} data-selected={selected || undefined}
                                onPointerEnter={() => setHighlight(index)} onPointerDown={event => event.preventDefault()} onClick={() => pick(index)}>
                                <span>{option.label}</span>
                                {selected && <span className={styles.check} aria-hidden="true">✓</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
