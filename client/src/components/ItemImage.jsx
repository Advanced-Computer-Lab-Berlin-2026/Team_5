import { useState } from 'react';
import { Icon } from './Icon.jsx';
import styles from './ItemCard.module.css';

export function ItemImage({ src, alt, className = '', loading = 'lazy' }) {
    const [failedSource, setFailedSource] = useState(null);
    if (!src || failedSource === src) return <div className={`${styles.placeholder} ${className}`} role="img" aria-label={`No photo available for ${alt}`}><Icon name="box" size={40} /><span>No photo available</span></div>;
    return <img src={src} alt={alt} className={className} loading={loading} onError={() => setFailedSource(src)} />;
}
