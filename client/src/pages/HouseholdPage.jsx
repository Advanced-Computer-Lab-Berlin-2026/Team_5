import { useEffect, useRef, useState } from 'react';
import {
    getIncomingRequests, getLinks, removeLink, respondToRequest, searchMember, sendHouseholdRequest
} from '../api/household.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, FormField, Icon, Message, PageHeader, Spinner } from '../components';
import TiltedCard from '../components/TiltedCard.jsx';
import styles from './HouseholdPage.module.css';

const RELATIONS = ['spouse', 'parent', 'child', 'siblings'].map((value) => ({ value, label: value }));

// Card surface colors (muted).
const TONES = { blue: '#4a6aa5', amber: '#d4a665', red: '#a35a5a' };

// Shared tilt settings so every household card moves like the item cards.
const TILT = { containerWidth: '100%', containerHeight: 'auto', imageWidth: '100%', imageHeight: '100%', style: { aspectRatio: '4 / 5' }, radius: 12, rotateAmplitude: 10, scaleOnHover: 1.04, glare: 0.2, shadow: 0.35, parallax: 0, showTooltip: false };

function PersonCard({ tone, name, username, relation, badge, index = 0, children }) {
    return (
        <TiltedCard {...TILT} introDelay={index * 60} altText={name}>
            <div className={`${styles.card} ${styles[tone]}`} style={{ background: TONES[tone] }}>
                <div className={styles.top}>
                    <span className={styles.avatar} aria-hidden="true">{(name || '?').trim().charAt(0).toUpperCase()}</span>
                    <span className={styles.relation}>{relation}</span>
                </div>
                <h3 className={styles.name}>{name}</h3>
                {username && <p className={styles.username}>@{username}</p>}
                {badge && <p className={styles.badge}>{badge}</p>}
                <div className={styles.actions}>{children}</div>
            </div>
        </TiltedCard>
    );
}

export default function HouseholdPage() {
    const incoming = useAsync(getIncomingRequests);
    const links = useAsync(getLinks);
    const send = useAction();
    const lookup = useAction();
    const answer = useAction();
    const [adding, setAdding] = useState(false);
    const [emailOrPhone, setEmailOrPhone] = useState('');
    const [relation, setRelation] = useState(RELATIONS[0].value);
    const [found, setFound] = useState(null);
    const dialog = useRef(null);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return undefined;
        if (adding) {
            delete element.dataset.closing;
            if (!element.open) element.showModal();
            return undefined;
        }
        if (!element.open) return undefined;
        // play the closing animation first, then actually close it
        element.dataset.closing = 'true';
        const timer = window.setTimeout(() => { element.close(); delete element.dataset.closing; }, 200);
        return () => window.clearTimeout(timer);
    }, [adding]);

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
            setAdding(false);
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

    const allLinks = links.data?.links ?? [];
    // my household: accepted people, plus requests I sent that are still waiting
    const household = allLinks.filter((link) => link.status === 'accepted' || (link.status === 'pending' && link.sentByMe));
    const rejected = allLinks.filter((link) => link.status === 'rejected');
    const requests = incoming.data?.requests ?? [];

    return (
        <>
            <PageHeader title="Your household" />
            <Message type="success">{send.success}</Message>
            <Message type="error">{links.error || answer.error}</Message>

            {links.loading && !links.data && <Spinner />}
            {links.data && (
                <div className={styles.grid}>
                    {household.map((link, index) => (
                        <PersonCard index={index} key={link._id} tone="blue" name={link.member?.name ?? 'Account removed'} username={link.member?.username}
                            relation={link.relation} badge={link.status === 'pending' ? 'Waiting for their reply' : null}>
                            <button type="button" className={styles.action} disabled={answer.pending} onClick={() => handleRemove(link._id)}>
                                {link.status === 'pending' ? 'Cancel request' : 'Remove'}
                            </button>
                        </PersonCard>
                    ))}
<TiltedCard {...TILT} introDelay={household.length * 60} altText="Add a household member" captionText="Add a household member" onClick={() => setAdding(true)}>
                        <div className={styles.free}>
                            <Icon name="plus" size={44} />
                            <span>Add a household member</span>
                        </div>
                    </TiltedCard>
                </div>
            )}

            <h2>Incoming requests</h2>
            {incoming.loading && !incoming.data && <Spinner />}
            <Message type="error">{incoming.error}</Message>
            {incoming.data && requests.length === 0 && <p className="muted">No incoming requests.</p>}
            {requests.length > 0 && (
                <div className={styles.grid}>
                    {requests.map((request, index) => (
                        <PersonCard index={index} key={request._id} tone="amber" name={request.requester?.profile?.name ?? 'Unknown'} username={request.requester?.username}
                            relation={request.relation} badge="Wants to join your household">
                            <button type="button" className={`${styles.action} ${styles.solid}`} disabled={answer.pending} onClick={() => handleAnswer(request._id, 'accept')}>Accept</button>
                            <button type="button" className={styles.action} disabled={answer.pending} onClick={() => handleAnswer(request._id, 'decline')}>Decline</button>
                        </PersonCard>
                    ))}
                </div>
            )}

            {rejected.length > 0 && <>
                <h2>Rejected</h2>
                <div className={styles.grid}>
                    {rejected.map((link, index) => (
                        <PersonCard index={index} key={link._id} tone="red" name={link.member?.name ?? 'Account removed'} username={link.member?.username}
                            relation={link.relation} badge={link.sentByMe ? 'Rejected your request' : 'You rejected this request'}>
                            <button type="button" className={styles.action} disabled={answer.pending} onClick={() => handleRemove(link._id)}>Remove</button>
                        </PersonCard>
                    ))}
                </div>
            </>}

            <dialog ref={dialog} className={styles.dialog} aria-label="Request a household link" onCancel={event => { event.preventDefault(); setAdding(false); }} onClose={() => setAdding(false)}>
                <form onSubmit={handleSend}>
                    <h2>Add a household member</h2>
                    <div className={styles.fields}>
                        <FormField label="Their email or phone" name="emailOrPhone" value={emailOrPhone} required placeholder="name@example.com"
                            onChange={(event) => { setEmailOrPhone(event.target.value); setFound(null); }} />
                        <FormField label="Relationship" name="relation" as="select" value={relation} options={RELATIONS}
                            onChange={(event) => setRelation(event.target.value)} />
                    </div>
                    <Message type="info">{found && `Found: ${found.name} (${found.username})`}</Message>
                    <Message type="error">{send.error || lookup.error}</Message>
                    <Button type="submit" pending={send.pending} fullWidth>{send.pending ? 'Sending…' : 'Send request'}</Button>
                    <div className={styles.dialogFooter}>
                        <button type="button" className={styles.textButton} disabled={!emailOrPhone || lookup.pending} onClick={handleSearch}>Find member</button>
                        <button type="button" className={styles.textButton} onClick={() => setAdding(false)}>Cancel</button>
                    </div>
                </form>
            </dialog>
        </>
    );
}
