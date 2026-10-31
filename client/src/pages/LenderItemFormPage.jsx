import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { listCategories } from '../api/categories.js';
import { createItem, listMyItems, updateItem, uploadManual, uploadPhotos } from '../api/lenderItems.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, FileUploadCard, ItemForm, Message, PhotoGallery, Spinner } from '../components';

// One page for both "add an item" (no id in the address) and "edit an item".
export default function LenderItemFormPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const save = useAction();

    const categories = useAsync(listCategories);
    // there is no "get one of my items" route, so we take it from the list of my items
    const mine = useAsync(listMyItems);

    if (categories.loading || mine.loading) return <Spinner />;
    const loadError = categories.error || mine.error;
    if (loadError) return <Message type="error">{loadError}</Message>;

    const item = id ? mine.data.items.find((candidate) => candidate._id === id) : undefined;
    if (id && !item) return <><Message type="error">Item not found.</Message><Link to="/lender/items">Back to my items</Link></>;

    async function handleSubmit(body) {
        if (!id) {
            const result = await save.run(() => createItem(body));
            if (result?.item) {
                navigate(`/lender/items/${result.item._id}/edit`, { state: { notice: 'Item created. You can now add photos and a manual.' } });
            }
            return;
        }
        const ok = await save.run(() => updateItem(id, body), 'Item saved.');
        if (ok) mine.reload();
    }

    return (
        <>
            <p><Link to="/lender/items">Back to my items</Link></p>
            <h1>{id ? `Edit ${item.name}` : 'Add an item'}</h1>
            <Message type="success">{location.state?.notice}</Message>
            <Card title="Details">
                <ItemForm key={id ?? 'new'} item={item} categories={categories.data.categories}
                    onSubmit={handleSubmit} pending={save.pending} error={save.error} success={save.success}
                    submitText={id ? 'Save changes' : 'Create item'} />
            </Card>

            {id && (
                <>
                    <Card title="Photos">
                        <PhotoGallery photos={item.photos} alt={item.name} />
                    </Card>
                    <FileUploadCard title="Add photos" name="photos" accept="image/jpeg,image/png" multiple
                        hint="JPG or PNG, up to 5 MB each. An item can have at most 5 photos."
                        buttonText="Upload photos" onUpload={(files) => uploadPhotos(id, files)} onDone={mine.reload} />
                    <FileUploadCard title={item.documents.length > 0 ? 'Replace the manual' : 'Add a manual'} name="manual"
                        accept="application/pdf" hint="A PDF of up to 10 MB."
                        buttonText="Upload manual" onUpload={(files) => uploadManual(id, files[0])} onDone={mine.reload} />
                </>
            )}
        </>
    );
}
