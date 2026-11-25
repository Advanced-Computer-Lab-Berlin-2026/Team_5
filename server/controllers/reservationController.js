import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { notifyDeliveryStatus } from '../services/notificationService.js';
import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import mongoose from 'mongoose';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;
const DELIVERY_STATUSES = ['preparing', 'out-for-delivery', 'delivered'];
const updateDeliverySchema = joi.object({
    status: joi.string().valid(...DELIVERY_STATUSES).required()
});

function canViewDelivery(user, reservation) {
    if (user.role === 'admin') return true;
    else return reservation.borrower === user.id;

}

export async function getDeliveryStatus(req, res, next) {
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const reservation = await Reservation.findById(reservationId).lean();
        if (!reservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        if (!canViewDelivery(req.user, reservation)) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (!reservation.delivery || Object.keys(reservation.delivery).length === 0) {
            return res.status(404).json({ message: 'No delivery data' });
        }

        return res.status(200).json(reservation.delivery);
    } catch (error) {
        next(error);
    }
}

function canUpdateDelivery(user, reservation) {
    return user.role === 'admin' || reservation.lender === user.id;
}

export async function updateDeliveryStatus(req, res, next) {
    try {
        const { reservationId } = req.params;

        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const { value, error } = updateDeliverySchema.validate(req.body ?? {}, {
            stripUnknown: true
        });
        if (error) {
            return res.status(400).json({ message: error.message });
        }

        const reservation = await Reservation.findById(reservationId).lean();
        if (!reservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        if (!canUpdateDelivery(req.user, reservation)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const updatedReservation = await Reservation.findByIdAndUpdate(
            reservationId,
            { $set: { 'delivery.status': value.status } },
            { new: true, runValidators: true }
        ).lean();

        if (!updatedReservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (
            reservation.delivery?.status !== value.status &&
            ['out-for-delivery', 'delivered'].includes(value.status)
        ) {
            await notifyDeliveryStatus(reservation, value.status);
        }

        return res.status(200).json({
            message: `Updated status to ${value.status}`
        });
    } catch (error) {
        next(error);
    }
}

function parseReservationInput({ itemId, startDate, endDate, deliveryFlag, deliveryAddress }) {
    if (!itemId || !startDate || !endDate || (deliveryFlag && !deliveryAddress)) {
        return { error: 'Missing required fields' };
    }

    if (!/^ITM-[0-9a-f]{8}$/.test(itemId)) {
        return { error: 'Invalid item id format' };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { error: 'Invalid date format' };
    }

    if (start >= end) {
        return { error: 'Start date must be before end date' };
    }

    return { start, end };
}

function validateReservationItem(item, borrowerId, deliveryFlag, requestedDuration) {
    if (item.owner.toString() === borrowerId) {
        return 'Cannot reserve your own item';
    }

    if (deliveryFlag && !item.delivery.offered) {
        return 'Item does not allow delivery';
    }

    const maxReservationDuration = item.borrowingRules.maxDurationDays || 30; // default to 30 days if not set

    if (requestedDuration > maxReservationDuration) {
        return `Reservation duration exceeds maximum allowed of ${maxReservationDuration} days`;
    }
}

export async function createReservation(req, res, next) {
    try {
        const { itemId, deliveryFlag, deliveryAddress } = req.body;

        const { start, end, error } = parseReservationInput(req.body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        //load item and check if it exists and is not archived or flagged
        const item = await Item.findOne({ _id: itemId, archived: false, flagged: { $ne: true } });
        if (!item) {
            return res.status(404).json({ message: 'Item not found or unavailable' });
        }

        const durationDays = (end - start) / (1000 * 60 * 60 * 24);
        const itemError = validateReservationItem(item, req.user.id, deliveryFlag, durationDays);
        if (itemError) {
            return res.status(400).json({ message: itemError });
        }

        const borrower = await User.findById(req.user.id);
        if (!borrower) {
            return res.status(404).json({ message: 'Borrower not found' });
        }   
        
        const borrowerTrustScore = borrower.trustScore || 0;
        const requiredTrustScore = item.borrowingRules.minTrustScore || 0;


        if (borrowerTrustScore < requiredTrustScore) {
            return res.status(403).json({ message: 'Borrower does not meet the minimum trust score requirement for this item' });
        }

        // item owner is the lender, check if they are suspended
        const lender = await User.findById(item.owner);
        if (!lender) {
            return res.status(404).json({ message: 'Lender not found' });
        }

        if (lender.suspended) {
            return res.status(403).json({ message: 'Lender is suspended, cannot create reservation' });
        }

        // check if item startdate is in the past
        const now = new Date();
        if (start < now) {
            return res.status(400).json({ message: 'Start date cannot be in the past' });
        }


        let conflict = false;
        let reservation;
        
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                conflict = false;

                // write to item and reservation in a transaction to ensure consistency
                await Item.updateOne({ _id: itemId }, { $set: { updatedAt: new Date() } }, { session });
    


                // Check for overlapping reservations
                const overlappingReservation = await Reservation.findOverlap(itemId, start, end, session);
                if (overlappingReservation) {
                    conflict = true; 
                    return;
                }

                // Create the reservation
                reservation = new Reservation({
                    item: itemId,
                    borrower: req.user.id,
                    lender: item.owner,
                    payment: {
                        depositAmount: item.depositAmount || 0,
                        method: 'wallet', // default to wallet, can be changed later
                    },
                    startDate: start,
                    endDate: end,
                    delivery: deliveryFlag ? { address: deliveryAddress, fee: item.delivery.fee || 0 } : undefined,
                });

                await reservation.save({ session });
            });
            
        } finally { await session.endSession(); }




        if (conflict) {
            return res.status(409).json({ message: 'Item is already reserved for the selected dates' });
        }

        return res.status(201).json({ message: 'Reservation created successfully', reservationId: reservation._id});

    } catch (error) {
        next(error);
    }       
}
