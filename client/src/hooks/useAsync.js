import { useCallback, useEffect, useState } from 'react';

// Runs `load` on mount and whenever `deps` change. Returns { data, error, loading, reload }.
export function useAsync(load, deps = []) {
    const [state, setState] = useState({ data: null, error: '', loading: true });
    const [reloadCount, setReloadCount] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setState((previous) => ({ ...previous, error: '', loading: true }));
        load()
            .then((data) => {
                if (!cancelled) setState({ data, error: '', loading: false });
            })
            .catch((error) => {
                if (!cancelled) setState({ data: null, error: error.message, loading: false });
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, reloadCount]);

    const reload = useCallback(() => setReloadCount((count) => count + 1), []);
    return { ...state, reload };
}
