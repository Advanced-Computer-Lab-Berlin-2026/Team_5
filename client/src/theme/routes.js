export function getHomeForRole(role) {
    return role === 'admin' ? '/admin' : '/items';
}

// After logging in you land on Discover (admins on their Users page). The only exception is when you were on an item page and
// pressed something that needs an account there (Add to wishlist, Reserve): then you go back to that item to finish it.
// Other pages you happened to have open before (the browser's last page, or a page that asked you to log in) are not reopened.
export function getLoginDestination(from, role) {
    if (from === '/become-lender' && role === 'member') return from;
    const backToItem = typeof from === 'string' && /^\/items\/[^/?#]+(\?[^#]*)?$/.test(from);
    return backToItem && role !== 'admin' ? from : getHomeForRole(role);
}

// Which pages are shown on the dark theme for a given role. The layout and the login explosion both use this,
// so the burst can end on the same color as the page it leads to.
export function isDarkPage(role, pathname) {
    // only lenders get dark pages; members and admins stay light
    if (role !== 'lender') return false;
    return /^\/(items(\/[^/]+)?|lender\/items|wishlist|household|notices|notifications|reservations(\/[^/]+)?|bookings|membership|support|borrow-list|waitlist|settings\/email|profile|wallet|change-password)\/?(\/|$)/.test(pathname);
}
