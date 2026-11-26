import { useEffect, useState } from 'react';
import { getEmailPreferences, updateEmailPreferences } from '../api/settings.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Message, PageHeader, Spinner } from '../components';
import styles from './EmailSettingsPage.module.css';

const OPTIONS = [
    ['reservations', 'Reservations', 'Updates about your bookings, pickups and returns.'],
    ['promotions', 'Promotions', 'Offers and news from In Your Shed.'],
    ['communityNotices', 'Community notices', 'Announcements posted for the whole community.']
];

export default function EmailSettingsPage() {
    const { data, error, loading } = useAsync(getEmailPreferences);
    const save = useAction();
    const [values, setValues] = useState(null);
    useEffect(() => { if (data) setValues(data.emailPreferences); }, [data]);

    // each switch saves as soon as it is flipped, and flips back if the server says no
    async function toggle(key) {
        const previous = values;
        const next = { ...values, [key]: !values[key] };
        setValues(next);
        const ok = await save.run(() => updateEmailPreferences({ [key]: next[key] }), 'Saved.');
        if (!ok) setValues(previous);
    }

    return <>
        <PageHeader title="Email preferences" />
        {loading && <Spinner />}
        <Message type="error">{error || save.error}</Message>
        {values && <Card title="Which emails would you like?">
            <ul className={styles.list}>
                {OPTIONS.map(([key, label, hint]) => <li key={key} className={styles.row}>
                    <span><strong>{label}</strong><small>{hint}</small></span>
                    <button type="button" role="switch" aria-checked={Boolean(values[key])} aria-label={label} className={styles.switch} onClick={() => toggle(key)}><span /></button>
                </li>)}
            </ul>
            <Message type="success">{save.success}</Message>
        </Card>}
    </>;
}
