import { useAsync } from '../hooks/useAsync.js';
import { listIncomingReservations } from '../api/lenderReservations.js';
import { EmptyState, IncomingRequests, PageHeader } from '../components';
import { ExtensionRequests } from '../components/ExtensionRequests.jsx';
import { AcceptedBookings } from '../components/AcceptedBookings.jsx';

// Lender: the requests other people have sent for their items. (Their own bookings as a borrower are on My bookings.)
export default function LenderReservationsPage() {
    const { data } = useAsync(listIncomingReservations);
    return <>
        <PageHeader title="Reservations" />
        <ExtensionRequests />
        <IncomingRequests />
        {data?.reservations.length === 0 && <EmptyState icon="box" title="No requests right now" description="When someone asks to borrow one of your items, the request shows up here with the dates around it." />}
        <AcceptedBookings />
        <AcceptedBookings completed />
    </>;
}
