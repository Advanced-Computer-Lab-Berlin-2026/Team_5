export function getHomeForRole(role) {
    return role === 'admin' ? '/admin' : '/items';
}

export function getLoginDestination(from, role) {
    return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !/^\/(login|register)(?:[/?#]|$)/.test(from)
        ? from : getHomeForRole(role);
}
