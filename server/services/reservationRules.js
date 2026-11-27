import { CheckoutError } from '../utils/CheckoutError.js';

export function validateBorrowingRules(item, borrower, startDate, endDate) {
    const maxDays = item.borrowingRules?.maxDurationDays || 30;
    if (endDate - startDate > maxDays * 86_400_000) {
        throw new CheckoutError(400, 'BORROW_DURATION_EXCEEDED',
            `Reservation duration exceeds maximum allowed of ${maxDays} days`);
    }

    const minimumScore = item.borrowingRules?.minTrustScore ?? 0;
    if ((borrower.trustScore ?? 0) < minimumScore) {
        throw new CheckoutError(403, 'MINIMUM_TRUST_SCORE',
            'Borrower does not meet the minimum trust score requirement for this item');
    }

    if (startDate < new Date()) {
        throw new CheckoutError(400, 'RESERVATION_START_IN_PAST', 'Start date cannot be in the past');
    }
}
