import { listAllItems } from '../api/admin.js';
import { useAsync } from '../hooks/useAsync.js';
import { Message, Spinner, Table } from '../components';

const yesNo = (value) => (value ? 'yes' : 'no');

export default function AdminItemsPage() {
    const { data, error, loading } = useAsync(listAllItems);

    return (
        <>
            <h1>Admin: items</h1>
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data && (
                <Table
                    rows={data.items}
                    getRowKey={(item) => item._id}
                    empty="No items."
                    columns={[
                        { key: '_id', header: 'ID' },
                        { key: 'name', header: 'Name' },
                        { key: 'category', header: 'Category' },
                        { key: 'owner', header: 'Owner' },
                        { key: 'archived', header: 'Archived', render: (item) => yesNo(item.archived) },
                        { key: 'flagged', header: 'Flagged', render: (item) => yesNo(item.flagged) }
                    ]}
                />
            )}
        </>
    );
}
