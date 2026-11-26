import styles from './PageSection.module.css';

// Themes belong to scroll sections, not route changes or side-by-side panels. Leave theme unset to follow the page.
export function PageSection({ theme, children, className = '', contentClassName = '', ...props }) {
    return <section data-theme={theme} className={`${styles.section} ${className}`} {...props}>
        <div className={`${styles.content} ${contentClassName}`}>{children}</div>
    </section>;
}
