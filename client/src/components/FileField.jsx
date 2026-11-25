import { useRef, useState } from 'react';
import { Button } from './Button.jsx';
import styles from './FormField.module.css';

// A label plus a custom "Choose file" button (the browser's own picker is hidden). onChange receives the chosen File objects as an array.
export function FileField({ label, name, hint, onChange, multiple, ...props }) {
    const inputRef = useRef(null);
    const [names, setNames] = useState([]);

    function handleChange(event) {
        const files = Array.from(event.target.files);
        setNames(files.map(file => file.name));
        onChange(files);
    }

    const summary = names.length === 0 ? 'No file chosen' : names.length === 1 ? names[0] : `${names.length} files chosen`;

    return (
        <div className={styles.field}>
            <span id={`${name}-label`} className={styles.label}>{label}</span>
            <div className={styles.picker}>
                <Button variant="secondary" onClick={() => inputRef.current?.click()}
                    aria-labelledby={`${name}-label ${name}-name`} aria-describedby={hint ? `${name}-hint` : undefined}>
                    {names.length ? (multiple ? 'Choose different files' : 'Choose a different file') : (multiple ? 'Choose files' : 'Choose file')}
                </Button>
                <span id={`${name}-name`} className={styles.fileName} title={names.join(', ')}>{summary}</span>
            </div>
            <input ref={inputRef} id={name} name={name} type="file" className={styles.nativeInput} tabIndex={-1} multiple={multiple}
                onChange={handleChange} {...props} />
            {hint && <span id={`${name}-hint`} className={styles.hint}>{hint}</span>}
        </div>
    );
}
