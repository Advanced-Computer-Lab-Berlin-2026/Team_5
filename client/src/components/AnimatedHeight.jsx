import { useLayoutEffect, useRef } from 'react';
import styles from './AnimatedHeight.module.css';

// Keep content mounted while smoothly following its natural height.
export function AnimatedHeight({ children, className = '' }) {
    const container = useRef(null);
    const content = useRef(null);
    useLayoutEffect(() => {
        const measure = () => {
            const height = content.current?.getBoundingClientRect().height;
            if (height !== undefined && container.current) container.current.style.height = `${height}px`;
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(content.current);
        return () => observer.disconnect();
    }, []);
    return <div ref={container} data-animated-height className={`${styles.container} ${className}`}><div ref={content} className={styles.content}>{children}</div></div>;
}
