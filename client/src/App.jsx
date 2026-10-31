import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout, Layout, ProtectedRoute } from './components';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import ItemDetailPage from './pages/ItemDetailPage.jsx';
import WishlistPage from './pages/WishlistPage.jsx';
import WalletPage from './pages/WalletPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import HouseholdPage from './pages/HouseholdPage.jsx';
import NoticesPage from './pages/NoticesPage.jsx';
import BecomeLenderPage from './pages/BecomeLenderPage.jsx';
import LenderItemsPage from './pages/LenderItemsPage.jsx';
import LenderItemFormPage from './pages/LenderItemFormPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminItemsPage from './pages/AdminItemsPage.jsx';
import AdminLenderRequestsPage from './pages/AdminLenderRequestsPage.jsx';
import AdminLenderRequestPage from './pages/AdminLenderRequestPage.jsx';
import AdminCategoriesPage from './pages/AdminCategoriesPage.jsx';
import AdminCreateAdminPage from './pages/AdminCreateAdminPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                {/* anyone can browse; a login is only asked for when saving to the wishlist */}
                <Route path="/" element={<Navigate to="/items" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/items" element={<CatalogPage />} />
                <Route path="/items/:id" element={<ItemDetailPage />} />

                {/* any logged-in user */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/wishlist" element={<WishlistPage />} />
                    <Route path="/wallet" element={<WalletPage />} />
                    <Route path="/notices" element={<NoticesPage />} />
                    <Route path="/change-password" element={<ChangePasswordPage />} />
                </Route>

                <Route element={<ProtectedRoute roles={['member', 'lender']} />}>
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/household" element={<HouseholdPage />} />
                </Route>

                <Route element={<ProtectedRoute roles={['member']} />}>
                    <Route path="/become-lender" element={<BecomeLenderPage />} />
                </Route>

                <Route element={<ProtectedRoute roles={['lender']} />}>
                    <Route path="/lender/items" element={<LenderItemsPage />} />
                    <Route path="/lender/items/new" element={<LenderItemFormPage />} />
                    <Route path="/lender/items/:id/edit" element={<LenderItemFormPage />} />
                </Route>

                <Route element={<ProtectedRoute roles={['admin']} />}>
                    <Route element={<AdminLayout />}>
                        <Route path="/admin" element={<AdminUsersPage />} />
                        <Route path="/admin/items" element={<AdminItemsPage />} />
                        <Route path="/admin/lender-requests" element={<AdminLenderRequestsPage />} />
                        <Route path="/admin/lender-requests/:username" element={<AdminLenderRequestPage />} />
                        <Route path="/admin/categories" element={<AdminCategoriesPage />} />
                        <Route path="/admin/create-admin" element={<AdminCreateAdminPage />} />
                    </Route>
                </Route>

                <Route path="*" element={<NotFoundPage />} />
            </Route>
        </Routes>
    );
}
