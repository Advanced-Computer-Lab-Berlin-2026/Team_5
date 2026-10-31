import { useCallback, useState } from 'react';

// Wraps a button or form action. run(fn, successText) calls fn, tracks pending/error/success,
// and resolves to fn's result, or undefined if it failed.
export function useAction() {
    const [state, setState] = useState({ pending: false, error: '', success: '' });

    const run = useCallback(async (action, successText = '') => {
        setState({ pending: true, error: '', success: '' });
        try {
            const result = await action();
            setState({ pending: false, error: '', success: successText });
            return result ?? true;
        } catch (error) {
            setState({ pending: false, error: error.message, success: '' });
            return undefined;
        }
    }, []);

    return { ...state, run };
}
