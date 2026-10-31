import { deleteUser, listUsers, setSuspension } from '../api/admin.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Message, Row, Spinner, Table } from '../components';

export default function AdminUsersPage() {
    const { data, error, loading, reload } = useAsync(listUsers);
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
            <h1>Admin: users</h1>
            <Row>
                <Button variant="secondary" to="/admin/items">View all items</Button>
            </Row>
            {loading && <Spinner />}
            <Message type="error">{error || action.error}</Message>
            {data && (
                <Table
                    rows={data.users}
                    getRowKey={(user) => user._id}
                    empty="No users."
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
                                        onClick={() => change(() => setSuspension(user._id, !user.suspended))}>
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
