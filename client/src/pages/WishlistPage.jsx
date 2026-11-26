import { getWaitlist, leaveWaitlist } from '../api/waitlist.js';
import { getWishlist, removeFromWishlist } from '../api/wishlist.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { formatDate } from '../utils/format.js';
import { Button, EmptyState, Grid, Icon, ItemCard, Message, PageHeader, Spinner } from '../components';

export default function WishlistPage() {
    const { data, error, loading, reload } = useAsync(getWishlist);
    const waitlist = useAsync(getWaitlist);
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
            {data?.wishlist.length === 0 && <EmptyState featured icon="heart" title="Your wishlist is empty"
                description="See something you like? Press Add to wishlist on an item to save it here, so you can find it again and reserve it when you are ready."
                action={<Button to="/items">Start discovering <Icon name="arrow" size={16} /></Button>} />}
            <Grid>
                {data?.wishlist.map((item) => (
                    <ItemCard key={item._id} item={item}
                        actions={
                                <Button variant="secondary" disabled={removal.pending}
                                    onClick={() => handleRemove(item._id)}>Remove</Button>
                        } />
                ))}
            </Grid>

            {waitlist.data?.waitlists.length > 0 && <>
                <h2>Your waitlist</h2>
                <p className="muted">We will let you know if these items free up for your dates.</p>
                <Grid>
                    {waitlist.data.waitlists.filter(entry => entry.item).map((entry) => (
                        <ItemCard key={entry._id} item={entry.item}
                            extra={`${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`}
                            actions={<Button variant="secondary" size="small" disabled={removal.pending}
                                onClick={async () => { if (await removal.run(() => leaveWaitlist(entry._id))) waitlist.reload(); }}>Leave waitlist</Button>} />
                    ))}
                </Grid>
            </>}
            <Message type="error">{waitlist.error}</Message>
        </>
    );
}
