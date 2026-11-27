import { useCallback, useState } from 'react';

// Wraps a button or form action. run(fn, successText) calls fn, tracks pending/error/success,
// and resolves to fn's result, or undefined if it failed.
export function useAction() {
    const [state, setState] = useState({ pending: false, error: '', errorCode: '', success: '' });

    const run = useCallback(async (action, successText = '') => {
        setState({ pending: true, error: '', errorCode: '', success: '' });
        try {
            const result = await action();
            setState({ pending: false, error: '', errorCode: '', success: successText });
            return result ?? true;
        } catch (error) {
            // errorCode: the server's machine-readable code, when it sends one (the payment routes do)
            setState({ pending: false, error: error.message, errorCode: error.code ?? '', success: '' });
            return undefined;
        }
    }, []);

    // clears an old error or success message, e.g. before a dialog is opened again
    const reset = useCallback(() => setState({ pending: false, error: '', errorCode: '', success: '' }), []);

    return { ...state, run, reset };
}
