import { useState } from 'react';
import { listAllItems } from '../api/admin.js';
import { useAsync } from '../hooks/useAsync.js';
import { Message, PageHeader, SearchField, Spinner, Table } from '../components';

const yesNo = (value) => (value ? 'yes' : 'no');

export default function AdminItemsPage() {
    const { data, error, loading } = useAsync(listAllItems);
    const [query, setQuery] = useState('');
    // the server has no item search for admins, so the list is filtered here by name, category, owner or id
    const needle = query.toLowerCase();
    const rows = data?.items.filter((item) => !needle || [item.name, item.category, item.owner, item._id].some((value) => String(value ?? '').toLowerCase().includes(needle)));

    return (
        <>
            <PageHeader title="Community items" />
            <SearchField label="Search items" placeholder="Search by name, category or owner" onSearch={setQuery} />
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data && (
                <Table
                    rows={rows}
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
