import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
import { ItemImage } from './ItemImage.jsx';
import TiltedCard from './TiltedCard.jsx';
import { rememberGuestSpot } from './scroll/transition.js';
import styles from './ItemCard.module.css';

// Catalog card. By default a click anywhere on it flips it; the back shows the details the list
// endpoint already returned plus a button to the item page (and any extra `actions`).
// With openOnClick the card does not flip: a click opens the item page straight away.
export function ItemCard({ item, actions, extra, introDelay = 0, intro = true, showView = true, openOnClick = false }) {
    const [flipped, setFlipped] = useState(false);
    const navigate = useNavigate();
    const [opening, setOpening] = useState(false);
    const to = `/items/${encodeURIComponent(item._id)}`;
    const photoCount = item.photos?.length ?? 0;
    const stopFlip = event => event.stopPropagation();

    const front = <div className={styles.face}>
        <ItemImage src={item.photos?.[0]?.url} alt={item.name} className={styles.image} />
        {item.archived && <span className={styles.tag}>Archived</span>}
        <div className={styles.body}>
            <p className={styles.category}>{item.category}</p>
            <h2 className={styles.title}>{item.name}</h2>
        </div>
    </div>;

    const back = <div className={`${styles.face} ${styles.back}`} inert={!flipped}>
        <div className={styles.backDetails}>
            <p className={styles.category}>{item.category}</p>
            <h2 className={styles.title}>{item.name}</h2>
            <dl className={styles.facts}>
                <div><dt>Deposit</dt><dd>{item.depositAmount} ₥</dd></div>
                <div><dt>Photos</dt><dd>{photoCount}</dd></div>
                {extra && <div><dt>Dates</dt><dd>{extra}</dd></div>}
                {typeof item.archived === 'boolean' && <div><dt>Status</dt><dd>{item.archived ? 'Archived' : 'Listed'}</dd></div>}
            </dl>
            <p className={styles.hint}>Click the card to flip it back.</p>
        </div>
        {/* clicks on the buttons must not flip the card */}
        <div className={styles.actions} onClick={stopFlip}>
            {showView && <Button size="small" to={to} onClick={rememberGuestSpot}>View item <Icon name="arrow" size={16} /></Button>}
            {actions}
        </div>
    </div>;

    return <TiltedCard
        altText={item.name}
        showTooltip={false}
        containerWidth="100%"
        containerHeight="auto"
        imageWidth="100%"
        imageHeight="100%"
        style={{ aspectRatio: '3 / 4' }}
        radius={12}
        rotateAmplitude={10}
        scaleOnHover={1.04}
        glare={0.35}
        shadow={0.35}
        parallax={0}
        intro={intro}
        introDelay={introDelay}
        onFlip={setFlipped}
        backContent={openOnClick ? undefined : back}
        className={openOnClick ? `${styles.openable} ${opening ? styles.opening : ''}` : undefined}
        onClick={openOnClick ? () => {
            rememberGuestSpot();
            // the card swells and fades for a moment, then the item page opens
            if (opening) return;
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { navigate(to); return; }
            setOpening(true);
            window.setTimeout(() => navigate(to), 260);
        } : undefined}
    >{front}</TiltedCard>;
}
