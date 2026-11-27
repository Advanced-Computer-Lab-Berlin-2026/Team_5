import { useState } from 'react';
import { deleteUser, getUser, listUsers, searchUsers, setSuspension } from '../api/admin.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import styles from './AdminUsersPage.module.css';
import { Button, DetailList, Message, PageHeader, SearchField, Select, Spinner, Table } from '../components';

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
            <div className={styles.filters}>
                <Select name="userRole" aria-label="Account type" value={role} options={[{ value: '', label: 'Members and lenders' }, { value: 'admin', label: 'Administrators' }]} onChange={event => { setRole(event.target.value); setQuery(''); setSelected(''); }} />
                {!role && <SearchField label="Search users by name" placeholder="Search by name" onSearch={setQuery} />}
            </div>
            {loading && <Spinner />}
            <Message type="error">{error || action.error}</Message>
            {data && <div className={styles.usersTable}>
                <Table
                    rows={data.users}
                    getRowKey={(user) => user.username ?? user._id}
                    empty="No users found."
                    expandedKey={selected}
                    renderExpanded={() => <div className={styles.details}>
                        <h3>Account details</h3>
                        {details.loading && <Spinner />}
                        <Message type="error">{details.error}</Message>
                        {!details.loading && details.data?.user && <DetailList rows={[
                            ['Username', details.data.user.username], ['Role', details.data.user.role],
                            ['Name', details.data.user.profile?.name], ['Email', details.data.user.profile?.email],
                            ['Phone', details.data.user.profile?.phone], ['Address', details.data.user.profile?.address]
                        ]} />}
                        <div><Button variant="secondary" size="small" onClick={() => setSelected('')}>Close</Button></div>
                    </div>}
                    columns={[
                        { key: 'username', header: 'Username' },
                        { key: 'role', header: 'Role' },
                        { key: 'name', header: 'Name', render: (user) => user.profile?.name },
                        { key: 'email', header: 'Email', render: (user) => user.profile?.email },
                        { key: 'verification', header: 'Verified', render: (user) => user.verification?.status ?? '-' },
                        { key: 'suspended', header: 'Status', render: (user) => <span className={`${styles.status} ${user.suspended ? styles.suspended : ''}`}>{user.suspended ? 'Suspended' : 'Active'}</span> },
                        {
                            key: 'actions', header: '',
                            render: (user) => (
                                <div className={styles.actions}>
                                    {user.role !== 'admin' && <Button variant="secondary" size="small" aria-expanded={selected === user.username} onClick={() => setSelected(current => (current === user.username ? '' : user.username))}>{selected === user.username ? 'Hide' : 'Details'}</Button>}
                                    {user.role !== 'admin' && <Button size="small" className={styles.suspend} disabled={action.pending}
                                        onClick={() => change(() => setSuspension(user.username, !user.suspended))}>
                                        {user.suspended ? 'Unsuspend' : 'Suspend'}
                                    </Button>}
                                    <Button size="small" className={styles.delete} disabled={action.pending || user.username === signedIn?.username} onClick={() => handleDelete(user)}>
                                        Delete
                                    </Button>
                                </div>
                            )
                        }
                    ]}
                />
            </div>}
        </>
    );
}
