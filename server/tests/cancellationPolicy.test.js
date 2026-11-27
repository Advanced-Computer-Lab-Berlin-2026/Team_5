
import { describe, it, expect } from 'vitest';
import { calculateCancellationRefund } from '../services/cancellationPolicy.js';

const initial = {
    paidDeposit: 100,
    startDate: new Date('2027-05-10T10:00:00Z'),
    freeDays: 2,
    forfeitPercent: 20
};

describe('calculateCancellationRefund', () => {
    it('returns the full deposit for lender cancellation', () => {
        expect(calculateCancellationRefund({
            ...initial,
            cancelledBy: 'lender',
            cancelledAt: '2027-05-09T10:00:00Z'
        })).toBe(100);
    });

    it('returns full refund at the free cancellation cutoff', () => {
        expect(calculateCancellationRefund({
            ...initial,
            cancelledBy: 'member',
            cancelledAt: '2027-05-08T10:00:00Z'
        })).toBe(100);
    });

    it('returns partial refund after the cutoff', () => {
        expect(calculateCancellationRefund({
            ...initial,
            cancelledBy: 'member',
            cancelledAt: '2027-05-09T10:00:00Z'
        })).toBe(80);
    });

    it('calculates using the deposit actually paid', () => {
        expect(calculateCancellationRefund({
            ...initial,
            paidDeposit: 80,
            cancelledBy: 'member',
            cancelledAt: '2027-05-09T10:00:00Z'
        })).toBe(64);
    });

    it('rounds cents correctly', () => {
        expect(calculateCancellationRefund({
            ...initial,
            paidDeposit: 0.03,
            forfeitPercent: 50,
            cancelledBy: 'member',
            cancelledAt: '2027-05-09T10:00:00Z'
        })).toBe(0.02);
    });
});
