import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAlternatives, getItem } from '../api/items.js';
import { addToWishlist } from '../api/wishlist.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { BackLink, Button, Card, DetailList, ItemCard, Message, PageHeader, PageSection, PhotoGallery, Spinner } from '../components';
import { ReserveDialog } from '../components/ReserveDialog.jsx';
import { ReportDialog } from '../components/ReportDialog.jsx';
import { cameFromGuestPage, clearGuestSpot } from '../components/scroll/transition.js';
import styles from './ItemDetailPage.module.css';

export default function ItemDetailPage() {
    const { id } = useParams();
    // opened from the guest page: the < arrow goes back there, to the same scroll position
    const [fromGuest] = useState(cameFromGuestPage);
    useEffect(() => clearGuestSpot, []);
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { isLoggedIn, isAdmin, role } = useAuth();
    const [reporting, setReporting] = useState(false);
    const { data, error, loading } = useAsync(() => getItem(id), [id]);
    const wishlist = useAction();
    const [reserving, setReserving] = useState(false);
    // similar items from the same category, shown under the details. A failure here just hides the row
    const alternatives = useAsync(() => getAlternatives(id), [id]);
    const autoAddDone = useRef(false);
    const itemId = data?.item._id;

    // A guest who clicked "Add to wishlist" comes back here after logging in with ?wishlist=add.
    // The ref makes sure it only adds once, even though React runs effects twice in development.
    useEffect(() => {
        if (!itemId || !isLoggedIn || params.get('wishlist') !== 'add' || autoAddDone.current) return;
        autoAddDone.current = true;
        setParams({}, { replace: true });
        wishlist.run(() => addToWishlist(itemId), 'Added to wishlist.');
    }, [itemId, isLoggedIn, params, setParams, wishlist.run]);

    if (loading) return <Spinner />;
    if (error) return <><Message type="error">{error}</Message><BackLink to="/items" label="Back to catalog" /></>;

    const { item } = data;

    function handleWishlist() {
        if (!isLoggedIn) {
            // straight to the login card, skipping the opening logo animation
            navigate('/login#account-access', { state: { from: `/items/${item._id}?wishlist=add` } });
            return;
        }
        wishlist.run(() => addToWishlist(item._id), 'Added to wishlist.');
    }

    function handleReserve() {
        if (!isLoggedIn) {
            navigate('/login#account-access', { state: { from: `/items/${item._id}` } });
            return;
        }
        setReserving(true);
    }

    const similar = (alternatives.data?.items ?? []).slice(0, 3);
    const manual = item.documents?.[0];

    return (
        <>
            <PageSection className={styles.enter} contentClassName={styles.gallerySection} aria-label="Item photos">
                <div className={styles.intro}>
                    <PageHeader title={item.name} backTo="/items" backLabel={fromGuest ? 'Back' : 'Back to catalog'} backHistory={fromGuest} />
                </div>
                <PhotoGallery key={item._id} photos={item.photos} alt={item.name} edgeToEdge />
            </PageSection>

            <PageSection className={`${styles.enter} ${styles.enterLater}`} contentClassName={styles.details} aria-label="Item details">
            <Card title="Details">
                <p>{item.description}</p>
                <DetailList rows={[
                    ['Category', item.category],
                    ['Deposit', `${item.depositAmount} ₥`],
                    ['Lender', item.owner && `${item.owner.name} (trust score ${item.owner.trustScore})`],
                    ['Condition', item.conditionNotes?.length ? item.conditionNotes.join('. ') : ''],
                    ['Pickup', item.pickup?.location],
                    ['Pickup instructions', item.pickup?.instructions],
                    ['Maximum days', item.borrowingRules?.maxDurationDays],
                    ['Minimum trust score', item.borrowingRules?.minTrustScore || ''],
                    ['Extra rules', item.borrowingRules?.custom?.join('. ')],
                    ['Delivery', item.delivery?.offered ? `${item.delivery.fee} ₥. ${item.delivery.details ?? ''}` : ''],
                    ['Free cancellation', item.cancellation?.freeDays ? `${item.cancellation.freeDays} days, then ${item.cancellation.forfeitPercent}% of the deposit is kept` : ''],
                    ...(item.attributes ?? []).map(({ key, value }) => [key, value])
                ]} />
            </Card>

            <div className={styles.bottom}>
                <Message type="success">{wishlist.success}</Message>
                <Message type="error">{wishlist.error}</Message>
                <div className={styles.actions}>
                    <Button className={styles.manual} fullWidth href={manual?.url} disabled={!manual} target="_blank" rel="noreferrer">{manual ? 'See the manual' : 'No manual'}</Button>
                    {!isAdmin && <>
                        <Button fullWidth disabled={wishlist.pending} onClick={handleWishlist}>Add to wishlist</Button>
                        <Button className={styles.reserve} fullWidth onClick={handleReserve}>Reserve</Button>
                    </>}
                </div>
            </div>
            {similar.length > 0 && (
                <section className={styles.similar} aria-label="Similar items">
                    <h2>You might also like</h2>
                    <div className={styles.similarGrid}>
                        {similar.map((other, index) => <ItemCard key={other._id} item={other} introDelay={index * 60} openOnClick />)}
                    </div>
                </section>
            )}
            </PageSection>
            {!isAdmin && <ReserveDialog item={item} open={reserving} onClose={() => setReserving(false)} />}
            {/* members can flag an item to the admins (the server only takes reports from members) */}
            {role === 'member' && <>
                <button type="button" className={styles.report} onClick={() => setReporting(true)}>Report this item</button>
                <ReportDialog open={reporting} targetType="item" targetId={item._id} name={item.name} onClose={() => setReporting(false)} />
            </>}
        </>
    );
}
