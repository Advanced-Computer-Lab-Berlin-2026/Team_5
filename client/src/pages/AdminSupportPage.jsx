import { useState } from 'react';
import { listSupportTickets, respondToTicket } from '../api/adminSupport.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, EmptyState, Message, PageHeader, Select, Spinner } from '../components';
import ScrollStack, { ScrollStackItem } from '../components/ScrollStack.jsx';
import { formatDateTime } from '../utils/format.js';
import styles from './SupportPage.module.css';
import chat from './ReservationPage.module.css';
import own from './AdminSupportPage.module.css';

const STATUSES = [['in-progress', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([value, label]) => ({ value, label }));

// One open question: the conversation and a reply box; "Reply and close" resolves it.
function Reply({ ticket, onDone }) {
    const send = useAction();
    const [text, setText] = useState('');
    async function answer(resolve) {
        if (await send.run(() => respondToTicket(ticket._id, text.trim(), resolve))) { setText(''); onDone(); }
    }
    return <div className={own.reply}>
        <textarea aria-label="Your answer" placeholder="Write an answer" value={text} maxLength={5000} onChange={event => setText(event.target.value)} />
        <Message type="error">{send.error}</Message>
        <div className={own.buttons}>
            <Button pending={send.pending} disabled={!text.trim()} onClick={() => answer(false)}>Reply</Button>
            <Button variant="secondary" disabled={send.pending || !text.trim()} onClick={() => answer(true)}>Reply and close</Button>
        </div>
    </div>;
}

// Admin: questions from members and lenders, as the same stack of cards they see; press one to read and answer it.
export default function AdminSupportPage() {
    const [status, setStatus] = useState('in-progress');
    const { data, error, loading, reload } = useAsync(() => listSupportTickets(status), [status]);
    const [openId, setOpenId] = useState('');
    const list = data?.tickets ?? [];

    return <>
        <PageHeader title="Support" />
        <div className={own.filter}><Select name="status" aria-label="Show" value={status} options={STATUSES} onChange={event => setStatus(event.target.value)} /></div>
        {loading && !data && <Spinner />}
        <Message type="error">{error}</Message>
        {data && list.length === 0 && <EmptyState icon="box" title="No questions" description={status === 'in-progress' ? 'Nobody is waiting for an answer.' : 'Nothing with this status.'} />}
        {list.length > 0 && <ScrollStack useWindowScroll smoothScroll={false} className={styles.stack} stackPosition={128} itemDistance={24}
            itemStackDistance={20} itemScale={0.04} baseScale={0.85} dimAmount={0.15} holdDistance={120}>
            {list.map(ticket => {
                const open = openId === ticket._id;
                const asker = ticket.user?.profile?.name ?? ticket.user?.username ?? ticket.user;
                const answered = ticket.messages?.some(entry => entry.userType === 'admin');
                return <ScrollStackItem key={ticket._id} itemClassName={`${styles.ticket} ${open ? styles.open : ''}`}>
                    <button type="button" className={styles.summary} aria-expanded={open} onClick={() => setOpenId(open ? '' : ticket._id)}>
                        <h2 className={styles.subject}>{ticket.subject}</h2>
                        <span className={`${styles.status} ${ticket.status === 'resolved' ? styles.resolved : answered ? styles.answered : ''}`}>{ticket.status === 'resolved' ? 'Resolved' : answered ? 'Answered' : 'New'}</span>
                        <small className={styles.when}>From {asker} ({ticket.messages?.[0]?.userType ?? 'member'}) · {ticket.messages?.length ?? 0} messages · last update {formatDateTime(ticket.updatedAt)} · {open ? 'press to close' : 'press to read'}</small>
                    </button>
                    {open && <>
                        <div className={`${chat.thread} ${styles.thread}`}>
                            {(ticket.messages ?? []).map((entry, index) => {
                                const fromAdmin = entry.userType === 'admin';
                                return <div key={`${entry.date}-${index}`} className={`${chat.row} ${fromAdmin ? chat.mineRow : ''}`}>
                                    <span className={chat.avatar} aria-hidden="true">{(entry.sender ?? '?').charAt(0).toUpperCase()}</span>
                                    <div className={`${chat.bubble} ${fromAdmin ? chat.mine : ''}`}>
                                        <span className={chat.who}>{fromAdmin ? `${entry.sender} (admin)` : entry.sender}</span>
                                        <span className={chat.text}>{entry.text}</span>
                                        <small>{formatDateTime(entry.date)}</small>
                                    </div>
                                </div>;
                            })}
                        </div>
                        {ticket.status !== 'resolved' && <Reply ticket={ticket} onDone={reload} />}
                    </>}
                </ScrollStackItem>;
            })}
        </ScrollStack>}
    </>;
}
