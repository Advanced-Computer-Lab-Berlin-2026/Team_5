import { useState } from 'react';
import { listLenderRequests } from '../api/admin.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Message, Row, Select, Spinner, Table } from '../components';
import { formatDateTime } from '../utils/format.js';

const STATUSES = ['pending', 'accepted', 'rejected'].map((value) => ({ value, label: value }));

export default function AdminLenderRequestsPage() {
    const [status, setStatus] = useState('pending');
    // unlike most routes, this one answers with a plain array of users
    const { data, error, loading } = useAsync(() => listLenderRequests(status), [status]);

    return (
        <>
            <h1>Admin: lender requests</h1>
            <Row>
                <Select name="status" value={status} options={STATUSES} onChange={(event) => setStatus(event.target.value)} />
            </Row>
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data && (
                <Table
                    rows={data}
                    getRowKey={(user) => user.username}
                    empty={`No ${status} requests.`}
                    columns={[
                        { key: 'username', header: 'Username' },
                        { key: 'name', header: 'Name', render: (user) => user.profile?.name },
                        { key: 'email', header: 'Email', render: (user) => user.profile?.email },
                        { key: 'submittedAt', header: 'Submitted', render: (user) => formatDateTime(user.verification?.submittedAt) },
                        {
                            key: 'actions', header: '',
                            render: (user) => (
                                <Button variant="secondary" to={`/admin/lender-requests/${user.username}`}>Review</Button>
                            )
                        }
                    ]}
                />
            )}
        </>
    );
}
