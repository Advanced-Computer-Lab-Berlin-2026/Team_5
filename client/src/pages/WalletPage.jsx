import { Link } from 'react-router-dom';
import { getLateFees, getWalletBalance } from '../api/wallet.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Message, PageHeader, Spinner, Table } from '../components';
import { formatDate } from '../utils/format.js';
import styles from './WalletPage.module.css';

export default function WalletPage() {
    const { role } = useAuth();
    const { data, error, loading } = useAsync(getWalletBalance);
    // late fees are a member thing (the server answers 403 to anyone else), so only members ask for them
    const fees = useAsync(() => (['member', 'lender'].includes(role) ? getLateFees() : Promise.resolve({ fees: [] })), [role]);
    const lateFees = fees.data?.fees ?? [];

    return (
        <>
            <PageHeader title="Wallet" />
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data && (
                <Card title="Balance">
                    <p className={styles.balance}>{data.balance} <span>₥</span></p>
                    {data.balance < 0 && <p className={styles.note}>A negative balance is money you still owe, for example after a damage ruling.</p>}
                </Card>
            )}
            {lateFees.length > 0 && <Card title="Late fees">
                <p className={styles.note}>Charged when an item came back after its end date.</p>
                <Table rows={lateFees} getRowKey={fee => `${fee.reservation}-${fee.createdAt}`} columns={[
                    { key: 'date', header: 'Date', render: fee => formatDate(fee.date ?? fee.createdAt) },
                    { key: 'reservation', header: 'Reservation', render: fee => <Link to={`/reservations/${fee.reservation}`}>{fee.reservation}</Link> },
                    { key: 'amount', header: 'Amount', render: fee => `${fee.amount} ₥` },
                    { key: 'status', header: 'Status', render: fee => fee.status ?? 'completed' }
                ]} />
            </Card>}
            <Message type="error">{fees.error}</Message>
        </>
    );
}
