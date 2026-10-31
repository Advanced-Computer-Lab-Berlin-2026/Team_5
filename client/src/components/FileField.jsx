import styles from './FormField.module.css';
import inputStyles from './Input.module.css';

// A label plus a file picker. onChange receives the chosen File objects as an array.
export function FileField({ label, name, hint, onChange, ...props }) {
    return (
        <div className={styles.field}>
            <label htmlFor={name} className={styles.label}>
                {label}
            </label>
            <input id={name} name={name} type="file" className={inputStyles.input}
                onChange={(event) => onChange(Array.from(event.target.files))} {...props} />
            {hint && <span className={styles.hint}>{hint}</span>}
        </div>
    );
}
