import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import styles from './ItemCard.module.css';

// A photo that fades (and settles from slightly zoomed in) as it finishes loading, instead of popping in.
export function ItemImage({ src, alt, className = '', loading = 'lazy' }) {
    const [failedSource, setFailedSource] = useState(null);
    const [loadedSource, setLoadedSource] = useState(null);
    const imageRef = useRef(null);
    // a photo that is already in the cache can finish before React attaches onLoad
    useEffect(() => {
        const image = imageRef.current;
        if (image?.complete && image.naturalWidth > 0) setLoadedSource(src);
    }, [src]);
    if (!src || failedSource === src) return <div className={`${styles.placeholder} ${className}`} role="img" aria-label={`No photo available for ${alt}`}><Icon name="box" size={40} /><span>No photo available</span></div>;
    return <img ref={imageRef} src={src} alt={alt} className={`${className} ${styles.fadeImage} ${loadedSource === src ? styles.loadedImage : ''}`} loading={loading}
        onLoad={() => setLoadedSource(src)} onError={() => setFailedSource(src)} />;
}
