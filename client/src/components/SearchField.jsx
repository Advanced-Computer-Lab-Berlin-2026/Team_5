import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Input } from './Input.jsx';
import styles from './SearchField.module.css';

// A search box that searches by itself: onSearch(text) runs shortly after typing stops (and not while an input method is composing).
export function SearchField({ onSearch, placeholder = 'Search', label = 'Search', delay = 300, ...props }) {
    const [text, setText] = useState('');
    const [composing, setComposing] = useState(false);

    useEffect(() => {
        if (composing) return undefined;
        const timer = window.setTimeout(() => onSearch(text.trim()), delay);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text, composing, delay]);

    return (
        <form className={styles.search} role="search" aria-label={label} onSubmit={event => { event.preventDefault(); onSearch(text.trim()); }}>
            <div className={styles.field}>
                <Icon name="search" />
                <Input type="search" name="search" aria-label={label} placeholder={placeholder} maxLength={100} value={text}
                    onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
                    onChange={event => setText(event.target.value)} {...props} />
            </div>
        </form>
    );
}
