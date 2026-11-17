import { useState } from 'react';
import { changePassword } from '../api/auth.js';
import { updateProfile } from '../api/profile.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { Button, FormField, Icon, Message, PageHeader } from '../components';
import TiltedCard from '../components/TiltedCard.jsx';
import styles from './ProfilePage.module.css';

// Muted card colors; the details card picks one at random every time the page opens. dark: true means dark text.
const COLORS = [
    { background: '#4a6aa5' },
    { background: '#a35a5a' },
    { background: '#5f8f6b' },
    { background: '#7d6aa5' },
    { background: '#4f8f93' },
    { background: '#d4a665', dark: true },
    { background: '#c98f6a', dark: true },
    { background: '#b7a35c', dark: true }
];

// Same tilt feel as the household cards. The form card tilts less so it stays comfortable to type in.
const TILT = { containerWidth: '100%', containerHeight: 'auto', imageWidth: '100%', imageHeight: '100%', radius: 12, parallax: 0, showTooltip: false };

export default function ProfilePage() {
    const { user, role } = useAuth();
    const { pending, error, success, run } = useAction();
    const password = useAction();
    const [color] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [homeAddress, setHomeAddress] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [flipped, setFlipped] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        // The server needs at least one field, and an empty box means "leave this alone".
        const fields = {};
        if (phoneNumber) fields.phoneNumber = phoneNumber;
        if (homeAddress) fields.homeAddress = homeAddress;
        await run(() => updateProfile(fields), 'Profile updated.');
    }

    async function handlePassword(event) {
        event.preventDefault();
        const ok = await password.run(() => changePassword(currentPassword, newPassword), 'Password changed.');
        if (ok) {
            setCurrentPassword('');
            setNewPassword('');
        }
    }

    return (
        <>
            <PageHeader title="Profile" />
            <div className={styles.grid}>
                <TiltedCard {...TILT} className={styles.tile} rotateAmplitude={10} scaleOnHover={1.04} glare={0.2} shadow={0.35} altText={user.name}>
                    <div className={`${styles.face} ${styles.details} ${color.dark ? styles.darkText : ''}`} style={{ background: color.background }}>
                        <div className={styles.top}>
                            <span className={styles.avatar} aria-hidden="true">{(user.name || user.username || '?').trim().charAt(0).toUpperCase()}</span>
                            <span className={styles.role}>{role}</span>
                        </div>
                        <h2 className={styles.name}>{user.name}</h2>
                        <p className={styles.line}>@{user.username}</p>
                        <p className={styles.line}>{user.email}</p>
                    </div>
                </TiltedCard>

                <TiltedCard {...TILT} className={`${styles.tile} ${styles.wide}`} rotateAmplitude={3} scaleOnHover={1.01} glare={0.12} shadow={0.3}
                    altText="Account settings" flipped={flipped} flipOnClick={false}
                    backContent={
                        <form className={`${styles.face} ${styles.section}`} onSubmit={handlePassword} inert={!flipped}>
                            <h2>Change password</h2>
                            <FormField label="Current password" name="currentPassword" type="password" value={currentPassword} required
                                onChange={(event) => setCurrentPassword(event.target.value)} />
                            <FormField label="New password" name="newPassword" type="password" value={newPassword} required
                                hint="6 to 40 characters with an uppercase letter, a lowercase letter and a number"
                                onChange={(event) => setNewPassword(event.target.value)} />
                            <Message type="success">{password.success}</Message>
                            <Message type="error">{password.error}</Message>
                            <div className={styles.footer}>
                                <Button type="submit" disabled={password.pending}>Save password</Button>
                                <button type="button" className={styles.flip} onClick={() => setFlipped(false)}>Alter details <Icon name="reset" size={20} /></button>
                            </div>
                        </form>
                    }>
                    <form className={`${styles.face} ${styles.section}`} onSubmit={handleSubmit} inert={flipped}>
                        <h2>Update contact details</h2>
                        <FormField label="Phone" name="phoneNumber" value={phoneNumber}
                            hint="International format, e.g. +491701234567. Leave blank to keep the current one."
                            onChange={(event) => setPhoneNumber(event.target.value)} />
                        <FormField label="Home address" name="homeAddress" value={homeAddress}
                            hint="Leave blank to keep the current one."
                            onChange={(event) => setHomeAddress(event.target.value)} />
                        <Message type="success">{success}</Message>
                        <Message type="error">{error}</Message>
                        <div className={styles.footer}>
                            <Button type="submit" disabled={pending || (!phoneNumber && !homeAddress)}>Save</Button>
                            <button type="button" className={styles.flip} onClick={() => setFlipped(true)}>Change password <Icon name="reset" size={20} /></button>
                        </div>
                    </form>
                </TiltedCard>
            </div>

        </>
    );
}
