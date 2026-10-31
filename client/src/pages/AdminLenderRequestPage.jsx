import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { decideLenderRequest, getLenderRequest, lenderDocumentUrl } from '../api/admin.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, DetailList, FormField, Message, Row, Spinner } from '../components';
import { formatDateTime } from '../utils/format.js';

const SLOT_TITLES = { id: 'ID document', addressProof: 'Proof of address' };

export default function AdminLenderRequestPage() {
    const { username } = useParams();
    const { data, error, loading, reload } = useAsync(() => getLenderRequest(username), [username]);
    const decision = useAction();
    const [reason, setReason] = useState('');

    if (loading) return <Spinner />;
    if (error) return <><Message type="error">{error}</Message><Link to="/admin/lender-requests">Back to requests</Link></>;

    const { profile, verification } = data;

    async function decide(choice) {
        const ok = await decision.run(
            () => decideLenderRequest(username, choice, reason.trim()),
            choice === 'accept' ? 'Request accepted. The member is now a lender.' : 'Request rejected.'
        );
        if (ok) reload();
    }

    return (
        <>
            <p><Link to="/admin/lender-requests">Back to requests</Link></p>
            <h1>Request from {username}</h1>

            <Card title="Applicant">
                <DetailList rows={[
                    ['Name', profile?.name],
                    ['Email', profile?.email],
                    ['Phone', profile?.phone],
                    ['Address', profile?.address],
                    ['Status', verification.status],
                    ['Submitted', formatDateTime(verification.submittedAt)],
                    ['Reviewed by', verification.reviewedBy],
                    ['Reviewed', formatDateTime(verification.reviewedAt)],
                    ['Note', verification.note]
                ]} />
            </Card>

            <Card title="Documents">
                {verification.documents.length === 0 && <p>No documents uploaded.</p>}
                {verification.documents.map((document) => (
                    <p key={document.type}>
                        {SLOT_TITLES[document.type] ?? document.type}:{' '}
                        <a href={lenderDocumentUrl(username, document.type)} target="_blank" rel="noreferrer">
                            {document.originalName}
                        </a>
                    </p>
                ))}
            </Card>

            {verification.status === 'pending' && (
                <Card title="Decision">
                    <FormField label="Reason (required to reject)" name="reason" as="textarea" maxLength={500}
                        value={reason} onChange={(event) => setReason(event.target.value)} />
                    <Message type="success">{decision.success}</Message>
                    <Message type="error">{decision.error}</Message>
                    <Row>
                        <Button disabled={decision.pending} onClick={() => decide('accept')}>Accept</Button>
                        <Button variant="secondary" disabled={decision.pending || !reason.trim()} onClick={() => decide('reject')}>Reject</Button>
                    </Row>
                </Card>
            )}
        </>
    );
}
