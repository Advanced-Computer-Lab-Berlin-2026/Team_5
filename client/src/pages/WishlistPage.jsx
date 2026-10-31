import { getWishlist, removeFromWishlist } from '../api/wishlist.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, Grid, Message, Spinner } from '../components';

export default function WishlistPage() {
    const { data, error, loading, reload } = useAsync(getWishlist);
    const removal = useAction();

    async function handleRemove(itemId) {
        const ok = await removal.run(() => removeFromWishlist(itemId));
        if (ok) reload();
    }

    return (
        <>
            <h1>Wishlist</h1>
            {loading && <Spinner />}
            <Message type="error">{error || removal.error}</Message>
            {data?.wishlist.length === 0 && <Message>Your wishlist is empty.</Message>}
            <Grid>
                {data?.wishlist.map((item) => (
                    <Card key={item._id} title={item.name}
                        footer={
                            <>
                                <Button variant="secondary" to={`/items/${item._id}`}>View</Button>{' '}
                                <Button variant="secondary" disabled={removal.pending}
                                    onClick={() => handleRemove(item._id)}>Remove</Button>
                            </>
                        }>
                        <p>{item.category}</p>
                        <p>Deposit: {item.depositAmount}</p>
                    </Card>
                ))}
            </Grid>
        </>
    );
}
