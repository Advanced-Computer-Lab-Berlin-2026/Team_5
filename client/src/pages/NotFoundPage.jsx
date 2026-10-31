import { Button, Card } from '../components';

export default function NotFoundPage() {
    return (
        <Card title="Page not found" footer={<Button to="/items">Go to catalog</Button>}>
            <p>That page does not exist.</p>
        </Card>
    );
}
