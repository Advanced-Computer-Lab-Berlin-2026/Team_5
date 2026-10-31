import { useState } from 'react';
import styles from './PhotoGallery.module.css';

// One large photo with a row of thumbnails to switch between them. photos: [{ url }]
export function PhotoGallery({ photos = [], alt }) {
    const [selected, setSelected] = useState(0);

    if (photos.length === 0) return <p className={styles.empty}>No photos yet.</p>;

    const current = photos[Math.min(selected, photos.length - 1)];
    return (
        <div className={styles.gallery}>
            <img src={current.url} alt={alt} className={styles.main} />
            {photos.length > 1 && (
                <div className={styles.thumbnails}>
                    {photos.map((photo, index) => (
                        <button key={photo.url} type="button" aria-label={`Show photo ${index + 1}`}
                            className={`${styles.thumbnail} ${photo === current ? styles.selected : ''}`}
                            onClick={() => setSelected(index)}>
                            <img src={photo.url} alt="" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
