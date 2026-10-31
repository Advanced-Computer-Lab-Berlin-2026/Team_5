import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, ProtectedRoute } from './components';
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
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminItemsPage from './pages/AdminItemsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/items" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/items" element={<CatalogPage />} />
                <Route path="/items/:id" element={<ItemDetailPage />} />

                <Route element={<ProtectedRoute />}>
                    <Route path="/wishlist" element={<WishlistPage />} />
                    <Route path="/wallet" element={<WalletPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/change-password" element={<ChangePasswordPage />} />
                    <Route path="/household" element={<HouseholdPage />} />
                </Route>

                <Route element={<ProtectedRoute adminOnly />}>
                    <Route path="/admin" element={<AdminUsersPage />} />
                    <Route path="/admin/items" element={<AdminItemsPage />} />
                </Route>

                <Route path="*" element={<NotFoundPage />} />
            </Route>
        </Routes>
    );
}
