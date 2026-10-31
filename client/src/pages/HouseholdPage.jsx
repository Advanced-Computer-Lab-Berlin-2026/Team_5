import { useState } from 'react';
import {
    getIncomingRequests, getLinks, removeLink, respondToRequest, searchMember, sendHouseholdRequest
} from '../api/household.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, FormField, Message, Row, Select, Spinner, Table } from '../components';

const RELATIONS = ['spouse', 'parent', 'child', 'siblings'].map((value) => ({ value, label: value }));

export default function HouseholdPage() {
    const incoming = useAsync(getIncomingRequests);
    const links = useAsync(getLinks);
    const send = useAction();
    const lookup = useAction();
    const answer = useAction();
    const [emailOrPhone, setEmailOrPhone] = useState('');
    const [relation, setRelation] = useState(RELATIONS[0].value);
    const [found, setFound] = useState(null);

    async function handleSearch() {
        setFound(null);
        const result = await lookup.run(() => searchMember(emailOrPhone));
        if (result?.member) setFound(result.member);
    }

    async function handleSend(event) {
        event.preventDefault();
        const ok = await send.run(() => sendHouseholdRequest(emailOrPhone, relation), 'Request sent.');
        if (ok) {
            setEmailOrPhone('');
            setFound(null);
            links.reload();
        }
    }

    async function handleAnswer(requestId, decision) {
        const ok = await answer.run(() => respondToRequest(requestId, decision));
        if (ok) {
            incoming.reload();
            links.reload();
        }
    }

    async function handleRemove(linkId) {
        const ok = await answer.run(() => removeLink(linkId));
        if (ok) links.reload();
    }

    return (
        <>
            <h1>Household</h1>

            <Card title="Add a household member">
                <form onSubmit={handleSend}>
                    <FormField label="Their email or phone" name="emailOrPhone" value={emailOrPhone} required
                        onChange={(event) => { setEmailOrPhone(event.target.value); setFound(null); }} />
                    <Select name="relation" value={relation} options={RELATIONS}
                        onChange={(event) => setRelation(event.target.value)} />
                    <Message type="info">{found && `Found: ${found.name} (${found.username})`}</Message>
                    <Message type="success">{send.success}</Message>
                    <Message type="error">{send.error || lookup.error}</Message>
                    <Row>
                        <Button variant="secondary" disabled={!emailOrPhone || lookup.pending} onClick={handleSearch}>
                            Find member
                        </Button>
                        <Button type="submit" disabled={send.pending}>Send request</Button>
                    </Row>
                </form>
            </Card>

            <h2>Incoming requests</h2>
            {incoming.loading && <Spinner />}
            <Message type="error">{incoming.error || answer.error}</Message>
            {incoming.data && (
                <Table
                    rows={incoming.data.requests}
                    getRowKey={(request) => request._id}
                    empty="No incoming requests."
                    columns={[
                        { key: 'from', header: 'From', render: (request) => request.requester?.profile?.name ?? 'Unknown' },
                        { key: 'relation', header: 'Relation' },
                        {
                            key: 'actions', header: '',
                            render: (request) => (
                                <Row>
                                    <Button disabled={answer.pending} onClick={() => handleAnswer(request._id, 'accept')}>Accept</Button>
                                    <Button variant="secondary" disabled={answer.pending} onClick={() => handleAnswer(request._id, 'decline')}>Decline</Button>
                                </Row>
                            )
                        }
                    ]}
                />
            )}

            <h2>Your household</h2>
            {links.loading && <Spinner />}
            <Message type="error">{links.error}</Message>
            {links.data && (
                <Table
                    rows={links.data.links}
                    getRowKey={(link) => link._id}
                    empty="No household links yet."
                    columns={[
                        { key: 'member', header: 'Member', render: (link) => link.member?.name ?? 'Account removed' },
                        { key: 'relation', header: 'Relation' },
                        { key: 'status', header: 'Status', render: (link) => (link.sentByMe ? `${link.status} (sent by you)` : link.status) },
                        {
                            key: 'actions', header: '',
                            render: (link) => (
                                <Button variant="secondary" disabled={answer.pending} onClick={() => handleRemove(link._id)}>Remove</Button>
                            )
                        }
                    ]}
                />
            )}
        </>
    );
}
