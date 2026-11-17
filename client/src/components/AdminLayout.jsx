import { Outlet } from 'react-router-dom';

// Admin pages used to have their own tab bar; those links now live in the header.
export function AdminLayout() {
    return <Outlet />;
}
