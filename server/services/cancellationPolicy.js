
export function calculateCancellationRefund({
    paidDeposit,
    cancelledBy,
    startDate,
    cancelledAt,
    freeDays,
    forfeitPercent
}) {
    const centsValue = paidDeposit * 100;
    const paidCents = Math.round(centsValue);

    if (!Number.isFinite(paidDeposit) || !Number.isSafeInteger(paidCents) ||
        paidCents < 0 || Math.abs(centsValue - paidCents) > 0.000001) {
        throw new Error('Invalid paid deposit amount.');
    }

    const start = new Date(startDate);
    const now = new Date(cancelledAt);

    if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) {
        throw new Error('Invalid cancellation dates.');
    }

    // A lender cancellation always gives a full refund.
    if (cancelledBy === 'lender') {
        return paidCents / 100;
    }

    if (cancelledBy !== 'member' ||
        !Number.isFinite(freeDays) || freeDays < 0 ||
        !Number.isFinite(forfeitPercent) ||
        forfeitPercent < 0 || forfeitPercent > 100) {
        throw new Error('Invalid cancellation policy.');
    }

    const freeCutoff = start.getTime() - freeDays * 24 * 60 * 60 * 1000;
    const isFree = now.getTime() <= freeCutoff;

    const refundCents = isFree
        ? paidCents
        : Math.round(paidCents * (100 - forfeitPercent) / 100);

    return refundCents / 100;
}
