import { expect, test } from '@playwright/test';

test('admin login from a reservation link lands on the admin page', async ({ page }) => {
    const reservationPath = '/reservations/RES-1234abcd';
    const reservationRequests = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/auth/login') return route.fulfill({ json: { user: { username: 'admin1' } } });
        if (path === '/api/lender/items') return route.fulfill({ status: 403, json: {} });
        if (path === '/api/admin/users/role-check') return route.fulfill({ status: 404, json: {} });
        if (path === '/api/admin/users') return route.fulfill({ json: { users: [] } });
        if (path === '/api/notifications') return route.fulfill({ json: { notifications: [] } });
        if (path === '/api/wallet') return route.fulfill({ json: { balance: 0 } });
        if (path.startsWith('/api/reservations')) reservationRequests.push(path);
        return route.fulfill({ status: 404, json: { message: 'Not found' } });
    });

    await page.goto(reservationPath);
    const login = page.getByRole('form', { name: 'Log in' });
    await login.getByLabel('Username').fill('admin1');
    await login.getByLabel('Password').fill('Password123');
    await login.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto(reservationPath);
    await expect(page).toHaveURL(/\/admin$/);
    expect(reservationRequests).toEqual([]);
});

test('reporting damage closes chat and shows the saved report', async ({ page }) => {
    const id = 'RES-1234abcd';
    let status = 'active';
    let closedChatRequests = 0;

    await page.addInitScript(() => {
        localStorage.setItem('acl.user', JSON.stringify({ username: 'lender1', role: 'lender' }));
    });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/wallet') return route.fulfill({ json: { balance: 100 } });
        if (path === '/api/lender/items') return route.fulfill({ json: { items: [] } });
        if (path === '/api/notifications') return route.fulfill({ json: { notifications: [] } });
        if (path === '/api/borrow-list') return route.fulfill({ json: { borrowList: [] } });
        if (path === `/api/reservations/${id}`) {
            return route.fulfill({ json: { reservation: {
                _id: id, lender: 'lender1', borrower: 'member1', status,
                handover: status === 'completed' ? { returnCondition: 'damaged' } : {}
            } } });
        }
        if (path === `/api/reservations/${id}/messages`) {
            if (status === 'active') return route.fulfill({ json: { messages: [] } });
            closedChatRequests += 1;
            return route.fulfill({ status: 403, json: { message: 'Chat is only available for upcoming or active reservations' } });
        }
        if (path === `/api/lender/reservations/${id}/damage`) {
            status = 'completed';
            return route.fulfill({ status: 201, json: { report: { _id: 'DMG-1234abcd' } } });
        }
        return route.fulfill({ status: 404, json: { message: 'Not found' } });
    });

    await page.goto(`/reservations/${id}`);
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
    await page.getByLabel('What is wrong').fill('Scratched housing');
    await page.getByLabel('Details').fill('The housing was scratched on return.');
    await page.getByRole('button', { name: 'Report damage' }).click();
    await expect(page.getByRole('heading', { name: 'Damage reported' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Messages' })).toHaveCount(0);
    await expect(page.getByText('Chat is only available for upcoming or active reservations')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Damage reported' })).toBeVisible();
    expect(closedChatRequests).toBe(0);
});
