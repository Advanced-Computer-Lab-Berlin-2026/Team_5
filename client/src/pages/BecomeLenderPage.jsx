import { useEffect } from 'react';
import { getMyRequest, removeDocument, submitRequest, uploadDocument } from '../api/lenderRequests.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, DetailList, FileUploadCard, Message, Spinner } from '../components';
import { formatDateTime } from '../utils/format.js';

const SLOTS = [
    { slot: 'id', title: 'ID document' },
    { slot: 'addressProof', title: 'Proof of address' }
];
// The member can change the documents until the request is submitted, and again after a rejection.
const EDITABLE = ['none', 'rejected', 'retry'];
const STATUS_TEXT = {
    none: 'You have not applied yet.',
    pending: 'Your request is being reviewed by an admin.',
    accepted: 'Your request was accepted. You are a lender now.',
    rejected: 'Your request was rejected. You can fix the documents and apply again.',
    retry: 'The admin asked you to send your documents again.'
};

export default function BecomeLenderPage() {
    const { refreshRole } = useAuth();
    const { data, error, loading, reload } = useAsync(getMyRequest);
    const action = useAction();

    // once approved, the role in the menu has to change to lender
    useEffect(() => {
        if (data?.status === 'accepted') refreshRole();
    }, [data?.status, refreshRole]);

    if (loading) return <Spinner />;
    if (error) return <Message type="error">{error}</Message>;

    const editable = EDITABLE.includes(data.status);
    const documentFor = (slot) => data.documents.find((document) => document.type === slot);
    const ready = SLOTS.every(({ slot }) => documentFor(slot));

    async function change(task, successText) {
        const ok = await action.run(task, successText);
        if (ok) reload();
    }

    return (
        <>
            <h1>Become a lender</h1>
            <Card title="Your request">
                <DetailList rows={[
                    ['Status', data.status],
                    ['Submitted', formatDateTime(data.submittedAt)],
                    ['Reviewed', formatDateTime(data.reviewedAt)],
                    ['Admin note', data.note]
                ]} />
                <p>{STATUS_TEXT[data.status]}</p>
            </Card>

            <Message type="success">{action.success}</Message>
            <Message type="error">{action.error}</Message>

            {SLOTS.map(({ slot, title }) => {
                const document = documentFor(slot);
                return (
                    <div key={slot}>
                        <Card title={title}
                            footer={editable && document && (
                                <Button variant="secondary" disabled={action.pending}
                                    onClick={() => change(() => removeDocument(slot), 'Document removed.')}>Remove</Button>
                            )}>
                            <p>{document ? `Uploaded: ${document.originalName}` : 'Nothing uploaded yet.'}</p>
                        </Card>
                        {editable && (
                            <FileUploadCard title={document ? `Replace ${title.toLowerCase()}` : `Upload ${title.toLowerCase()}`}
                                name={slot} accept="application/pdf,image/jpeg,image/png"
                                hint="PDF, JPG or PNG, up to 5 MB." onUpload={(files) => uploadDocument(slot, files[0])} onDone={reload} />
                        )}
                    </div>
                );
            })}

            {editable && (
                <div>
                    <Button disabled={!ready || action.pending}
                        onClick={() => change(submitRequest, 'Request submitted.')}>Submit request</Button>
                    {!ready && <p>Upload both documents to submit.</p>}
                </div>
            )}
        </>
    );
}
