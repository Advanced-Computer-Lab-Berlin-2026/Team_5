import { expect, test } from '@playwright/test';

test('waitlist dates are blocked until the hold is released', async ({ page }) => {
    const item = { _id: 'ITM-1234abcd', name: 'Test drill', category: 'Tools', depositAmount: 25 };
    let held = true;
    await page.clock.setFixedTime(new Date('2035-07-01T10:00:00Z'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
        localStorage.setItem('acl.user', JSON.stringify({ id: 'member1', username: 'member1', role: 'member' }));
    });
    await page.route(url => url.pathname.startsWith('/api/'), route => {
        const path = new URL(route.request().url()).pathname;
        switch (path) {
            case '/api/wallet': return route.fulfill({ json: { balance: 100 } });
            case '/api/borrow-list': return route.fulfill({ json: { borrowList: [] } });
            case '/api/items/ITM-1234abcd': return route.fulfill({ json: { item } });
            case '/api/items/ITM-1234abcd/calendar': return route.fulfill({ json: {
                reservations: [],
                waitlistHolds: held ? [{ startDate: '2035-07-10', endDate: '2035-07-13' }] : []
            } });
            default: return route.fulfill({ status: 403, json: {} });
        }
    });

    await page.goto(`/items/${item._id}`);
    await page.getByRole('button', { name: 'Reserve', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reserve Test drill' });
    await expect(dialog).toBeInViewport();
    await expect(dialog.getByRole('button', { name: /July 10, 2035, held for waitlist/ })).toBeDisabled();

    await dialog.getByRole('button', { name: /July 9, 2035/ }).click();
    await expect(dialog.getByRole('button', { name: /July 13, 2035/ })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    held = false;
    await page.getByRole('button', { name: 'Reserve', exact: true }).click();
    const available = dialog.getByRole('button', { name: /July 10, 2035/ });
    await expect(available).toBeEnabled();
    await available.focus();
    await available.press('Enter');
    await expect(available).toHaveAttribute('aria-pressed', 'true');
});

test('adding held dates from the waitlist keeps the hold through checkout', async ({ page }) => {
    const item = { _id: 'ITM-1234abcd', name: 'Test drill', category: 'Tools', depositAmount: 25 };
    await page.clock.setFixedTime(new Date('2035-07-01T10:00:00Z'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
        localStorage.setItem('acl.user', JSON.stringify({ id: 'member1', username: 'member1', role: 'member' }));
    });
    let leftWaitlist = false;
    await page.route(url => url.pathname.startsWith('/api/'), route => {
        const path = new URL(route.request().url()).pathname;
        switch (path) {
            case '/api/wallet': return route.fulfill({ json: { balance: 100 } });
            case '/api/borrow-list': return route.fulfill({ json: { borrowList: [] } });
            case '/api/borrow-list/ITM-1234abcd': return route.fulfill({ status: 201, json: { message: 'Added' } });
            case '/api/waitlist': return route.fulfill({ json: { waitlists: [{
                _id: 'WTL-1234abcd', item, startDate: '2035-07-10', endDate: '2035-07-13', canReserve: true
            }] } });
            case '/api/waitlist/WTL-1234abcd':
                leftWaitlist = true;
                return route.fulfill({ json: { message: 'Left' } });
            default: return route.fulfill({ status: 403, json: {} });
        }
    });

    await page.goto('/waitlist');
    await page.getByRole('button', { name: 'Test drill', exact: true }).click();
    const added = page.waitForResponse(response => response.url().endsWith('/api/borrow-list/ITM-1234abcd'));
    await page.getByRole('button', { name: 'Reserve these dates' }).click();
    await added;
    await expect(page.getByText(/Go to checkout to finish your reservation/)).toBeVisible();
    await expect(page.getByText('Free now')).toBeVisible();
    expect(leftWaitlist).toBe(false);
});
