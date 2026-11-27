import { useAsync } from '../hooks/useAsync.js';
import { listIncomingReservations } from '../api/lenderReservations.js';
import { EmptyState, IncomingRequests, PageHeader } from '../components';
import { toKey } from '../components/Calendar.jsx';
import { ExtensionRequests } from '../components/ExtensionRequests.jsx';
import { AcceptedBookings } from '../components/AcceptedBookings.jsx';

// Lender: the requests other people have sent for their items. (Their own bookings as a borrower are on My bookings.)
export default function LenderReservationsPage() {
    const { data } = useAsync(listIncomingReservations);
    // requests whose start day is over are hidden (see IncomingRequests), so they do not count here either
    const today = toKey(new Date());
    const live = (data?.reservations ?? []).filter(request => { const date = new Date(request.startDate); return toKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) >= today; });
    return <>
        <PageHeader title="Reservations" />
        <ExtensionRequests />
        <IncomingRequests />
        {data && live.length === 0 && <EmptyState icon="box" title="No requests right now" description="When someone asks to borrow one of your items, the request shows up here with the dates around it." />}
        <AcceptedBookings />
    </>;
}
