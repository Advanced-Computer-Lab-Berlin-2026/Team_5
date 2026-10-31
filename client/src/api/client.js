// The only place in the app that calls fetch.
// Cookies are HttpOnly, so we never read tokens here; the browser sends them for us.

const REFRESH_PATH = '/api/auth/refresh';
// A 401 from these means "wrong credentials", not "session expired", so they never trigger a refresh.
const NO_REFRESH_PATHS = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/forget-password',
    '/api/auth/verify-reset-otp',
    '/api/auth/reset-password',
    REFRESH_PATH
];

let refreshInFlight = null;
let onSessionExpired = () => {};

// AuthContext registers itself here so a failed refresh can log the user out of the UI.
export function setSessionExpiredHandler(handler) {
    onSessionExpired = handler;
}

// Every 401 at the same moment shares one refresh call instead of starting several.
function refreshSession() {
    refreshInFlight ??= fetch(REFRESH_PATH, { method: 'POST', credentials: 'include' })
        .then((response) => response.ok)
        .catch(() => false)
        .finally(() => {
            refreshInFlight = null;
        });
    return refreshInFlight;
}

function buildUrl(path, query) {
    if (!query) return path;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') params.set(key, value);
    }
    const text = params.toString();
    return text ? `${path}?${text}` : path;
}

async function readBody(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

// FormData (file uploads) is sent as is, so the browser sets the multipart boundary itself.
function send(path, { method, body, query }) {
    const isForm = body instanceof FormData;
    const hasBody = body !== undefined;
    return fetch(buildUrl(path, query), {
        method,
        credentials: 'include',
        headers: hasBody && !isForm ? { 'Content-Type': 'application/json' } : undefined,
        body: !hasBody || isForm ? body : JSON.stringify(body)
    });
}

// The server reports errors as { message } on most routes and { error } on the admin routes.
function toError(response, data) {
    const error = new Error(data.message ?? data.error ?? 'Something went wrong');
    error.status = response.status;
    return error;
}

export async function request(path, { method = 'GET', body, query } = {}) {
    let response = await send(path, { method, body, query });

    if (response.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
        // The access cookie lives 15 minutes, so a 401 here usually just means it lapsed.
        if (await refreshSession()) {
            response = await send(path, { method, body, query });
        } else {
            onSessionExpired();
        }
    }

    const data = await readBody(response);
    if (!response.ok) throw toError(response, data);
    return data;
}
