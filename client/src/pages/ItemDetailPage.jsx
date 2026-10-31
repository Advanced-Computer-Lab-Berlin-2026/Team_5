import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getItem } from '../api/items.js';
import { addToWishlist } from '../api/wishlist.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, DetailList, Message, PhotoGallery, Spinner } from '../components';

export default function ItemDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { isLoggedIn, isAdmin } = useAuth();
    const { data, error, loading } = useAsync(() => getItem(id), [id]);
    const wishlist = useAction();
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
    if (error) return <><Message type="error">{error}</Message><Link to="/items">Back to catalog</Link></>;

    const { item } = data;

    function handleWishlist() {
        if (!isLoggedIn) {
            navigate('/login', { state: { from: `/items/${item._id}?wishlist=add` } });
            return;
        }
        wishlist.run(() => addToWishlist(item._id), 'Added to wishlist.');
    }

    return (
        <>
            <p><Link to="/items">Back to catalog</Link></p>
            <h1>{item.name}</h1>
            <PhotoGallery photos={item.photos} alt={item.name} />

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
                {item.documents?.length > 0 && (
                    <p><a href={item.documents[0].url} target="_blank" rel="noreferrer">Open the manual</a></p>
                )}
            </Card>

            {!isAdmin && (
                <Card title="Wishlist">
                    <Message type="success">{wishlist.success}</Message>
                    <Message type="error">{wishlist.error}</Message>
                    {!isLoggedIn && <p>You can browse freely. You will be asked to log in or register to save this item.</p>}
                    <div>
                        <Button disabled={wishlist.pending} onClick={handleWishlist}>Add to wishlist</Button>
                    </div>
                </Card>
            )}
        </>
    );
}
