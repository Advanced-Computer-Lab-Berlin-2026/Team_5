import { Outlet } from 'react-router-dom';
import { Button } from './Button.jsx';
import { Row } from './Grid.jsx';

const LINKS = [
    ['/admin', 'Users'],
    ['/admin/items', 'Items'],
    ['/admin/lender-requests', 'Lender requests'],
    ['/admin/categories', 'Categories'],
    ['/admin/create-admin', 'New admin']
];

// Wraps every admin page with the admin menu.
export function AdminLayout() {
    return (
        <>
            <Row>
                {LINKS.map(([to, label]) => (
                    <Button key={to} variant="secondary" to={to}>{label}</Button>
                ))}
            </Row>
            <Outlet />
        </>
    );
}
