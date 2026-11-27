import { useState } from 'react';
import { Button } from './Button.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';

const BLANK = {
    name: '', description: '', category: '', depositAmount: '', conditionNotes: '',
    pickupLocation: '', pickupInstructions: '', maxDurationDays: '', minTrustScore: '', deliveryOffered: false, deliveryFee: '0', deliveryDetails: '',
    lateFeePerDay: '0', freeDays: '0', forfeitPercent: '0', attributes: []
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
        minTrustScore: item.borrowingRules?.minTrustScore?.toString() ?? '',
        deliveryOffered: item.delivery?.offered ?? false,
        deliveryFee: String(item.delivery?.fee ?? 0),
        deliveryDetails: item.delivery?.details ?? '',
        lateFeePerDay: String(item.borrowingRules?.lateFeePerDay ?? 0),
        freeDays: String(item.cancellation?.freeDays ?? 0),
        forfeitPercent: String(item.cancellation?.forfeitPercent ?? 0),
        attributes: (item.attributes ?? []).map(({ key, value }) => ({ key: key ?? '', value: value ?? '' }))
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
        pickupInstructions: values.pickupInstructions,
        delivery: { offered: values.deliveryOffered, fee: Number(values.deliveryFee), details: values.deliveryDetails },
        cancellation: { freeDays: Number(values.freeDays), forfeitPercent: Number(values.forfeitPercent) },
        attributes: values.attributes.map(({ key, value }) => ({ key: key.trim(), value: value.trim() }))
    };
    const rules = { lateFeePerDay: Number(values.lateFeePerDay) };
    if (values.maxDurationDays !== '') rules.maxDurationDays = Number(values.maxDurationDays);
    if (values.minTrustScore !== '') rules.minTrustScore = Number(values.minTrustScore);
    body.borrowingRules = rules;
    return body;
}

// Create or edit form for a lender's item. onSubmit(body) saves; categories: [{ _id, name }].
export function ItemForm({ item, categories, onSubmit, pending, error, success, submitText }) {
    const [values, setValues] = useState(() => toFormValues(item));
    const bindAttribute = (index, field) => ({
        name: `attribute-${index}-${field}`,
        value: values.attributes[index][field],
        onChange: ({ target }) => setValues(current => ({
            ...current,
            attributes: current.attributes.map((attribute, position) =>
                position === index ? { ...attribute, [field]: target.value } : attribute)
        }))
    });

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
            <FormField label="Late fee per day (₥)" type="number" min="0" step="0.01" required {...bind('lateFeePerDay')} />
            <FormField label="Free cancellation cutoff (days before pickup)" type="number" min="0" step="1" required {...bind('freeDays')} />
            <FormField label="Deposit kept after the cutoff (%)" type="number" min="0" max="100" step="any" required {...bind('forfeitPercent')} />
            <fieldset>
                <legend>Item attributes</legend>
                {values.attributes.map((_, index) => <div key={index}>
                    <FormField label="Attribute name" required {...bindAttribute(index, 'key')} />
                    <FormField label="Attribute value" required {...bindAttribute(index, 'value')} />
                    <Button type="button" variant="secondary" onClick={() => setValues(current => ({
                        ...current, attributes: current.attributes.filter((_, position) => position !== index)
                    }))}>Remove attribute</Button>
                </div>)}
                <Button type="button" variant="secondary" onClick={() => setValues(current => ({
                    ...current, attributes: [...current.attributes, { key: '', value: '' }]
                }))}>Add attribute</Button>
            </fieldset>
            <label><input type="checkbox" checked={values.deliveryOffered} onChange={event => setValues({ ...values, deliveryOffered: event.target.checked })} /> Offer delivery</label>
            {values.deliveryOffered && <>
                <FormField label="Delivery fee (₥)" type="number" min="0" step="0.01" required {...bind('deliveryFee')} />
                <FormField label="Delivery instructions" {...bind('deliveryDetails')} />
            </>}
            <Message type="success">{success}</Message>
            <Message type="error">{error}</Message>
            <Button type="submit" disabled={pending}>{pending ? 'Saving...' : submitText}</Button>
        </form>
    );
}
