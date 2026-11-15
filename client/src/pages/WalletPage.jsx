import { getWalletBalance } from '../api/wallet.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Message, PageHeader, Spinner } from '../components';
import styles from './WalletPage.module.css';

export default function WalletPage() {
    const { data, error, loading } = useAsync(getWalletBalance);

    return (
        <>
            <PageHeader eyebrow="Your account" title="Wallet" description="A clear view of your community balance." />
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data && (
                <Card title="Balance">
                    <p className={styles.balance}>{data.balance} <span>₥</span></p>
                </Card>
            )}
        </>
    );
}
