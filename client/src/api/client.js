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
// headers: extra request headers, e.g. { 'Idempotency-Key': ... } for payments.
function send(path, { method, body, query, headers }) {
    const isForm = body instanceof FormData;
    const hasBody = body !== undefined;
    const all = { ...(hasBody && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers };
    return fetch(buildUrl(path, query), {
        method,
        credentials: 'include',
        headers: Object.keys(all).length ? all : undefined,
        body: !hasBody || isForm ? body : JSON.stringify(body)
    });
}

// The server reports errors as { message } on most routes and { error } on the admin routes.
// The payment routes also send a machine-readable code, as { error: CODE, message } or { code, message }; it is kept on error.code.
function toError(response, data) {
    const error = new Error(data.message ?? data.error ?? 'Something went wrong');
    error.status = response.status;
    error.code = data.code ?? (data.message && typeof data.error === 'string' ? data.error : undefined);
    return error;
}

export async function request(path, { method = 'GET', body, query, headers } = {}) {
    let response = await send(path, { method, body, query, headers });

    if (response.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
        // The access cookie lives 15 minutes, so a 401 here usually just means it lapsed.
        if (await refreshSession()) {
            response = await send(path, { method, body, query, headers });
        } else {
            onSessionExpired();
        }
    }

    const data = await readBody(response);
    if (!response.ok) throw toError(response, data);
    return data;
}

// Fetches a file (CSV or PDF) and hands it to the browser as a download.
export async function download(path, { query, filename } = {}) {
    let response = await send(path, { method: 'GET', query });
    if (response.status === 401 && await refreshSession()) response = await send(path, { method: 'GET', query });
    if (!response.ok) throw toError(response, await readBody(response));
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename ?? 'download';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
