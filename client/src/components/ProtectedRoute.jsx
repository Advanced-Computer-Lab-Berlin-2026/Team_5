import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Spinner } from './Spinner.jsx';

// Wrap routes that need a login. Add adminOnly for admin pages.
export function ProtectedRoute({ adminOnly = false }) {
    const { isLoggedIn, isAdmin, checking } = useAuth();
    const location = useLocation();

    if (checking) return <Spinner />;
    if (!isLoggedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
    return <Outlet />;
}
