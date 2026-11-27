import { useEffect, useState } from 'react';
import { submitReport } from '../api/memberReports.js';
import { useAction } from '../hooks/useAction.js';
import { AmberDialog } from './AmberDialog.jsx';
import { Button } from './Button.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';
import styles from './ReserveDialog.module.css';

// "Report this item / person" for members: a reason goes to the admins, who can hide the item or suspend the account.
export function ReportDialog({ open, targetType, targetId, name, onClose }) {
    const send = useAction();
    const [reason, setReason] = useState('');
    useEffect(() => { if (open) { setReason(''); send.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    const about = targetType === 'item' ? `this item${name ? ` (${name})` : ''}` : name ?? 'this person';

    async function handleSubmit(event) {
        event.preventDefault();
        await send.run(() => submitReport({ targetType, targetId, reason: reason.trim() }), 'Thank you. An admin will look at it.');
    }

    return <AmberDialog open={open} label={`Report ${about}`} onClose={onClose}>
        <form onSubmit={handleSubmit}>
            <h2>Report {about}</h2>
            <p>Tell the admins what is wrong. Only they see this.</p>
            {!send.success && <FormField label="What happened" name="reportReason" as="textarea" value={reason} required minLength={5} maxLength={500}
                hint="5 to 500 characters" onChange={event => setReason(event.target.value)} />}
            <Message type="error">{send.error}</Message>
            <Message type="success">{send.success}</Message>
            {!send.success && <Button type="submit" fullWidth pending={send.pending} disabled={reason.trim().length < 5}>Send report</Button>}
            <div className={styles.footer}>
                <button type="button" className={styles.textButton} onClick={onClose}>{send.success ? 'Close' : 'Cancel'}</button>
            </div>
        </form>
    </AmberDialog>;
}
