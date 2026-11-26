import { Input } from './Input.jsx';
import { Select } from './Select.jsx';
import { TextArea } from './TextArea.jsx';
import styles from './FormField.module.css';

const CONTROLS = { input: Input, textarea: TextArea, select: Select };

// A label plus a control. `as` picks 'input' (default), 'textarea' or 'select'.
// Any extra props (type, value, onChange, options, required...) go to the control.
export function FormField({ label, name, hint, error, as = 'input', ...controlProps }) {
    const Control = CONTROLS[as];
    return (
        <div className={styles.field}>
            <label htmlFor={name} className={styles.label}>
                {label}
            </label>
            <Control id={name} name={name} aria-invalid={error ? true : undefined}
                aria-describedby={[hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ') || undefined} {...controlProps} />
            {hint && <span id={`${name}-hint`} className={styles.hint}>{hint}</span>}
            {error && <span id={`${name}-error`} role="alert">{error}</span>}
        </div>
    );
}
