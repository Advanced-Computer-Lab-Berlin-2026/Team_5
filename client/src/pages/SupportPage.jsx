import { useState } from 'react';
import { listMyTickets, openTicket } from '../api/support.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, EmptyState, FormField, Message, PageHeader, Spinner } from '../components';
import ScrollStack, { ScrollStackItem } from '../components/ScrollStack.jsx';
import { formatDateTime } from '../utils/format.js';
import styles from './SupportPage.module.css';
import chat from './ReservationPage.module.css';

// Members: ask the admins for help. The question form runs across the page; earlier questions stack below it like the notices,
// each one a card with the conversation as chat bubbles.
export default function SupportPage() {
    const { user } = useAuth();
    const tickets = useAsync(listMyTickets);
    const send = useAction();
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    // the question whose conversation is open; the others show only their subject and status
    const [openId, setOpenId] = useState('');
    const list = tickets.data?.tickets ?? [];

    async function handleSubmit(event) {
        event.preventDefault();
        const result = await send.run(() => openTicket({ subject: subject.trim(), message: message.trim() }), 'Sent. An admin will answer here.');
        if (result) { setSubject(''); setMessage(''); setOpenId(result.ticket?._id ?? ''); tickets.reload(); }
    }

    return <>
        <PageHeader title="Help" />
        <Card title="Ask a question" className={styles.form}>
            <form className={styles.wide} onSubmit={handleSubmit}>
                <FormField label="Subject" name="ticketSubject" value={subject} required minLength={3} maxLength={120} onChange={event => setSubject(event.target.value)} />
                <FormField label="What do you need help with?" name="ticketMessage" as="textarea" value={message} required maxLength={5000} onChange={event => setMessage(event.target.value)} />
                <Message type="error">{send.error}</Message>
                <Message type="success">{send.success}</Message>
                <Button type="submit" pending={send.pending} disabled={subject.trim().length < 3 || !message.trim()}>Send</Button>
            </form>
        </Card>

        {tickets.loading && !tickets.data && <Spinner />}
        <Message type="error">{tickets.error}</Message>
        {tickets.data && list.length === 0 && <EmptyState icon="box" title="No questions yet" description="Anything you send shows up here with the admins' answers." />}
        {list.length > 0 && <ScrollStack useWindowScroll smoothScroll={false} className={styles.stack} stackPosition={128} itemDistance={24}
            itemStackDistance={20} itemScale={0.04} baseScale={0.85} dimAmount={0.15} holdDistance={120}>
            {list.map(ticket => {
                const answered = ticket.messages?.some(entry => entry.userType === 'admin');
                const open = openId === ticket._id;
                return <ScrollStackItem key={ticket._id} itemClassName={`${styles.ticket} ${open ? styles.open : ''}`}>
                    <button type="button" className={styles.summary} aria-expanded={open} onClick={() => setOpenId(open ? '' : ticket._id)}>
                        <h2 className={styles.subject}>{ticket.subject}</h2>
                        <span className={`${styles.status} ${ticket.status === 'resolved' ? styles.resolved : answered ? styles.answered : ''}`}>{ticket.status === 'resolved' ? 'Resolved' : answered ? 'Answered' : 'Waiting'}</span>
                        <small className={styles.when}>{ticket.messages?.length ?? 0} {ticket.messages?.length === 1 ? 'message' : 'messages'} · last update {formatDateTime(ticket.updatedAt)} · {open ? 'press to close' : 'press to read'}</small>
                    </button>
                    {open && <div className={`${chat.thread} ${styles.thread}`}>
                        {(ticket.messages ?? []).map((entry, index) => {
                            const mine = entry.sender === user?.username;
                            return <div key={`${entry.date}-${index}`} className={`${chat.row} ${mine ? chat.mineRow : ''}`}>
                                <span className={chat.avatar} aria-hidden="true">{mine ? (user?.username ?? '?').charAt(0).toUpperCase() : 'A'}</span>
                                <div className={`${chat.bubble} ${mine ? chat.mine : ''}`}>
                                    <span className={chat.who}>{mine ? 'You' : 'Admin'}</span>
                                    <span className={chat.text}>{entry.text}</span>
                                    <small>{formatDateTime(entry.date)}</small>
                                </div>
                            </div>;
                        })}
                    </div>}
                </ScrollStackItem>;
            })}
        </ScrollStack>}
    </>;
}
