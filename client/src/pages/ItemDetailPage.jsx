import { Link, useParams } from 'react-router-dom';
import { getItem } from '../api/items.js';
import { addToWishlist } from '../api/wishlist.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, Message, Spinner } from '../components';

export default function ItemDetailPage() {
    const { id } = useParams();
    const { isLoggedIn } = useAuth();
    const { data, error, loading } = useAsync(() => getItem(id), [id]);
    const wishlist = useAction();

    if (loading) return <Spinner />;
    if (error) return <><Message type="error">{error}</Message><Link to="/items">Back to catalog</Link></>;

    const { item } = data;
    return (
        <>
            <p><Link to="/items">Back to catalog</Link></p>
            <Card title={item.name}>
                <p>Category: {item.category}</p>
                <p>Deposit: {item.depositAmount}</p>
                {item.description && <p>{item.description}</p>}
                {item.conditionNotes && <p>Condition: {item.conditionNotes}</p>}
                {item.owner && <p>Lender: {item.owner.name} (trust score {item.owner.trustScore})</p>}
                <Message type="success">{wishlist.success}</Message>
                <Message type="error">{wishlist.error}</Message>
                {isLoggedIn ? (
                    <Button disabled={wishlist.pending}
                        onClick={() => wishlist.run(() => addToWishlist(item._id), 'Added to wishlist.')}>
                        Add to wishlist
                    </Button>
                ) : (
                    <p><Link to="/login" state={{ from: `/items/${item._id}` }}>Log in</Link> to save this item.</p>
                )}
            </Card>
        </>
    );
}
