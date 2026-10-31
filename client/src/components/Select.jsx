import styles from './Input.module.css';

// options: [{ value, label }]
export function Select({ options, className = '', ...props }) {
    return (
        <select className={`${styles.input} ${className}`} {...props}>
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}
