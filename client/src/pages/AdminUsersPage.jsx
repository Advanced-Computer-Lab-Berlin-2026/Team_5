import { useState } from 'react';
import { deleteUser, listUsers, searchUsers, setSuspension } from '../api/admin.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Input, Message, Row, Spinner, Table } from '../components';

export default function AdminUsersPage() {
    const [searchText, setSearchText] = useState('');
    // the name that was actually searched for; empty means "show everyone"
    const [query, setQuery] = useState('');
    const { data, error, loading, reload } = useAsync(
        () => (query ? searchUsers(query) : listUsers()),
        [query]
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

    function handleSearch(event) {
        event.preventDefault();
        setQuery(searchText.trim());
    }

    return (
        <>
            <h1>Admin: users</h1>
            <form onSubmit={handleSearch}>
                <Row>
                    <Input name="search" placeholder="Search by name" value={searchText}
                        onChange={(event) => setSearchText(event.target.value)} />
                    <Button type="submit">Search</Button>
                    {query && (
                        <Button variant="secondary" onClick={() => { setSearchText(''); setQuery(''); }}>Show all</Button>
                    )}
                </Row>
            </form>
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
                                    <Button variant="secondary" disabled={action.pending}
                                        onClick={() => change(() => setSuspension(user.username, !user.suspended))}>
                                        {user.suspended ? 'Unsuspend' : 'Suspend'}
                                    </Button>
                                    <Button variant="secondary" disabled={action.pending} onClick={() => handleDelete(user)}>
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
