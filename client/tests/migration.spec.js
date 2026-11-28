import { expect, test } from '@playwright/test';

const camera = {
    _id: 'ITM-1a2b3c01', name: 'Camera kit', category: 'Photography', depositAmount: 200,
    description: 'A camera and two lenses for your next idea.',
    photos: [{ url: '/test-photo-front.svg' }, { url: '/test-photo-back.svg' }, { url: '/test-photo-lens.svg' }],
    owner: { name: 'Alex', trustScore: 90 }, pickup: { location: 'Community hall' },
    conditionNotes: ['Lightly used'], documents: [], borrowingRules: { maxDurationDays: 7 },
};
const drill = { ...camera, _id: 'ITM-1a2b3c02', name: 'Cordless drill', category: 'Tools', photos: [] };

async function mockApi(page, { role = 'member', failCatalog = false } = {}) {
    const calls = [];
    let catalogFailed = failCatalog;
    await page.route('**/test-photo-*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#b7ab91"/><rect x="170" y="100" width="260" height="180" rx="10" fill="#333"/><circle cx="300" cy="190" r="60" fill="#111"/></svg>' }));
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const reply = (body, status = 200) => route.fulfill({ status, json: body });
        calls.push({ path, search: url.search, method: request.method(), body: request.postDataJSON() });
        if (path === '/api/auth/login') return reply({ user: { username: 'alex', name: 'Alex', email: 'alex@example.com' } });
        if (path === '/api/auth/register') return reply({ message: 'Registered' }, 201);
        if (path === '/api/auth/logout') return reply({ message: 'Logged out' });
        if (path === '/api/categories') return reply({ categories: [{ _id: 'Photography', name: 'Photography' }, { _id: 'Tools', name: 'Tools' }] });
        if (path === '/api/items') {
            if (catalogFailed) { catalogFailed = false; return reply({ message: 'Catalog is temporarily unavailable.' }, 503); }
            const search = url.searchParams.get('search') ?? '';
            const category = url.searchParams.get('category');
            const items = [camera, drill].filter(item => item.name.toLowerCase().includes(search.toLowerCase()) && (!category || item.category === category));
            return reply({ items, pagination: { total: items.length, page: 1, totalPages: 1, limit: 12 } });
        }
        if (path.startsWith('/api/items/')) return reply({ item: path.endsWith('02') ? drill : camera });
        if (path === '/api/lender/items') return role === 'lender' ? reply({ items: [camera] }) : reply({ message: 'Forbidden' }, 403);
        if (path === '/api/admin/users/role-check') return reply({ message: role === 'admin' ? 'Not found' : 'Forbidden' }, role === 'admin' ? 404 : 403);
        if (path === '/api/wallet') return reply({ balance: 350 });
        if (path === '/api/wishlist') return reply({ wishlist: [camera] });
        if (path.startsWith('/api/wishlist/')) return reply({ message: 'Saved' });
        if (path === '/api/admin/users') return reply({ users: [{ _id: 'alex', username: 'alex', role: 'member', profile: { name: 'Alex', email: 'alex@example.com' } }] });
        if (path === '/api/admin/items') return reply({ items: [{ ...camera, owner: 'alex' }] });
        if (path === '/api/admin/lender-requests') return reply([]);
        if (path === '/api/notices') return reply({ notices: [] });
        if (path === '/api/household/links') return reply({ links: [] });
        if (path === '/api/household/requests/incoming') return reply({ requests: [] });
        if (path === '/api/lender-requests') return reply({ status: 'none', documents: [] });
        return reply({ message: `Unmocked: ${path}` }, 404);
    });
    return calls;
}

async function signIn(page) {
    if (await page.getByRole('form', { name: 'Log in', exact: true }).count() === 0) {
        await page.evaluate(() => document.getElementById('account-access')?.scrollIntoView({ block: 'start' }));
    }
    const form = page.getByRole('form', { name: 'Log in', exact: true });
    await form.getByRole('textbox', { name: 'Username', exact: true }).fill('alex');
    await form.getByLabel('Password', { exact: true }).fill('Password1');
    await form.getByRole('button', { name: 'Log in', exact: true }).click();
}

test('compound entry keeps guest search while switching login and registration', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome to/ })).toBeVisible();
    await page.getByRole('button', { name: 'Scroll to login', exact: true }).click();
    await page.getByRole('button', { name: 'Scroll to browse as guest', exact: true }).click();
    await expect(page.locator('#guest-catalog')).toBeInViewport();
    await page.getByRole('searchbox').fill('camera');
    await expect(page.getByRole('heading', { name: 'Camera kit', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cordless drill', exact: true })).toHaveCount(0);
    await page.evaluate(() => document.getElementById('account-access').scrollIntoView({ block: 'start' }));
    await page.getByRole('region', { name: 'Log in', exact: true }).getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page).toHaveURL(/\/register\?search=camera/);
    await expect(page.getByLabel('Full name')).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveValue('camera');
    await expect(page.locator('section[aria-label="Log in"]')).toHaveAttribute('inert', '');
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/compound-register.png', fullPage: true });
});

async function fillRegistration(page) {
    const registration = page.getByRole('form', { name: 'Register', exact: true });
    await registration.getByLabel(/^Username/).fill('alex');
    await registration.getByLabel(/^Full name/).fill('Alex Example');
    await registration.getByLabel(/^Email/).fill('alex@example.com');
    await registration.getByLabel(/^Password/).fill('Password1');
    await registration.getByLabel(/^Phone/).fill('+491701234567');
    await registration.getByLabel(/^Home address/).fill('Example street 1');
    await registration.getByRole('button', { name: 'Create account', exact: true }).click();
}

test('registration submits all required fields and signs the member in', async ({ page }) => {
    const calls = await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/register#account-access');
    await fillRegistration(page);
    await expect(page).toHaveURL(/\/items$/);
    expect(calls.find(call => call.path === '/api/auth/register').body).toEqual({ username: 'alex', name: 'Alex Example', email: 'alex@example.com', password: 'Password1', phoneNumber: '+491701234567', homeAddress: 'Example street 1' });
});

test('a guest can register and continue to the lender application', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('link', { name: 'Apply to become a lender' }).click();
    await fillRegistration(page);
    await expect(page).toHaveURL(/\/become-lender$/);
    await expect(page.getByRole('heading', { name: 'Become a lender', exact: true })).toBeVisible();
});

test('guest wishlist returns to the item and saves once after login', async ({ page }) => {
    const calls = await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/items/ITM-1a2b3c01');
    await expect(page.getByRole('heading', { name: 'Camera kit' })).toBeVisible();
    await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click();
    await expect(page).toHaveURL(/\/login#account-access$/);
    await signIn(page);
    await expect(page).toHaveURL(/\/items\/ITM-1a2b3c01$/);
    await expect(page.getByText('Added to wishlist.')).toBeVisible();
    expect(calls.filter(call => call.path === '/api/wishlist/ITM-1a2b3c01' && call.method === 'POST')).toHaveLength(1);
});

test('edge-to-edge liquid gallery uses keyboard browsing and double-click inspection', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockApi(page);
    await page.goto('/items/ITM-1a2b3c01');
    await expect(page.locator('[aria-roledescription="carousel"] canvas')).toBeVisible();
    const carousel = page.locator('[aria-roledescription="carousel"]');
    await carousel.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/liquid-gallery.png', fullPage: true });
    await expect(page.getByRole('button', { name: 'Inspect photo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next photo', exact: true })).toHaveCount(0);
    const canvas = carousel.locator('canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds.x).toBeCloseTo(0, 0);
    expect(bounds.width).toBeCloseTo(page.viewportSize().width, 0);
    await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 }, clickCount: 2, delay: 60 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('img')).toHaveCSS('object-fit', 'contain');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('[aria-roledescription="carousel"] canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show photo 3' })).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/item-detail.png', fullPage: true });
});

test('reduced motion and no-photo items have useful gallery fallbacks', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/items/ITM-1a2b3c01');
    await expect(page.getByRole('button', { name: 'Show photo 2' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show photo 2' }).click();
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
    await page.goto('/items/ITM-1a2b3c02');
    await expect(page.getByText('This item has no photos yet.')).toBeVisible();
});

test('a failed WebGL texture switches to the normal image gallery', async ({ page }) => {
    await mockApi(page);
    await page.route('**/test-photo-back.svg', route => route.fulfill({ status: 404, body: '' }));
    await page.goto('/items/ITM-1a2b3c01');
    await expect(page.getByRole('button', { name: 'Show photo 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Show photo 2' }).click();
    await expect(page.getByRole('img', { name: /No photo available for Camera kit/ })).toBeVisible();
    await page.getByRole('button', { name: 'Show photo 3' }).click();
    await expect(page.getByText('3 / 3', { exact: true })).toBeVisible();
});

test('failed login leaves guest browsing usable and does not refresh wrong credentials', async ({ page }) => {
    const calls = await mockApi(page);
    await page.route('**/api/auth/login', route => route.fulfill({ status: 401, json: { message: 'Invalid username or password' } }));
    await page.goto('/login');
    await signIn(page);
    await expect(page.getByRole('alert')).toContainText('Invalid username or password');
    await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Scroll to browse as guest', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Camera kit', exact: true })).toBeVisible();
    expect(calls.filter(call => call.path === '/api/auth/refresh')).toHaveLength(0);
});

test('catalog errors can be retried and filters yield useful empty states', async ({ page }) => {
    await mockApi(page);
    // StrictMode repeats mount requests; intercept both until the explicit retry.
    let allow = false;
    await page.route(url => url.pathname === '/api/items', async route => allow ? route.fallback() : route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } }));
    await page.goto('/items');
    await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');
    allow = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Camera kit', exact: true })).toBeVisible();
    await page.getByRole('searchbox').fill('no-match');
    await expect(page.getByRole('heading', { name: 'Nothing here just yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Camera kit', exact: true })).toBeVisible();
});

for (const role of ['member', 'lender', 'admin']) {
    test(`${role} login preserves role navigation and loads management screens`, async ({ page }) => {
        await mockApi(page, { role });
        await page.goto('/login');
        await signIn(page);
        await expect(page).toHaveURL(role === 'admin' ? /\/admin$/ : /\/items$/);
        if (role === 'admin') {
            await expect(page.getByRole('heading', { name: 'Community members' })).toBeVisible();
            await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Items', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Community items' })).toBeVisible();
        } else if (role === 'lender') {
            await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My items' }).click();
            await page.getByRole('button', { name: 'Camera kit', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
        } else {
            await page.getByRole('button', { name: 'Open settings menu' }).click();
            await page.getByRole('link', { name: 'Go to your wallet', exact: true }).click();
            await expect(page.getByText('350')).toBeVisible();
            await page.getByRole('link', { name: 'Household', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Your household', exact: true }).first()).toBeVisible();
        }
    });
}

test('mobile entry and navigation fit a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Scroll to login', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Scroll to browse as guest', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await signIn(page);
    await expect(page).toHaveURL(/\/items$/);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: 'Wishlist', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your wishlist' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/mobile-wishlist.png', fullPage: true });
    await page.getByRole('button', { name: 'Open settings menu' }).click();
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: 'Scroll to login', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Log in', exact: true })).toBeInViewport();
});

test('search waits for 300ms of inactivity and filters are tucked into a dropdown', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/items');
    await expect(page.getByRole('heading', { name: 'Camera kit', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search items' })).toHaveCount(0);
    const filters = page.getByRole('button', { name: /^Filters(?: \d+)?$/ });
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await filters.click();
    await page.getByRole('button', { name: 'Photography', exact: true }).click();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(/category=Photography/);
    await page.clock.install();
    await page.getByRole('searchbox').fill('c');
    await page.clock.runFor(200);
    await page.getByRole('searchbox').fill('camera');
    await page.clock.runFor(299);
    expect(calls.filter(call => call.path === '/api/items' && new URLSearchParams(call.search).has('search'))).toHaveLength(0);
    await page.clock.runFor(1);
    await expect(page).toHaveURL(/search=camera/);
    expect(calls.filter(call => call.path === '/api/items' && new URLSearchParams(call.search).get('search') === 'camera')).toHaveLength(1);
    await expect(page.getByRole('searchbox')).toHaveValue('camera');
});

test('account and guest sections use their own themes and item details remain visible', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login#account-access');
    const login = page.getByRole('region', { name: 'Welcome to In-Your-Shed' });
    const guest = page.locator('#guest-catalog');
    await expect(login).toHaveAttribute('data-theme', 'dark');
    await expect(guest).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Scroll to browse as guest', exact: true }).click();
    await expect(guest).toBeInViewport();
    await page.goto('/items/ITM-1a2b3c01');
    await expect(page.getByRole('region', { name: 'Item photos' })).toBeVisible();
    const details = page.locator('section[aria-label="Item details"]');
    await expect(details.getByText('Community hall')).toBeVisible();
    await expect(details.getByRole('button', { name: 'Add to wishlist' })).toBeVisible();
    await page.screenshot({ path: 'test-results/item-sections.png', fullPage: true });
});

test('welcome expands with scroll before account access and guest browsing', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const welcome = page.getByRole('region', { name: 'Welcome to In-Your-Shed', exact: true });
    const logo = welcome.getByRole('img', { name: /In Your Shed/ });
    await expect(logo).toBeInViewport();
    await expect(page.getByRole('banner')).toHaveCount(0);
    const title = await logo.boundingBox();
    expect(Math.abs(title.y + title.height / 2 - page.viewportSize().height / 2)).toBeLessThan(50);
    await expect(page.getByRole('form', { name: 'Log in', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/welcome-initial.png' });
    await page.getByRole('button', { name: 'Scroll to login', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Log in', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/welcome-expanded.png' });
    await expect(page.getByRole('form', { name: 'Log in', exact: true })).toBeInViewport();
    await expect(welcome.getByRole('link', { name: 'Log in / Register', exact: true })).toHaveCount(0);
    await expect(page.getByRole('banner')).toHaveCount(0);
    await page.getByRole('form', { name: 'Log in', exact: true }).getByLabel('Username', { exact: true }).fill('alex');
    await page.getByRole('button', { name: 'Scroll to browse as guest', exact: true }).click();
    await expect(page.locator('#guest-catalog')).toBeInViewport();
    await page.getByRole('searchbox').fill('camera');
    await expect(page).toHaveURL(/search=camera/);
    await expect(page.locator('#guest-catalog')).toBeInViewport();
});

test('expanded registration fits its content and scrolls naturally into guest browsing on mobile', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Scroll to login', exact: true }).click();
    await page.getByRole('region', { name: 'Log in', exact: true }).getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Register', exact: true })).toBeVisible();
    await page.getByLabel(/^Home address/).fill('Example street');
    await page.getByRole('button', { name: 'Create account', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeInViewport();
    expect(await page.locator('.scroll-expand__stage').evaluate(element => element.getBoundingClientRect().height > window.innerHeight)).toBe(true);
    await page.screenshot({ path: 'test-results/expanded-register-mobile.png' });
    await page.getByRole('button', { name: 'Scroll to browse as guest', exact: true }).click();
    await expect(page.locator('#guest-catalog')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('banner')).toHaveCount(0);
});

test('direct account links skip the welcome and reduced motion removes the pinned expansion', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('img', { name: /In Your Shed/ })).toBeInViewport();
    await expect(page.locator('.scroll-expand')).toHaveCount(0);
    await page.getByRole('button', { name: 'Scroll to login', exact: true }).click();
    await expect(page.locator('#account-access')).toBeInViewport();
    await page.goto('/register#account-access');
    await expect(page.locator('#account-access')).toBeInViewport();
    await page.getByRole('button', { name: 'Create account', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Scroll to browse as guest', exact: true }).click();
    await page.getByRole('searchbox').fill('camera');
    await expect(page).toHaveURL(/\/register\?search=camera/);
    await expect(page.locator('#guest-catalog')).toBeInViewport();
});

test('flipping the account form preserves login values', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login#account-access');
    const login = page.getByRole('form', { name: 'Log in', exact: true });
    await login.getByLabel('Username', { exact: true }).fill('alex');
    await page.getByRole('region', { name: 'Log in', exact: true }).getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Register', exact: true })).toBeInViewport();
    await page.getByRole('region', { name: 'Register', exact: true }).getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(login.getByLabel('Username', { exact: true })).toHaveValue('alex');
});

test('search updates retain existing results and scroll position until the response arrives', async ({ page }) => {
    await mockApi(page);
    let release;
    const delayedResponse = new Promise(resolve => { release = resolve; });
    await page.route(url => url.pathname === '/api/items' && url.searchParams.get('search') === 'camera', async route => { await delayedResponse; await route.fallback(); });
    await page.goto('/login#guest-catalog');
    const oldCard = page.getByRole('button', { name: 'Camera kit', exact: true });
    await expect(oldCard).toBeVisible();
    await page.getByRole('searchbox').fill('camera');
    const before = await page.evaluate(() => window.scrollY);
    await expect(page.getByText('Updating results…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cordless drill', exact: true })).toBeVisible();
    await expect(oldCard).toBeVisible();
    expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(2);
    release();
    await expect(page.getByText('Updating results…')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Cordless drill', exact: true })).toHaveCount(0);
    await expect(oldCard).toBeVisible();
    expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(2);
    await expect(page.getByRole('searchbox')).toBeFocused();
});

test('guest introduction appears before the catalog and links to lender onboarding', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login#guest-catalog');
    const intro = page.getByRole('region', { name: 'Guest introduction', exact: true });
    await expect(intro.getByRole('heading')).toBeVisible();
    await expect(intro.getByRole('link', { name: 'Apply to become a lender' })).toHaveAttribute('href', '/register#account-access');
    const introBox = await intro.boundingBox();
    const catalog = await page.getByRole('region', { name: 'Browse items' }).boundingBox();
    expect(introBox.y).toBeLessThan(catalog.y);
});

test('registration has three desktop columns and one mobile column', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/register#account-access');
    const form = page.getByRole('form', { name: 'Register', exact: true });
    const fields = form.locator('fieldset');
    const columns = () => fields.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    await expect.poll(columns).toBe(3);
    await page.screenshot({ path: 'test-results/register-desktop-columns.png' });
    await page.setViewportSize({ width: 375, height: 812 });
    const username = form.getByLabel(/^Username/);
    const fullName = form.getByLabel(/^Full name/);
    await expect.poll(async () => (await fullName.boundingBox()).y - (await username.boundingBox()).y).toBeGreaterThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('guest introduction reveals words while scrolling within the extended gradient', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const intro = page.getByRole('region', { name: 'Guest introduction', exact: true });
    const heading = intro.getByRole('heading', { name: 'Find your next possibility.', exact: true });
    const piece = heading.locator('.scroll-reveal-piece').first();
    await expect(piece).toHaveCSS('opacity', '0.15');
    await page.evaluate(() => {
        const section = document.querySelector('[aria-label="Guest introduction"]');
        window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + section.clientHeight * 0.65);
    });
    await expect.poll(() => piece.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.75);
    await expect(heading).toBeInViewport();
    expect(await page.getByRole('heading', { name: 'Find your next possibility.', exact: true }).count()).toBe(1);
    await page.screenshot({ path: 'test-results/guest-scroll-reveal.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(piece).toHaveCSS('filter', 'none');
    await expect(piece).toHaveCSS('opacity', '1');
});
