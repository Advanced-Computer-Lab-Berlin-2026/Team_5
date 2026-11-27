import { useState } from 'react';
import { deleteUser, getUser, listUsers, searchUsers, setSuspension } from '../api/admin.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import styles from './AdminUsersPage.module.css';
import { Button, Card, DetailList, Message, PageHeader, Row, SearchField, Select, Spinner, Table } from '../components';

export default function AdminUsersPage() {
    // the name that was actually searched for; empty means "show everyone"
    const [query, setQuery] = useState('');
    const [role, setRole] = useState('');
    const [selected, setSelected] = useState('');
    const { user: signedIn } = useAuth();
    const details = useAsync(() => selected ? getUser(selected) : Promise.resolve(null), [selected]);
    const { data, error, loading, reload } = useAsync(
        () => (query && !role ? searchUsers(query) : listUsers(role)),
        [query, role]
    );
    const action = useAction();

    async function change(task) {
        const ok = await action.run(task);
        if (ok) reload();
    }

    function handleDelete(user) {
        if (window.confirm(`Delete ${user.username}? This cannot be undone.`)) {
            change(() => deleteUser(user._id));
        }
    }

    return (
        <>
            <PageHeader title="Community members" />
            <Select name="userRole" aria-label="Account type" value={role} options={[{ value: '', label: 'Members and lenders' }, { value: 'admin', label: 'Administrators' }]} onChange={event => { setRole(event.target.value); setQuery(''); setSelected(''); }} />
            {!role && <SearchField label="Search users by name" placeholder="Search by name" onSearch={setQuery} />}
            {selected && <Card title="Account details">
                {details.loading && <Spinner />}
                <Message type="error">{details.error}</Message>
                {!details.loading && details.data?.user && <DetailList rows={[
                    ['Username', details.data.user.username], ['Role', details.data.user.role],
                    ['Name', details.data.user.profile?.name], ['Email', details.data.user.profile?.email],
                    ['Phone', details.data.user.profile?.phone], ['Address', details.data.user.profile?.address]
                ]} />}
                <Button variant="secondary" onClick={() => setSelected('')}>Close</Button>
            </Card>}
            {loading && <Spinner />}
            <Message type="error">{error || action.error}</Message>
            {data && (
                <Table
                    rows={data.users}
                    getRowKey={(user) => user._id ?? user.username}
                    empty="No users found."
                    columns={[
                        { key: 'username', header: 'Username' },
                        { key: 'role', header: 'Role' },
                        { key: 'name', header: 'Name', render: (user) => user.profile?.name },
                        { key: 'email', header: 'Email', render: (user) => user.profile?.email },
                        { key: 'verification', header: 'Verified', render: (user) => user.verification?.status ?? '-' },
                        { key: 'suspended', header: 'Status', render: (user) => (user.suspended ? 'suspended' : 'active') },
                        {
                            key: 'actions', header: '',
                            render: (user) => (
                                <Row>
                                    {user.role !== 'admin' && <Button variant="secondary" onClick={() => setSelected(user.username)}>Details</Button>}
                                    {user.role !== 'admin' && <Button className={styles.suspend} disabled={action.pending}
                                        onClick={() => change(() => setSuspension(user.username, !user.suspended))}>
                                        {user.suspended ? 'Unsuspend' : 'Suspend'}
                                    </Button>}
                                    <Button className={styles.delete} disabled={action.pending || user.username === signedIn?.username} onClick={() => handleDelete(user)}>
                                        Delete
                                    </Button>
                                </Row>
                            )
                        }
                    ]}
                />
            )}
        </>
    );
}
