import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listCategories } from '../api/categories.js';
import { listItems } from '../api/items.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, Grid, Input, Message, Pagination, Row, Select, Spinner } from '../components';

const PAGE_SIZE = 12;

export default function CatalogPage() {
    // Filters live in the URL so a search can be shared or reloaded.
    const [params, setParams] = useSearchParams();
    const page = Number(params.get('page')) || 1;
    const search = params.get('search') ?? '';
    const category = params.get('category') ?? '';
    const [searchText, setSearchText] = useState(search);

    const categories = useAsync(listCategories);
    const items = useAsync(
        () => listItems({ page, limit: PAGE_SIZE, search, category }),
        [page, search, category]
    );

    function update(changes) {
        const next = new URLSearchParams(params);
        for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        setParams(next);
    }

    const categoryOptions = [
        { value: '', label: 'All categories' },
        ...(categories.data?.categories ?? []).map((entry) => ({ value: entry._id, label: entry.name }))
    ];

    return (
        <>
            <h1>Catalog</h1>
            <form onSubmit={(event) => { event.preventDefault(); update({ search: searchText.trim(), page: '' }); }}>
                <Row>
                    <Input name="search" placeholder="Search items" value={searchText}
                        onChange={(event) => setSearchText(event.target.value)} />
                    <Select name="category" value={category} options={categoryOptions}
                        onChange={(event) => update({ category: event.target.value, page: '' })} />
                    <Button type="submit">Search</Button>
                </Row>
            </form>

            {items.loading && <Spinner />}
            <Message type="error">{items.error}</Message>
            {items.data?.items.length === 0 && <Message>No items found.</Message>}
            <Grid>
                {items.data?.items.map((item) => (
                    <Card key={item._id} title={item.name}
                        footer={<Button variant="secondary" to={`/items/${item._id}`}>View</Button>}>
                        <p>{item.category}</p>
                        <p>Deposit: {item.depositAmount}</p>
                    </Card>
                ))}
            </Grid>
            {items.data && (
                <Pagination page={items.data.pagination.page} totalPages={items.data.pagination.totalPages}
                    onChange={(next) => update({ page: next > 1 ? String(next) : '' })} />
            )}
        </>
    );
}
