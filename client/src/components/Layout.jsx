import { Outlet } from 'react-router-dom';
import { Nav } from './Nav.jsx';
import styles from './Layout.module.css';

export function Layout() {
    return (
        <>
            <Nav />
            <main className={styles.main}>
                <Outlet />
            </main>
        </>
    );
}
