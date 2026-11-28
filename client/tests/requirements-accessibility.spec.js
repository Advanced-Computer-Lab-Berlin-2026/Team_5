import { expect, test } from '@playwright/test';

const axePath = process.env.PLAYWRIGHT_AXE_PATH;

test('browse, reserve and checkout pass automated WCAG checks', async ({ page }) => {
    test.skip(!axePath, 'Set PLAYWRIGHT_AXE_PATH to an axe-core script to run this audit.');
    const item = { _id: 'ITM-1234abcd', name: 'Test drill', category: 'Tools', depositAmount: 25 };
    const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() =>
        localStorage.setItem('acl.user', JSON.stringify({ id: 'member1', username: 'member1', role: 'member' }))
    );
    await page.route(url => url.pathname.startsWith('/api/'), route => {
        const path = new URL(route.request().url()).pathname;
        switch (path) {
            case '/api/items': return route.fulfill({ json: { items: [item], pagination: { total: 1, totalPages: 1 } } });
            case '/api/items/ITM-1234abcd': return route.fulfill({ json: { item } });
            case '/api/items/ITM-1234abcd/calendar': return route.fulfill({ json: {
                reservations: [], waitlistHolds: [{ startDate: day, endDate: end }]
            } });
            case '/api/wallet': return route.fulfill({ json: { balance: 100 } });
            case '/api/borrow-list': return route.fulfill({ json: { borrowList: [{ item, startDate: day, endDate: end }] } });
            case '/api/wallet/checkout/quote': return route.fulfill({ json: { total: 25, totalDeposit: 25, originalTotal: 25 } });
            default: return route.fulfill({ status: 403, json: {} });
        }
    });
    async function violations() {
        await page.addScriptTag({ path: axePath });
        return page.evaluate(async () => {
            const result = await window.axe.run({
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
            });
            return result.violations.map(({ id, nodes }) => ({
                id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
            }));
        });
    }
    await page.goto('/items');
    await expect(page.getByRole('heading', { name: item.name })).toBeVisible();
    const browse = await violations();

    await page.goto(`/items/${item._id}`);
    await page.getByRole('button', { name: 'Reserve', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const reserve = await violations();

    await page.goto('/borrow-list');
    await expect(page.getByRole('button', { name: 'Pay from wallet' })).toBeEnabled();
    const checkout = await violations();
    expect({ browse, reserve, checkout }).toEqual({ browse: [], reserve: [], checkout: [] });
});
