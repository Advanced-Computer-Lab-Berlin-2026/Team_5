
import mongoose from 'mongoose';
import { Reservation } from '../models/Reservation.js';
import { ExtensionRequest } from '../models/ExtensionRequest.js';
import { acquireCheckoutLock } from './checkoutService.js';
import { formatNotificationDate, notifyInApp } from './notificationService.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { checkWaitlistAvailability } from './waitlistAvailability.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;

function validateReservationId(id) {
    if (!RESERVATION_ID_PATTERN.test(id)) {
        throw new CheckoutError(
            400,
            'INVALID_RESERVATION_ID',
            'Invalid reservation ID.'
        );
    }
}

function parseEndDate(value) {
    if (typeof value !== 'string') {
        throw new CheckoutError(
            400,
            'INVALID_END_DATE',
            'A valid requestedEndDate is required.'
        );
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new CheckoutError(
            400,
            'INVALID_END_DATE',
            'A valid requestedEndDate is required.'
        );
    }

    return date;
}

// SCRUM-472: Borrower requests an extension.
export async function requestExtension(
    reservationId,
    borrowerId,
    requestedEndDate
) {
    validateReservationId(reservationId);

    const newEndDate = parseEndDate(requestedEndDate);

    const reservation = await Reservation.findById(reservationId);

    if (!reservation) {
        throw new CheckoutError(
            404,
            'RESERVATION_NOT_FOUND',
            'Reservation not found.'
        );
    }

    if (reservation.borrower !== borrowerId) {
        throw new CheckoutError(
            403,
            'NOT_BORROWER',
            'Only the borrower can request an extension.'
        );
    }

    if (reservation.status !== 'active') {
        throw new CheckoutError(
            409,
            'RESERVATION_NOT_ACTIVE',
            'Only active reservations can be extended.'
        );
    }

    if (newEndDate <= reservation.endDate) {
        throw new CheckoutError(
            400,
            'INVALID_END_DATE',
            'The new return date must be later than the current return date.'
        );
    }

    const pending = await ExtensionRequest.findOne({
        reservation: reservationId,
        status: 'requested'
    });

    if (pending) {
        throw new CheckoutError(
            409,
            'EXTENSION_ALREADY_REQUESTED',
            'An extension request is already pending.'
        );
    }

    // Check only the additional time, excluding this reservation.
    const overlap = await Reservation.findOverlap(
        reservation.item,
        reservation.endDate,
        newEndDate,
        null,
        reservation._id
    );

    if (overlap) {
        throw new CheckoutError(
            409,
            'EXTENSION_DATES_UNAVAILABLE',
            'The item is already reserved during the requested extension.'
        );
    }
    await checkWaitlistAvailability({ _id: reservation.item, owner: reservation.lender },
        reservation.borrower, reservation.endDate, newEndDate);

    const session = await mongoose.startSession();

    try {
        return await session.withTransaction(async () => {
            const [request] = await ExtensionRequest.create([{
                reservation: reservation._id,
                originalEndDate: reservation.endDate,
                requestedEndDate: newEndDate,
                status: 'requested'
            }], { session }).catch((error) => {
                if (error.code === 11000) {
                    throw new CheckoutError(
                        409,
                        'EXTENSION_ALREADY_REQUESTED',
                        'An extension request is already pending.'
                    );
                }
                throw error;
            });

            const date = formatNotificationDate(request.requestedEndDate);
            await notifyInApp(reservation.lender, {
                reservation: reservation._id,
                message: `A member requested an extension for reservation ${reservation._id} until ${date}.`
            }, session);

            return {
                requestId: request._id,
                reservationId: reservation._id,
                originalEndDate: request.originalEndDate,
                requestedEndDate: request.requestedEndDate,
                status: request.status
            };
        });
    } finally {
        await session.endSession();
    }
}

// SCRUM-474: Lender accepts or rejects an extension.
export async function decideExtension(
    reservationId,
    requestId,
    lenderId,
    decision
) {
    validateReservationId(reservationId);

    if (!mongoose.isValidObjectId(requestId)) {
        throw new CheckoutError(
            400,
            'INVALID_EXTENSION_ID',
            'Invalid extension request ID.'
        );
    }

    if (!['accept', 'reject'].includes(decision)) {
        throw new CheckoutError(
            400,
            'INVALID_DECISION',
            'Decision must be accept or reject.'
        );
    }

    const session = await mongoose.startSession();

    try {
        return await session.withTransaction(async () => {
            const reservation = await Reservation.findById(
                reservationId
            ).session(session);

            if (!reservation) {
                throw new CheckoutError(
                    404,
                    'RESERVATION_NOT_FOUND',
                    'Reservation not found.'
                );
            }

            if (reservation.lender !== lenderId) {
                throw new CheckoutError(
                    403,
                    'NOT_LENDER',
                    'Only the reservation lender can decide.'
                );
            }

            if (reservation.status !== 'active') {
                throw new CheckoutError(
                    409,
                    'RESERVATION_NOT_ACTIVE',
                    'Only active reservations can be extended.'
                );
            }

            const request = await ExtensionRequest.findOne({
                _id: requestId,
                reservation: reservationId
            }).session(session);

            if (!request) {
                throw new CheckoutError(
                    404,
                    'EXTENSION_NOT_FOUND',
                    'Extension request not found.'
                );
            }

            if (request.status !== 'requested') {
                throw new CheckoutError(
                    409,
                    'EXTENSION_ALREADY_DECIDED',
                    'This extension request was already decided.'
                );
            }

            if (
                request.originalEndDate.getTime() !==
                reservation.endDate.getTime()
            ) {
                throw new CheckoutError(
                    409,
                    'EXTENSION_OUTDATED',
                    'The reservation return date has changed.'
                );
            }

            if (decision === 'reject') {
                const rejected = await ExtensionRequest.findOneAndUpdate(
                    {
                        _id: request._id,
                        status: 'requested'
                    },
                    { $set: { status: 'rejected' } },
                    { new: true, session }
                );

                if (!rejected) {
                    throw new CheckoutError(
                        409,
                        'EXTENSION_CONFLICT',
                        'The extension request has changed.'
                    );
                }

                await notifyInApp(reservation.borrower, {
                    reservation: reservationId,
                    message: `Your extension request for reservation ${reservationId} was rejected.`
                }, session);

                return {
                    requestId: rejected._id,
                    reservationId,
                    status: 'rejected',
                    endDate: reservation.endDate
                };
            }

            // Lock the same Item used by checkout transactions.
            const item = await acquireCheckoutLock(reservation.item, session);

            // Recheck availability when approving.
            const overlap = await Reservation.findOverlap(
                reservation.item,
                reservation.endDate,
                request.requestedEndDate,
                session,
                reservation._id
            );

            if (overlap) {
                throw new CheckoutError(
                    409,
                    'EXTENSION_DATES_UNAVAILABLE',
                    'Another reservation conflicts with the extension.'
                );
            }
            await checkWaitlistAvailability(item, reservation.borrower, reservation.endDate, request.requestedEndDate, session);

            // Change the return date only if still active and unchanged.
            const updatedReservation = await Reservation.findOneAndUpdate(
                {
                    _id: reservation._id,
                    status: 'active',
                    endDate: request.originalEndDate
                },
                {
                    $set: {
                        endDate: request.requestedEndDate
                    }
                },
                { new: true, session }
            );

            if (!updatedReservation) {
                throw new CheckoutError(
                    409,
                    'EXTENSION_CONFLICT',
                    'The reservation changed during approval.'
                );
            }

            const accepted = await ExtensionRequest.findOneAndUpdate(
                {
                    _id: request._id,
                    status: 'requested'
                },
                { $set: { status: 'accepted' } },
                { new: true, session }
            );

            if (!accepted) {
                throw new CheckoutError(
                    409,
                    'EXTENSION_CONFLICT',
                    'The extension request changed during approval.'
                );
            }

            const date = formatNotificationDate(updatedReservation.endDate);
            await notifyInApp(reservation.borrower, {
                reservation: reservationId,
                message: `Your extension request for reservation ${reservationId} was accepted. Your new return date is ${date}.`
            }, session);

            return {
                requestId: accepted._id,
                reservationId,
                status: 'accepted',
                endDate: updatedReservation.endDate
            };
        });
    } finally {
        await session.endSession();
    }
}

// Supplies pending requests to the lender's frontend.
export async function getPendingExtensions(lenderId) {
    const reservations = await Reservation.find({
        lender: lenderId,
        status: 'active'
    })
        .select('_id borrower item endDate')
        .lean();

    if (reservations.length === 0) {
        return [];
    }

    const requests = await ExtensionRequest.find({
        reservation: {
            $in: reservations.map((reservation) => reservation._id)
        },
        status: 'requested'
    })
        .sort({ createdAt: -1 })
        .lean();

    const byId = new Map(
        reservations.map((reservation) => [
            reservation._id,
            reservation
        ])
    );

    return requests.map((request) => ({
        requestId: request._id,
        reservationId: request.reservation,
        originalEndDate: request.originalEndDate,
        requestedEndDate: request.requestedEndDate,
        status: request.status,
        borrower: byId.get(request.reservation)?.borrower,
        item: byId.get(request.reservation)?.item
    }));
}
