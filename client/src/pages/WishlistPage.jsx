import { getWishlist, removeFromWishlist } from '../api/wishlist.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, EmptyState, Grid, ItemCard, Message, PageHeader, Spinner } from '../components';

export default function WishlistPage() {
    const { data, error, loading, reload } = useAsync(getWishlist);
    const removal = useAction();

    async function handleRemove(itemId) {
        const ok = await removal.run(() => removeFromWishlist(itemId));
        if (ok) reload();
    }

    return (
        <>
            <PageHeader title="Your wishlist" />
            {loading && <Spinner />}
            <Message type="error">{error || removal.error}</Message>
            {data?.wishlist.length === 0 && <EmptyState title="Something will catch your eye" description="Explore the catalog and save items to come back to." action={<Button to="/items">Discover items</Button>} />}
            <Grid>
                {data?.wishlist.map((item) => (
                    <ItemCard key={item._id} item={item}
                        actions={
                                <Button variant="secondary" disabled={removal.pending}
                                    onClick={() => handleRemove(item._id)}>Remove</Button>
                        } />
                ))}
            </Grid>
        </>
    );
}
