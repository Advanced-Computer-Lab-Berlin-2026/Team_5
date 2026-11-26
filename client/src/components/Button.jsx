import { Link } from 'react-router-dom';
import styles from './Button.module.css';

// variant: 'primary' (filled) or 'secondary' (outline). Pass `to` to render a link that looks like a button.
export function Button({ variant = 'primary', to, href, size = 'medium', fullWidth = false, pending = false, disabled = false, className = '', children, ...props }) {
    const unavailable = disabled || pending;
    const classes = [styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className].filter(Boolean).join(' ');
    if (to || href) {
        // Disabled links must not retain a navigable destination.
        if (unavailable) return <span className={classes} role="link" aria-disabled="true">{children}</span>;
        if (to) return <Link to={to} className={classes} {...props}>{children}</Link>;
        return <a href={href} className={classes} {...props}>{children}</a>;
    }
    return <button type="button" className={classes} disabled={unavailable} aria-busy={pending || undefined} {...props}>{children}</button>;
}
