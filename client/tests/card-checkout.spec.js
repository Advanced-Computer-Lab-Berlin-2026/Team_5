import { expect, test } from '@playwright/test';

test('returning to checkout during confirmation keeps both payment buttons disabled', async ({ page }) => {
    test.setTimeout(60_000);
    let completed = false;
    let intents = 0;
    const entry = {
        item: { _id: 'ITM-1234abcd', name: 'Test drill', depositAmount: 25 },
        startDate: '2029-03-10', endDate: '2029-03-12'
    };
    await page.addInitScript(() => {
        localStorage.setItem('acl.user', JSON.stringify({ id: 'member1', username: 'member1', role: 'member' }));
        window.Stripe = () => ({
            elements: () => ({
                create: () => ({
                    mount() {}, destroy() {},
                    on(event, callback) { if (event === 'ready') callback(); }
                })
            }),
            confirmCardPayment: () => {
                document.body.dataset.confirming = 'true';
                return new Promise(() => {});
            }
        });
    });
    await page.route(url => url.pathname.startsWith('/api/'), route => {
        const path = new URL(route.request().url()).pathname;
        switch (path) {
            case '/api/wallet': return route.fulfill({ json: { balance: 100 } });
            case '/api/borrow-list': return route.fulfill({ json: { borrowList: completed ? [] : [entry] } });
            case '/api/wallet/checkout/quote': return route.fulfill({ json: { total: 25, totalDeposit: 25, originalTotal: 25 } });
            case '/api/stripe/payment-intent':
                intents += 1;
                return route.fulfill({ json: { paymentId: 'PAY-1234abcd', clientSecret: 'test', amount: 2500 } });
            case '/api/stripe/payments/PAY-1234abcd/status':
            case '/api/stripe/payments/PAY-1234abcd/reconcile':
                return route.fulfill({ json: {
                    status: completed ? 'completed' : 'awaiting_payment', amount: 2500,
                    reservations: completed ? ['RES-1234abcd'] : []
                } });
            default: return route.fulfill({ status: 403, json: {} });
        }
    });

    await page.goto('/borrow-list');
    await page.getByRole('button', { name: 'Pay by card' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pay', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-confirming', 'true');
    await page.goto('/items');
    await page.goto('/borrow-list');
    await expect(page.getByText('Your card payment is being confirmed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay by card' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Pay from wallet' })).toBeDisabled();
    expect(intents).toBe(1);

    completed = true;
    await expect(page.getByRole('heading', { name: 'Requests sent' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Pay by card' })).toHaveCount(0);
});
