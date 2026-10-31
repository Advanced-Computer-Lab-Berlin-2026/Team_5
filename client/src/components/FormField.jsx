import { Input } from './Input.jsx';
import styles from './FormField.module.css';

// A label plus an input. Any extra props (type, value, onChange, required...) go to the input.
export function FormField({ label, name, hint, ...inputProps }) {
    return (
        <div className={styles.field}>
            <label htmlFor={name} className={styles.label}>
                {label}
            </label>
            <Input id={name} name={name} {...inputProps} />
            {hint && <span className={styles.hint}>{hint}</span>}
        </div>
    );
}
