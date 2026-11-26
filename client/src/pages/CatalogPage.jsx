import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listCategories } from '../api/categories.js';
import { listItems } from '../api/items.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, CategoryRow, EmptyState, FilterToggle, Icon, Input, ItemCard, Message, Pagination, Spinner } from '../components';
import AnimatedContent from '../components/AnimatedContent.jsx';
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
    const [filtersOpen, setFiltersOpen] = useState(Boolean(category));
    // The category row opens instantly and the results slide into their new place with a transform (which the browser can animate
    // without re-laying-out the page every frame). The results' old position is noted just before the change, then they glide from it.
    const resultsRef = useRef(null);
    const topBefore = useRef(null);
    const toggleFilters = () => {
        topBefore.current = resultsRef.current?.getBoundingClientRect().top ?? null;
        setFiltersOpen(open => !open);
    };
    useLayoutEffect(() => {
        const element = resultsRef.current;
        const before = topBefore.current;
        topBefore.current = null;
        if (!element || before === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const shift = before - element.getBoundingClientRect().top;
        if (Math.abs(shift) < 1) return;
        element.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    }, [filtersOpen]);
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
    // the grid shows `shown`, which trails the fetched data: old cards fade out first, then the new set rises in
    const [shown, setShown] = useState(null);
    const [leaving, setLeaving] = useState(false);
    const leaveStart = useRef(0);
    const items = useAsync(() => listItems({ page, limit: PAGE_SIZE, search, category }), [page, search, category]);

    useEffect(() => {
        if (items.loading && shown && !leaving) {
            leaveStart.current = Date.now();
            setLeaving(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items.loading]);
    useEffect(() => {
        if (items.loading) return undefined;
        if (!items.data) { setLeaving(false); return undefined; }
        const wait = leaving ? Math.max(0, 260 - (Date.now() - leaveStart.current)) : 0;
        const timer = window.setTimeout(() => { setShown(items.data); setLeaving(false); }, wait);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items.data, items.loading]);

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
        {(!embedded || showIntroduction) && <header className={styles.heading}><h2>Find your next possibility.</h2></header>}
        <form className={styles.search} aria-label="Search catalog" onSubmit={event => { event.preventDefault(); update({ search: searchText.trim(), page: '' }); }}>
            <div className={styles.searchField}><Icon name="search" /><Input type="search" name="search" aria-label="Search items by name" placeholder="What are you looking for?" maxLength={100} value={searchText} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => setSearchText(event.target.value)} /></div>
            <FilterToggle open={filtersOpen} activeCount={category ? 1 : 0} controls="catalog-categories" onToggle={toggleFilters} />
            <Button variant="ghost" className={!search && !category ? styles.hiddenClear : ''} disabled={!search && !category} onClick={reset}>Clear filters</Button>
        </form>
        <CategoryRow id="catalog-categories" open={filtersOpen} value={category} loading={categories.loading} options={[{ value: '', label: 'All items' }, ...(categories.data?.categories ?? []).map(entry => ({ value: entry._id, label: entry.name }))]} onChange={value => { update({ category: value, page: '' }); topBefore.current = resultsRef.current?.getBoundingClientRect().top ?? null; setFiltersOpen(false); }} />
        {categories.error && <Message>Categories could not be loaded. You can still search all items.</Message>}
        {items.loading && !items.data && <Spinner label="Finding possibilities…" />}
        <Message type="error">{items.error}</Message>
        {items.error && <div><Button variant="secondary" onClick={items.reload}>Try again</Button></div>}
        {!items.error && items.data && <section ref={resultsRef} className={styles.results} aria-label="Catalog results" aria-busy={items.loading}>
            <div className={styles.resultSummary}><p className={styles.count} aria-live="polite">{items.data.pagination.total} {items.data.pagination.total === 1 ? 'item' : 'items'} to discover</p><span className={styles.count} role="status">{items.loading ? 'Updating results…' : ''}</span></div>
            {items.data.items.length === 0 && <EmptyState title="Nothing here just yet" description={search || category ? 'Try a different search or category.' : 'Check back soon for items shared by your community.'} action={(search || category) && <Button variant="secondary" onClick={reset}>Clear filters</Button>} />}
            {shown && <div className={`${styles.stage} ${leaving ? styles.leaving : ''}`}>
                {/* keyed by the items shown, so every new result set rises into place one card after another */}
                <AnimatedContent key={shown.items.map(item => item._id).join(',')} className={styles.cards} trigger="mount" stagger={0.06} distance={28} duration={0.55} ease="power2.out">
                    {shown.items.map(item => <ItemCard key={item._id} item={item} intro={false} />)}
                </AnimatedContent>
            </div>}
            <Pagination page={items.data.pagination.page} totalPages={items.data.pagination.totalPages} onChange={next => update({ page: next > 1 ? String(next) : '' })} />
        </section>}
    </>;
}
