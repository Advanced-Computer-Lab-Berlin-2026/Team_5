import { useState } from 'react';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
import { ItemImage } from './ItemImage.jsx';
import TiltedCard from './TiltedCard.jsx';
import { rememberGuestSpot } from './scroll/transition.js';
import styles from './ItemCard.module.css';

// Catalog card. Click anywhere on it to flip; the back shows the details the list
// endpoint already returned plus a button to the item page (and any extra `actions`).
export function ItemCard({ item, actions, introDelay = 0, intro = true, showView = true }) {
    const [flipped, setFlipped] = useState(false);
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
        backContent={back}
    >{front}</TiltedCard>;
}
