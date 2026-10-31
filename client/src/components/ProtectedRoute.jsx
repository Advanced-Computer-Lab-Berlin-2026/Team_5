import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Spinner } from './Spinner.jsx';

// Wrap routes that need a login. Pass roles (e.g. ['lender']) to also limit who may enter.
export function ProtectedRoute({ roles }) {
    const { isLoggedIn, role, checking } = useAuth();
    const location = useLocation();

    if (checking) return <Spinner />;
    if (!isLoggedIn) {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }
    if (roles && !roles.includes(role)) return <Navigate to="/" replace />;
    return <Outlet />;
}
