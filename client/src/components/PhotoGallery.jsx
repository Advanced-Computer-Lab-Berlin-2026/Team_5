import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button.jsx';
import { EmptyState } from './EmptyState.jsx';
import { Icon } from './Icon.jsx';
import { ItemImage } from './ItemImage.jsx';
import { Spinner } from './Spinner.jsx';
import styles from './PhotoGallery.module.css';

const FlexCarousel = lazy(() => import('./gallery/vendor/FlexCarousel.jsx'));

class GalleryBoundary extends Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { this.props.onError?.(); }
    render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function supportsWebGL() {
    try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('webgl2');
        if (!context) return false;
        context.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch { return false; }
}

export function PhotoGallery({ photos = [], alt = 'Item', edgeToEdge = false }) {
    const usable = useMemo(() => photos.filter(photo => typeof photo?.url === 'string' && photo.url), [photos]);
    const items = useMemo(() => usable.map((photo, index) => ({ src: photo.url, alt: `${alt}, photo ${index + 1}`, title: `${alt} / ${index + 1}` })), [usable, alt]);
    const [active, setActive] = useState(0);
    const [capable, setCapable] = useState(false);
    const [standard, setStandard] = useState(false);
    const [reduceMotion, setReduceMotion] = useState(false);
    const [viewer, setViewer] = useState(false);
    const [inspectionIndex, setInspectionIndex] = useState(0);
    const clicks = useRef({ index: -1, count: 0, time: 0 });
    const dialog = useRef(null);
    const stage = useRef(null);
    const selected = Math.min(active, Math.max(usable.length - 1, 0));
    const inspected = Math.min(inspectionIndex, Math.max(usable.length - 1, 0));

    useEffect(() => {
        setCapable(supportsWebGL());
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduceMotion(query.matches);
        const change = event => setReduceMotion(event.matches);
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, []);

    useEffect(() => {
        if (viewer && dialog.current && !dialog.current.open) dialog.current.showModal();
    }, [viewer]);

    if (!usable.length) return <EmptyState title="A little imagination, for now" description="This item has no photos yet." />;

    const inspect = index => { setInspectionIndex(index); setViewer(true); };
    const imageClick = index => {
        const now = performance.now();
        const previous = clicks.current;
        const count = previous.index === index && now - previous.time < 500 ? previous.count + 1 : 1;
        clicks.current = { index, count, time: now };
        if (count === 3) { clicks.current.count = 0; inspect(index); }
    };
    const inspectionKey = event => {
        if (event.key === 'Enter' || event.key.toLowerCase() === 'i') {
            event.preventDefault(); event.stopPropagation(); inspect(selected);
        }
    };
    const standardGallery = <div className={styles.standard}>
        <button type="button" className={styles.imageButton} aria-label={`Photo ${selected + 1}. Triple-click to inspect, or press Enter.`} onClick={event => { if (event.detail === 0) inspect(selected); else imageClick(selected); }}>
            <ItemImage src={usable[selected].url} alt={`${alt}, photo ${selected + 1}`} className={styles.main} loading="eager" />
        </button>
        {usable.length > 1 && <div className={styles.thumbnails} role="group" aria-label="Choose item photo">
            {usable.map((photo, index) => <button type="button" key={`${photo.url}-${index}`} className={`${styles.thumbnail} ${index === selected ? styles.selected : ''}`} aria-label={`Show photo ${index + 1}`} aria-pressed={index === selected} onClick={() => setActive(index)}><ItemImage src={photo.url} alt={`Photo ${index + 1}`} /></button>)}
        </div>}
    </div>;
    const enhanced = capable && !reduceMotion && !standard && usable.length > 1;

    return <section className={`${styles.gallery} ${edgeToEdge ? styles.edgeToEdge : ''}`} aria-label={`${alt} photos`}>
        {enhanced ? <GalleryBoundary fallback={standardGallery} onError={() => setStandard(true)} key={items.map(item => item.src).join('|')}>
            <div ref={stage} className={styles.stage} onKeyDownCapture={inspectionKey}>
                <Suspense fallback={<Spinner label="Preparing photo gallery…" />}>
                    <FlexCarousel items={items} preset="liquid" intro="fade" fit="natural" radius={8} cardHeight={0.66} gap={20} autoplay={false} captureWheel={false} focusOnClick={false} captions={false} onChange={index => setActive(index)} onImageClick={imageClick} onImageError={() => setStandard(true)} />
                </Suspense>
            </div>
        </GalleryBoundary> : standardGallery}
        <div className={styles.toolbar}>
            <div className={styles.controls}>
                <span aria-live="polite" className={styles.count}>{selected + 1} / {usable.length}</span>
            </div>
        </div>
        {capable && !reduceMotion && usable.length > 1 && <button className={styles.viewSwitch} type="button" onClick={() => setStandard(!standard)}>{standard ? 'Use liquid gallery' : 'Use standard gallery'}</button>}
        <p className={styles.hint}>{enhanced ? 'Drag to explore. ' : ''}Triple-click a photo to inspect. Keyboard: {enhanced ? 'arrow keys to browse, Enter to inspect.' : 'focus the photo and press Enter to inspect.'}</p>
        {viewer && <dialog ref={dialog} className={styles.dialog} aria-label={`${alt} full photo`} onClose={() => setViewer(false)}>
            <div className={styles.dialogToolbar}><p>Photo {inspected + 1} of {usable.length}</p><Button variant="secondary" onClick={() => dialog.current.close()} autoFocus>Close <Icon name="close" size={16} /></Button></div>
            <ItemImage src={usable[inspected].url} alt={`${alt}, photo ${inspected + 1}`} className={styles.inspection} loading="eager" />
            {usable.length > 1 && <div className={styles.controls}><Button variant="secondary" onClick={() => setInspectionIndex((inspected - 1 + usable.length) % usable.length)}>Previous</Button><Button variant="secondary" onClick={() => setInspectionIndex((inspected + 1) % usable.length)}>Next</Button></div>}
        </dialog>}
    </section>;
}
