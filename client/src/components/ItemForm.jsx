import { useState } from 'react';
import { Button } from './Button.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';

const BLANK = {
    name: '', description: '', category: '', depositAmount: '', conditionNotes: '',
    pickupLocation: '', pickupInstructions: '', maxDurationDays: '', minTrustScore: ''
};

// Turns a saved item into the text values the form fields show.
function toFormValues(item) {
    if (!item) return BLANK;
    return {
        name: item.name,
        description: item.description,
        category: item.category,
        depositAmount: String(item.depositAmount),
        conditionNotes: (item.conditionNotes ?? []).join('\n'),
        pickupLocation: item.pickup?.location ?? '',
        pickupInstructions: item.pickup?.instructions ?? '',
        maxDurationDays: item.borrowingRules?.maxDurationDays?.toString() ?? '',
        minTrustScore: item.borrowingRules?.minTrustScore?.toString() ?? ''
    };
}

// Turns the text values back into the body the server expects.
function toRequestBody(values) {
    const body = {
        name: values.name,
        description: values.description,
        category: values.category,
        depositAmount: Number(values.depositAmount),
        conditionNotes: values.conditionNotes.split('\n').map((line) => line.trim()).filter(Boolean),
        pickupLocation: values.pickupLocation,
        pickupInstructions: values.pickupInstructions
    };
    // the server rejects an empty borrowingRules object, so only send it when something is set
    const rules = {};
    if (values.maxDurationDays !== '') rules.maxDurationDays = Number(values.maxDurationDays);
    if (values.minTrustScore !== '') rules.minTrustScore = Number(values.minTrustScore);
    if (Object.keys(rules).length > 0) body.borrowingRules = rules;
    return body;
}

// Create or edit form for a lender's item. onSubmit(body) saves; categories: [{ _id, name }].
export function ItemForm({ item, categories, onSubmit, pending, error, success, submitText }) {
    const [values, setValues] = useState(() => toFormValues(item));

    const bind = (field) => ({
        name: field,
        value: values[field],
        onChange: (event) => setValues({ ...values, [field]: event.target.value })
    });
    const categoryOptions = [
        { value: '', label: 'Choose a category' },
        ...categories.map((category) => ({ value: category._id, label: category.name }))
    ];

    function handleSubmit(event) {
        event.preventDefault();
        onSubmit(toRequestBody(values));
    }

    return (
        <form onSubmit={handleSubmit}>
            <FormField label="Name" required {...bind('name')} />
            <FormField label="Description" as="textarea" required {...bind('description')} />
            <FormField label="Category" as="select" options={categoryOptions} required {...bind('category')} />
            <FormField label="Deposit (₥)" type="number" min="0" step="any" required {...bind('depositAmount')} />
            <FormField label="Condition notes" as="textarea" hint="One note per line" {...bind('conditionNotes')} />
            <FormField label="Pickup location" required {...bind('pickupLocation')} />
            <FormField label="Pickup instructions" as="textarea" {...bind('pickupInstructions')} />
            <FormField label="Maximum days to borrow" type="number" min="1" step="1" {...bind('maxDurationDays')} />
            <FormField label="Minimum trust score" type="number" min="0" max="100" hint="0 to 100" {...bind('minTrustScore')} />
            <Message type="success">{success}</Message>
            <Message type="error">{error}</Message>
            <Button type="submit" disabled={pending}>{pending ? 'Saving...' : submitText}</Button>
        </form>
    );
}
