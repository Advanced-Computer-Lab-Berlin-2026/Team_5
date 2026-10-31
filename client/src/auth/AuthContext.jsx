import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.js';
import { setSessionExpiredHandler } from '../api/client.js';
import { getWalletBalance } from '../api/wallet.js';
import { getUser } from '../api/admin.js';
import { listMyItems } from '../api/lenderItems.js';

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

// Login does not return the role, so we find it out by asking routes that only some roles may use.
// 'lender' is the only role the lender items route lets in. Of the rest, a missing user id gives
// 404 to admins (they pass the role check) and 403 to members.
async function detectRole() {
    try {
        await listMyItems();
        return 'lender';
    } catch {
        // not a lender, so try the admin check below
    }
    try {
        await getUser('role-check');
    } catch (error) {
        return error.status === 404 ? 'admin' : 'member';
    }
    return 'member';
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

    // Look the role up again, e.g. after an admin approved a lender request.
    const refreshRole = useCallback(async () => {
        const stored = loadStoredUser();
        if (!stored) return;
        const next = { ...stored, role: await detectRole() };
        saveUser(next);
        setUser(next);
    }, []);

    // On first load, confirm the remembered user still has a valid session and refresh their role.
    useEffect(() => {
        if (!checking) return;
        (async () => {
            try {
                await getWalletBalance();
                await refreshRole();
            } catch (error) {
                if (error.status === 401 || error.status === 403) clearUser();
            } finally {
                setChecking(false);
            }
        })();
    }, [checking, clearUser, refreshRole]);

    const login = useCallback(async (username, password) => {
        const { user: published } = await authApi.login(username, password);
        const next = { ...published, role: await detectRole() };
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
        () => ({
            user,
            checking,
            role: user?.role ?? null,
            isLoggedIn: user !== null,
            isAdmin: user?.role === 'admin',
            isLender: user?.role === 'lender',
            login,
            logout,
            refreshRole
        }),
        [user, checking, login, logout, refreshRole]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside AuthProvider');
    return context;
}
