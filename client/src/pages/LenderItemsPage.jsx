import { Link } from 'react-router-dom';
import { listMyItems, toggleArchive } from '../api/lenderItems.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Message, Row, Spinner, Table } from '../components';

export default function LenderItemsPage() {
    const { data, error, loading, reload } = useAsync(listMyItems);
    const archive = useAction();

    async function handleArchive(id) {
        const ok = await archive.run(() => toggleArchive(id));
        if (ok) reload();
    }

    return (
        <>
            <h1>My items</h1>
            <Row>
                <Button to="/lender/items/new">Add an item</Button>
            </Row>
            {loading && <Spinner />}
            <Message type="error">{error || archive.error}</Message>
            {data && (
                <Table
                    rows={data.items}
                    getRowKey={(item) => item._id}
                    empty="You have not listed any items yet."
                    columns={[
                        { key: 'name', header: 'Name', render: (item) => item.archived ? item.name : <Link to={`/items/${item._id}`}>{item.name}</Link> },
                        { key: 'category', header: 'Category' },
                        { key: 'depositAmount', header: 'Deposit (₥)' },
                        { key: 'photos', header: 'Photos', render: (item) => item.photos.length },
                        { key: 'status', header: 'Status', render: (item) => (item.archived ? 'archived' : 'listed') },
                        {
                            key: 'actions', header: '',
                            render: (item) => (
                                <Row>
                                    <Button variant="secondary" to={`/lender/items/${item._id}/edit`}>Edit</Button>
                                    <Button variant="secondary" disabled={archive.pending} onClick={() => handleArchive(item._id)}>
                                        {item.archived ? 'Unarchive' : 'Archive'}
                                    </Button>
                                </Row>
                            )
                        }
                    ]}
                />
            )}
        </>
    );
}
