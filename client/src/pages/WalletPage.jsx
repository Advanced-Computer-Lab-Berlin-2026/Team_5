import { getWalletBalance } from '../api/wallet.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Message, Spinner } from '../components';

export default function WalletPage() {
    const { data, error, loading } = useAsync(getWalletBalance);

    return (
        <>
            <h1>Wallet</h1>
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data && (
                <Card title="Balance">
                    <p>{data.balance} ₥</p>
                </Card>
            )}
        </>
    );
}
