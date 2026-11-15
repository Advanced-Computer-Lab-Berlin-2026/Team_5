import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listCategories } from '../api/categories.js';
import { listItems } from '../api/items.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Button, EmptyState, FeatureBanner, FilterDropdown, Grid, Icon, Input, ItemCard, Message, PageHeader, Pagination, Spinner } from '../components';
import styles from './CatalogPage.module.css';

const PAGE_SIZE = 12;

export default function CatalogPage({ embedded = false, showIntroduction = true }) {
    const [params, setParams] = useSearchParams();
    const rawPage = Number(params.get('page'));
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const search = params.get('search') ?? '';
    const category = params.get('category') ?? '';
    const [searchText, setSearchText] = useState(search);
    const [composing, setComposing] = useState(false);
    const { isLoggedIn } = useAuth();
    useEffect(() => setSearchText(search), [search]);
    useEffect(() => {
        if (composing || searchText.trim() === search) return;
        const timer = window.setTimeout(() => {
            setParams(previous => {
                const next = new URLSearchParams(previous);
                if (searchText.trim()) next.set('search', searchText.trim());
                else next.delete('search');
                next.delete('page');
                return next;
            }, { replace: true, preventScrollReset: true });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [searchText, search, composing, setParams]);
    const categories = useAsync(listCategories);
    const items = useAsync(() => listItems({ page, limit: PAGE_SIZE, search, category }), [page, search, category]);

    function update(changes) {
        const next = new URLSearchParams(params);
        for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        setParams(next, { preventScrollReset: true });
    }
    const reset = () => { setSearchText(''); update({ search: '', category: '', page: '' }); };

    return <>
        {!embedded && <FeatureBanner title="Make more. Borrow better." description="Discover the things you need, from the community around you." />}
        {embedded ? showIntroduction && <header className={styles.heading}><p className="eyebrow">Take a look around</p><h2>Find your next possibility.</h2><p className="muted">Browse freely. Log in when you find something worth saving.</p></header> :
            <PageHeader eyebrow={isLoggedIn ? 'Your community' : 'Open to everyone'} title="Discover the catalog" description="Useful things. New ideas. A little less to own." />}
        <form className={styles.search} aria-label="Search catalog" onSubmit={event => { event.preventDefault(); update({ search: searchText.trim(), page: '' }); }}>
            <div className={styles.searchField}><Icon name="search" /><Input type="search" name="search" aria-label="Search items by name" placeholder="What are you looking for?" maxLength={100} value={searchText} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => setSearchText(event.target.value)} /></div>
            <FilterDropdown value={category} loading={categories.loading} options={[{ value: '', label: 'All items' }, ...(categories.data?.categories ?? []).map(entry => ({ value: entry._id, label: entry.name }))]} onChange={value => update({ category: value, page: '' })} />
            <Button variant="ghost" className={!search && !category ? styles.hiddenClear : ''} disabled={!search && !category} onClick={reset}>Clear filters</Button>
        </form>
        {categories.error && <Message>Categories could not be loaded. You can still search all items.</Message>}
        {items.loading && !items.data && <Spinner label="Finding possibilities…" />}
        <Message type="error">{items.error}</Message>
        {items.error && <div><Button variant="secondary" onClick={items.reload}>Try again</Button></div>}
        {!items.error && items.data && <section className={styles.results} aria-label="Catalog results" aria-busy={items.loading}>
            <div className={styles.resultSummary}><p className={styles.count} aria-live="polite">{items.data.pagination.total} {items.data.pagination.total === 1 ? 'item' : 'items'} to discover</p><span className={styles.count} role="status">{items.loading ? 'Updating results…' : ''}</span></div>
            {items.data.items.length === 0 && <EmptyState title="Nothing here just yet" description={search || category ? 'Try a different search or category.' : 'Check back soon for items shared by your community.'} action={(search || category) && <Button variant="secondary" onClick={reset}>Clear filters</Button>} />}
            <Grid>{items.data.items.map(item => <ItemCard key={item._id} item={item} />)}</Grid>
            <Pagination page={items.data.pagination.page} totalPages={items.data.pagination.totalPages} onChange={next => update({ page: next > 1 ? String(next) : '' })} />
        </section>}
    </>;
}
