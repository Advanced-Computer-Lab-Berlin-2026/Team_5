import { Link } from 'react-router-dom';
import styles from './Button.module.css';

// variant: 'primary' (filled) or 'secondary' (outline). Pass `to` to render a link that looks like a button.
export function Button({ variant = 'primary', to, className = '', ...props }) {
    const classes = `${styles.button} ${styles[variant]} ${className}`;
    if (to) return <Link to={to} className={classes} {...props} />;
    return <button type="button" className={classes} {...props} />;
}
