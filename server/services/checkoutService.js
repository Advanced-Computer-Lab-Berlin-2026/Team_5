import { User } from '../models/User.js';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { Payment } from '../models/Payment.js';
import { Checkout } from '../models/Checkout.js';
import mongoose from 'mongoose';
import { CheckoutError } from '../utils/CheckoutError.js';
import { calculateCheckoutPricing, normalizePromoCode } from './checkoutPricingService.js';
import { redeemCheckoutPromo } from './checkoutPromoRedemption.js';
export function validateBorrowList(borrowList) {
    if (!Array.isArray(borrowList) || borrowList.length === 0) {
        throw new CheckoutError(
            400,
            'EMPTY_BORROW_LIST',
            'Borrow list is empty.'
        );
    }

    const itemIds = new Set();

    for (const entry of borrowList) {
        if (!entry.item || !entry.startDate || !entry.endDate) {
            throw new CheckoutError(
                400,
                'INVALID_BORROW_LIST_ENTRY',
                'Each borrow list entry must include item, startDate, and endDate.'
            );
        }

        const start = new Date(entry.startDate);
        const end = new Date(entry.endDate);

        if (
            Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime()) ||
            end <= start
        ) {
            throw new CheckoutError(
                400,
                'INVALID_BORROW_LIST_ENTRY',
                `Invalid date range for item ${entry.item}.`
            );
        }

        if (itemIds.has(entry.item)) {
            throw new CheckoutError(
                400,
                'DUPLICATE_BORROW_LIST_ENTRY',
                `Duplicate item ${entry.item} in borrow list.`
            );
        }

        itemIds.add(entry.item);
    }

    return true;
}

export async function acquireCheckoutLock(itemId, session) {
    if (!session || !session.inTransaction()) {
        throw new Error('An active transaction is required.');
    }

    const item = await Item.findOneAndUpdate(
        {
            _id: itemId,
            archived: false,
            flagged: { $ne: true }
        },
        {
            $inc: { checkoutVersion: 1 }
        },
        {
            new: true,
            session
        }
    );

    if (!item) {
        throw new CheckoutError(
            409,
            'ITEM_UNAVAILABLE',
            `Item with ID ${itemId} is no longer available.`
        );
    }

    return item;
}

export async function lockAndCheckAvailability(checkoutItems, session) {
    if (!session || !session.inTransaction()) {
        throw new Error('An active transaction is required.');
    }

    // Sort items by ID to ensure a consistent locking order
    const items = [...checkoutItems].sort((a, b) =>
        a.itemId.localeCompare(b.itemId)
    );

    for (const entry of items) {
        // Acquire the checkout lock for this item
        await acquireCheckoutLock(entry.itemId, session);

        // Check for existing reservations with overlapping dates
        const overlappingReservation = await Reservation.findOverlap(
            entry.itemId,
            entry.startDate,
            entry.endDate,
            session
        );

        if (overlappingReservation) {
            throw new CheckoutError(
                409,
                'ITEM_ALREADY_RESERVED',
                `Item with ID ${entry.itemId} is unavailable for the selected dates.`
            );
        }
    }

    return items;
}

export async function prepareCheckout(userId, session = null) {

    const user = await User.findById(userId)
        .select('borrow_list')
        .session(session);

    if (!user) {
        throw new Error('User not found.');
    }

    const borrowList = user.borrow_list;
    validateBorrowList(borrowList);

    const checkoutItems = [];

    for (const entry of borrowList) {

        const item = await Item.findById(entry.item).session(session);

        if (!item) {
            throw new CheckoutError(
                409,
                'ITEM_UNAVAILABLE',
                `Item with ID ${entry.item} no longer exists.`
            );
        }

        if (item.archived) {
            throw new CheckoutError(
                409,
                'ITEM_ARCHIVED',
                `Item with ID ${entry.item} is archived.`
            );
        }

        if (item.flagged) {
            throw new CheckoutError(
                409,
                'ITEM_UNAVAILABLE',
                `Item with ID ${entry.item} no longer exists.`
            );
        }

        if (item.owner === userId) {
            throw new CheckoutError(
                409,
                'ITEM_UNAVAILABLE',
                `User cannot borrow their own item with ID ${entry.item}.`
            );
        }

        const owner = await User.findById(item.owner)
            .select('suspended')
            .session(session);

        if (!owner) {
            throw new CheckoutError(
                409,
                'ITEM_UNAVAILABLE',
                `Owner of item with ID ${entry.item} is suspended.`
            );
        }

        if (owner.suspended) {
            throw new CheckoutError(
                409,
                'ITEM_UNAVAILABLE',
                `Owner of item with ID ${entry.item} is suspended.`
            );
        }

        checkoutItems.push({
            itemId: item._id,
            lenderId: item.owner,
            startDate: new Date(entry.startDate),
            endDate: new Date(entry.endDate),
            depositAmount: item.depositAmount,
            cancellationPolicy: {
                freeDays: item.cancellation?.freeDays ?? 0,
                forfeitPercent: item.cancellation?.forfeitPercent ?? 0
            }
        });
    }

    return checkoutItems;
}


export async function removeConflictingBorrowListEntries(checkoutItems, userId, session) {
    if (!session || !session.inTransaction()) {
        throw new Error('An active transaction is required.');
    }

    for (const entry of checkoutItems) {
        await User.updateMany(
            {
                _id: { $ne: userId }
            },
            {
                $pull: {
                    borrow_list: {
                        item: entry.itemId,
                        startDate: { $lt: entry.endDate },
                        endDate: { $gt: entry.startDate }
                    }
                }
            },
            { session }
        );
    }
}




function formatCheckoutResult(checkout, replayed = false) {
    if (checkout.method !== 'wallet') {
        throw new CheckoutError(
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
            'This checkout key was already used for another payment method.'
        );
    }

    return {
        checkoutId: checkout._id,
        reservations: checkout.reservations,
        payments: checkout.payments,
        totalDeposit: checkout.totalDeposit,
        originalTotal: checkout.originalTotal ?? checkout.totalDeposit,
        promoCode: checkout.promoCode ?? null,
        promoDiscountPercent: checkout.promoDiscountPercent ?? 0,
        remainingBalance: checkout.remainingBalance,
        replayed
    };
}

function assertMatchingWalletPromo(checkout, requestedPromo) {
    if (normalizePromoCode(checkout.promoCode) !== requestedPromo) {
        throw new CheckoutError(
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
            'This idempotency key was already used with a different promo code.'
        );
    }
}

export async function checkoutWithWallet(userId, idempotencyKey, promoCode = null) {

    // 1. Validate the idempotency key
    if (
        typeof idempotencyKey !== 'string' ||
        !idempotencyKey.trim() ||
        idempotencyKey.length > 128
    ) {
        throw new CheckoutError(
            400,
            'INVALID_IDEMPOTENCY_KEY',
            'A valid idempotency key is required.'
        );
    }

    const key = idempotencyKey.trim();
    const requestedPromo = normalizePromoCode(promoCode);

    // 2. Check if this checkout was already completed
    const existingCheckout = await Checkout.findOne({
        user: userId,
        idempotencyKey: key
    });

    if (existingCheckout) {
        assertMatchingWalletPromo(existingCheckout, requestedPromo);
        return formatCheckoutResult(existingCheckout, true);
    }

    const session = await mongoose.startSession();

    try {
        return await session.withTransaction(async () => {

            // 3. Check again inside the transaction
            const previousCheckout = await Checkout.findOne({
                user: userId,
                idempotencyKey: key
            }).session(session);

            if (previousCheckout) {
                assertMatchingWalletPromo(previousCheckout, requestedPromo);
                return formatCheckoutResult(previousCheckout, true);
            }

            // 4. Prepare the borrow list
            const checkoutItems = await prepareCheckout(userId, session);

            // 5. Acquire locks and verify availability
            const availableItems = await lockAndCheckAvailability(
                checkoutItems,
                session
            );

            

            // 6. Calculate total deposit
            const pricing = await calculateCheckoutPricing(userId, availableItems, requestedPromo, session);
            const totalDeposit = pricing.totalDeposit;
            const pricedItems = pricing.items;

            if (!Number.isFinite(totalDeposit)) {
                throw new Error('Invalid total deposit amount.');
            }

            // 7. Deduct wallet balance atomically
            const user = await User.findOneAndUpdate(
                {
                    _id: userId,
                    role: 'member',
                    suspended: { $ne: true },
                    wallet: { $gte: totalDeposit }
                },
                {
                    $inc: { wallet: -totalDeposit }
                },
                {
                    new: true,
                    session
                }
            );

            if (!user) {
                throw new CheckoutError(
                    409,
                    'WALLET_PAYMENT_FAILED',
                    'Insufficient wallet balance or member not eligible.'
                );
            }

            // 8. Create reservations and payment records
            const reservations = [];
            const payments = [];

            for (const entry of pricedItems) {

                const [reservation] = await Reservation.create(
                    [{
                        item: entry.itemId,
                        borrower: userId,
                        lender: entry.lenderId,
                        startDate: entry.startDate,
                        endDate: entry.endDate,
                        status: 'pending',
                        payment: {
                            depositAmount: entry.depositAmount,
                            method: 'wallet'
                        },
                        cancellationPolicy: entry.cancellationPolicy,
                    }],
                    { session }
                );

                reservations.push(reservation);

                const [payment] = await Payment.create(
                    [{
                        user: userId,
                        reservation: reservation._id,
                        type: 'deposit-paid',
                        amount: entry.depositAmount,
                        direction: 'deduct',
                        method: 'wallet'
                    }],
                    { session }
                );

                payments.push(payment);
            }

            // 9. Clear the buyer's borrow list
            await User.updateOne(
                { _id: userId },
                { $set: { borrow_list: [] } },
                { session }
            );

            // 10. Remove conflicting entries from other users
            await removeConflictingBorrowListEntries(
                availableItems,
                userId,
                session
            );

            // 11. Save the completed checkout
            const [checkout] = await Checkout.create(
                [{
                    user: userId,
                    idempotencyKey: key,
                    method: 'wallet',
                    reservations: reservations.map(r => r._id),
                    payments: payments.map(p => p._id),
                    totalDeposit,
                    originalTotal: pricing.originalTotal,
                    promoCode: pricing.promoCode,
                    promoDiscountPercent: pricing.discountPercent,
                    remainingBalance: user.wallet
                }],
                { session }
            );

            // Count one promo redemption for the entire checkout, not each item.
            // If this fails, wallet charge, payments and reservations roll back.
            await redeemCheckoutPromo({
                promoCode: pricing.promoCode,
                userId,
                checkoutId: checkout._id,
                paymentIds: payments.map(p => p._id),
                reservationIds: reservations.map(r => r._id),
                pricing,
                session
            });

            // 12. Return the saved checkout result
            return formatCheckoutResult(checkout);
        });

    } catch (error) {

        // 13. Another concurrent request may have completed
        // the checkout using the same unique key.
        if (error.code === 11000) {
            const completedCheckout = await Checkout.findOne({
                user: userId,
                idempotencyKey: key
            });

            if (completedCheckout) {
                assertMatchingWalletPromo(completedCheckout, requestedPromo);
                return formatCheckoutResult(completedCheckout, true);
            }
        }

        throw error;

    } finally {
        await session.endSession();
    }
}

