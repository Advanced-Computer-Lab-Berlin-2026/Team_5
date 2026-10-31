import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.js';
import { setSessionExpiredHandler } from '../api/client.js';
import { getWalletBalance } from '../api/wallet.js';
import { getUser } from '../api/admin.js';

// The server has no "who am I" route and the cookies are HttpOnly, so we remember the
// public user fields (never tokens) and re-check the session with a cheap protected call.
const STORAGE_KEY = 'acl.user';

const AuthContext = createContext(null);

function loadStoredUser() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

function saveUser(user) {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
}

// Login does not return the role. A missing user id gives 404 to admins and 403 to everyone else.
async function checkIsAdmin() {
    try {
        await getUser('role-check');
    } catch (error) {
        return error.status === 404;
    }
    return false;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(loadStoredUser);
    const [checking, setChecking] = useState(() => loadStoredUser() !== null);

    const clearUser = useCallback(() => {
        saveUser(null);
        setUser(null);
    }, []);

    useEffect(() => {
        setSessionExpiredHandler(clearUser);
    }, [clearUser]);

    // On first load, confirm the remembered user still has a valid session.
    useEffect(() => {
        if (!checking) return;
        getWalletBalance()
            .catch((error) => {
                if (error.status === 401 || error.status === 403) clearUser();
            })
            .finally(() => setChecking(false));
    }, [checking, clearUser]);

    const login = useCallback(async (username, password) => {
        const { user: published } = await authApi.login(username, password);
        const next = { ...published, isAdmin: await checkIsAdmin() };
        saveUser(next);
        setUser(next);
    }, []);

    const logout = useCallback(async () => {
        try {
            await authApi.logout();
        } finally {
            clearUser();
        }
    }, [clearUser]);

    const value = useMemo(
        () => ({ user, checking, isLoggedIn: user !== null, isAdmin: user?.isAdmin === true, login, logout }),
        [user, checking, login, logout]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside AuthProvider');
    return context;
}
