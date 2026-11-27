import { Category } from '../models/Category.js';
import { applyDiscount } from './membershipService.js';

export async function getReservationDeposit(item, membershipDiscount, session = null) {
    const category = item.category
        ? await Category.findById(item.category, 'depositMultiplier', { session }).lean()
        : null;
    const deposit = item.depositAmount ?? 0;
    if (!Number.isFinite(deposit) || deposit < 0) {
        throw new Error('Invalid deposit amount.');
    }
    return applyDiscount(deposit * (category?.depositMultiplier ?? 1), membershipDiscount);
}
