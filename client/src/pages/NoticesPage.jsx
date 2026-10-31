import { useState } from 'react';
import { createNotice, listNotices } from '../api/notices.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, FormField, Message, Spinner } from '../components';
import { formatDate } from '../utils/format.js';

export default function NoticesPage() {
    const { isAdmin } = useAuth();
    const { data, error, loading, reload } = useAsync(listNotices);
    const post = useAction();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');

    async function handleSubmit(event) {
        event.preventDefault();
        const ok = await post.run(() => createNotice(title, body), 'Notice posted.');
        if (ok) {
            setTitle('');
            setBody('');
            reload();
        }
    }

    return (
        <>
            <h1>Community notices</h1>
            {isAdmin && (
                <Card title="Post a notice">
                    <form onSubmit={handleSubmit}>
                        <FormField label="Title" name="title" value={title} required
                            onChange={(event) => setTitle(event.target.value)} />
                        <FormField label="Message" name="body" as="textarea" value={body} required
                            onChange={(event) => setBody(event.target.value)} />
                        <Message type="success">{post.success}</Message>
                        <Message type="error">{post.error}</Message>
                        <Button type="submit" disabled={post.pending}>Post notice</Button>
                    </form>
                </Card>
            )}
            {loading && <Spinner />}
            <Message type="error">{error}</Message>
            {data?.notices.length === 0 && <Message>No notices yet.</Message>}
            {data?.notices.map((notice) => (
                <Card key={notice._id} title={notice.title}>
                    <p>{notice.body}</p>
                    <small>Posted by {notice.postedBy} on {formatDate(notice.createdAt)}</small>
                </Card>
            ))}
        </>
    );
}
