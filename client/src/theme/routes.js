export function getHomeForRole(role) {
    return role === 'admin' ? '/admin' : '/items';
}

export function getLoginDestination(from, role) {
    return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !/^\/(login|register)(?:[/?#]|$)/.test(from)
        ? from : getHomeForRole(role);
}

// Which pages are shown on the dark theme for a given role. The layout and the login explosion both use this,
// so the burst can end on the same color as the page it leads to.
export function isDarkPage(role, pathname) {
    // only lenders get dark pages; members and admins stay light
    if (role !== 'lender') return false;
    return /^\/(items(\/[^/]+)?|lender\/items|wishlist|household|notices|notifications|reservations(\/[^/]+)?|bookings|membership|support|settings\/email|profile|wallet|change-password)\/?(\/|$)/.test(pathname);
}
