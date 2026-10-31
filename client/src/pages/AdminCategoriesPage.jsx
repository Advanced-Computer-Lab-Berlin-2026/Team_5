import { useState } from 'react';
import { setDepositMultiplier } from '../api/admin.js';
import { listCategories } from '../api/categories.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Input, Message, Row, Spinner, Table } from '../components';

export default function AdminCategoriesPage() {
    const { data, error, loading } = useAsync(listCategories);
    const save = useAction();
    // what the admin typed for each category, keyed by category id
    const [values, setValues] = useState({});

    return (
        <>
            <h1>Admin: deposit multipliers</h1>
            <p>The deposit of every item in a category is multiplied by this number. It must be at least 1.</p>
            {loading && <Spinner />}
            <Message type="error">{error || save.error}</Message>
            <Message type="success">{save.success}</Message>
            {data && (
                <Table
                    rows={data.categories}
                    getRowKey={(category) => category._id}
                    empty="No categories."
                    columns={[
                        { key: 'name', header: 'Category' },
                        {
                            key: 'multiplier', header: 'New multiplier',
                            render: (category) => (
                                <Row>
                                    <Input type="number" min="1" step="any" aria-label={`Multiplier for ${category.name}`}
                                        value={values[category._id] ?? ''}
                                        onChange={(event) => setValues({ ...values, [category._id]: event.target.value })} />
                                    <Button disabled={save.pending || !values[category._id]}
                                        onClick={() => save.run(
                                            () => setDepositMultiplier(category._id, Number(values[category._id])),
                                            `Saved ${category.name}.`
                                        )}>Save</Button>
                                </Row>
                            )
                        }
                    ]}
                />
            )}
        </>
    );
}
