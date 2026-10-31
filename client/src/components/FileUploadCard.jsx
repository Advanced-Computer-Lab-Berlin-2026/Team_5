import { useState } from 'react';
import { useAction } from '../hooks/useAction.js';
import { Button } from './Button.jsx';
import { Card } from './Card.jsx';
import { FileField } from './FileField.jsx';
import { Message } from './Message.jsx';

// A card with a file picker and an upload button.
// onUpload(files) does the upload; onDone() runs after it succeeds (usually a reload).
export function FileUploadCard({ title, name, accept, multiple = false, hint, buttonText = 'Upload', onUpload, onDone }) {
    const { pending, error, success, run } = useAction();
    const [files, setFiles] = useState([]);
    // changing the key clears the file picker after a successful upload
    const [pickerKey, setPickerKey] = useState(0);

    async function handleUpload() {
        const ok = await run(() => onUpload(files), 'Uploaded.');
        if (ok) {
            setFiles([]);
            setPickerKey((key) => key + 1);
            onDone?.();
        }
    }

    return (
        <Card title={title}>
            <FileField key={pickerKey} label="Choose file" name={name} accept={accept} multiple={multiple}
                hint={hint} onChange={setFiles} />
            <Message type="success">{success}</Message>
            <Message type="error">{error}</Message>
            <div>
                <Button disabled={pending || files.length === 0} onClick={handleUpload}>
                    {pending ? 'Uploading...' : buttonText}
                </Button>
            </div>
        </Card>
    );
}
