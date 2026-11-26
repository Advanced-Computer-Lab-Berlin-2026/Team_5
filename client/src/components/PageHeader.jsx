import { BackLink } from './BackLink.jsx';
import styles from './PageHeader.module.css';

export function PageHeader({ title, actions, backTo, backLabel, backHistory = false }) {
    return <header className={styles.header}>
        <div className={styles.copy}>
            {backTo ? <div className={styles.titleRow}><BackLink to={backTo} label={backLabel} history={backHistory} /><h1>{title}</h1></div> : <h1>{title}</h1>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
    </header>;
}
