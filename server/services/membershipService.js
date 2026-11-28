import { User } from '../models/User.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { FriendLink } from '../models/FriendLink.js';
import { Reservation } from '../models/Reservation.js';
import { CheckoutError } from '../utils/CheckoutError.js';

// SCRUM-497: how many reservations a member can have open (pending, upcoming or active) at once.
// Only Premium (5) comes from the ticket; Basic and Plus are our choice, change them here.
export const MAX_CONCURRENT_RESERVATIONS = { Basic: 2, Plus: 3, Premium: 5 };
export const WAITLIST_PRIORITY = { Basic: 3, Plus: 2, Premium: 1 };
const OPEN_STATUSES = ['pending', 'upcoming', 'active'];

// A paid tier counts only until its renewal date. Older users have no renewalDate, so they count as active.
export function activeTier(membership, now = new Date()) {
    const tier = membership?.tier;
    if (!tier) return 'Basic';
    if (membership.renewalDate && new Date(membership.renewalDate) <= now) return 'Basic';
    return tier;
}

export async function getHouseholdWaitlistPriorities(users, now, session) {
    const ids = users.map(user => user._id);
    const priorities = new Map();
    if (!ids.length) return priorities;
    const links = await FriendLink.find({
        status: 'accepted', $or: [{ requester: { $in: ids } }, { recipient: { $in: ids } }]
    }, { requester: 1, recipient: 1 }, { lean: true, session });
    const linkedIds = [...new Set(links.flatMap(link => [link.requester, link.recipient]))];
    const linkedUsers = linkedIds.length ? await User.find({ _id: { $in: linkedIds }, suspended: { $ne: true } },
        { membership: 1 }, { lean: true, session }) : [];
    const tiers = [...new Set([...users, ...linkedUsers].map(user => activeTier(user.membership, now)))];
    const settings = await MembershipTier.find({ _id: { $in: tiers } }, { waitlistPriority: 1 }, { lean: true, session });
    const configured = new Map(settings.map(tier => [tier._id, tier.waitlistPriority]));
    const rank = user => {
        const tier = activeTier(user.membership, now);
        return configured.get(tier) ?? WAITLIST_PRIORITY[tier] ?? WAITLIST_PRIORITY.Basic;
    };
    for (const user of users) priorities.set(user._id, rank(user));
    const individual = new Map(linkedUsers.map(user => [user._id, rank(user)]));
    for (const { requester, recipient } of links) {
        for (const [user, householdMember] of [[requester, recipient], [recipient, requester]]) {
            if (priorities.has(user) && individual.has(householdMember)) {
                priorities.set(user, Math.min(priorities.get(user), individual.get(householdMember)));
            }
        }
    }
    return priorities;
}

// SCRUM-495 / 496: the best deposit discount (in %) the borrower gets, from their own tier or from an accepted household member's tier
export async function getDepositDiscountPercent(borrower, now = new Date(), session = null) {
    const tierNames = new Set([activeTier(borrower.membership, now)]);

    const links = await FriendLink.find(
        { status: 'accepted', $or: [{ requester: borrower._id }, { recipient: borrower._id }] },
        { requester: 1, recipient: 1 },
        { session }
    ).lean();

    if (links.length > 0) {
        const householdIds = links.map((link) => (link.requester === borrower._id ? link.recipient : link.requester));
        const household = await User.find({ _id: { $in: householdIds } }, { membership: 1 }, { session }).lean();
        for (const member of household) tierNames.add(activeTier(member.membership, now));
    }

    // the percentages live in the MembershipTier collection, so an admin can change them without a code change
    const tiers = await MembershipTier.find({ _id: { $in: [...tierNames] } }, null, { session }).lean();
    return Math.max(0, ...tiers.map((tier) => tier.deposit_discount ?? 0));
}

// the deposit after the discount, rounded to 2 decimals
export function applyDiscount(deposit, percent) {
    return Math.round(deposit * (100 - percent)) / 100;
}

// SCRUM-497: true when the borrower already has as many open reservations as their tier allows
export async function hasReachedReservationLimit(borrower, session, now = new Date(), requested = 1) {
    const tier = activeTier(borrower.membership, now);
    const settings = await MembershipTier.findById(tier, { maxConcurrentReservations: 1 }, { session, lean: true });
    const limit = settings?.maxConcurrentReservations ?? MAX_CONCURRENT_RESERVATIONS[tier] ?? MAX_CONCURRENT_RESERVATIONS.Basic;
    // a request the owner never answered stops counting once its start date has passed: it can no longer be approved or cancelled,
    // so counting it would use up the borrower's slot forever
    const open = await Reservation.countDocuments(
        {
            borrower: borrower._id,
            $or: [
                { status: { $in: OPEN_STATUSES.filter((status) => status !== 'pending') } },
                { status: 'pending', startDate: { $gt: now } }
            ]
        },
        { session }
    );
    return { reached: open + requested > limit, limit, tier };
}

export async function requireReservationCapacity(borrower, requested, session) {
    const { reached, tier, limit } = await hasReachedReservationLimit(borrower, session, new Date(), requested);
    if (reached) throw new CheckoutError(409, 'MEMBERSHIP_RESERVATION_LIMIT', `Your ${tier} membership allows up to ${limit} open reservations at a time.`);
}
