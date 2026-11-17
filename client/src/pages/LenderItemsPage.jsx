import { useNavigate } from 'react-router-dom';
import { listMyItems, toggleArchive } from '../api/lenderItems.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Icon, ItemCard, Message, PageHeader, Spinner } from '../components';
import TiltedCard from '../components/TiltedCard.jsx';
import styles from './LenderItemsPage.module.css';

export default function LenderItemsPage() {
    const { data, error, loading, reload } = useAsync(listMyItems);
    const archive = useAction();
    const navigate = useNavigate();

    async function handleArchive(id) {
        const ok = await archive.run(() => toggleArchive(id));
        if (ok) reload();
    }

    return (
        <>
            <PageHeader title="My items" />
            {loading && !data && <Spinner />}
            <Message type="error">{error || archive.error}</Message>
            {data && (
                <div className={styles.grid}>
                    {data.items.map((item) => (
                        <ItemCard key={item._id} item={item} showView={!item.archived}
                            actions={<>
                                <Button variant="secondary" size="small" to={`/lender/items/${item._id}/edit`}>Edit</Button>
                                <Button variant="secondary" size="small" disabled={archive.pending} onClick={() => handleArchive(item._id)}>
                                    {item.archived ? 'Unarchive' : 'Archive'}
                                </Button>
                            </>} />
                    ))}
<TiltedCard containerWidth="100%" containerHeight="auto" imageWidth="100%" imageHeight="100%" style={{ aspectRatio: '3 / 4' }}
                        radius={12} rotateAmplitude={10} scaleOnHover={1.04} glare={0.35} shadow={0.35} parallax={0} showTooltip={false}
                        altText="Add a new item" captionText="Add a new item" onClick={() => navigate('/lender/items/new')}>
                        <div className={styles.free}>
                            <Icon name="plus" size={44} />
                            <span>Add an item</span>
                        </div>
                    </TiltedCard>
                </div>
            )}
        </>
    );
}
