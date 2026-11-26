import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;

const reviewSchema = joi.object({
    rating: joi.number().integer().min(1).max(5).required(),
    review: joi.string().trim().min(1).max(500).required()
});

function formatReceivedReview(resDoc, targetUser) {
    if (resDoc.lender === targetUser && resDoc.reviews?.lenderRating !== undefined) {
        return {
            reservationId: resDoc._id,
            role: 'lender',
            reviewer: resDoc.borrower,
            rating: resDoc.reviews.lenderRating,
            review: resDoc.reviews.lenderReview,
            date: resDoc.updatedAt
        };
    }
    if (resDoc.borrower === targetUser && resDoc.reviews?.borrowerRating !== undefined) {
        return {
            reservationId: resDoc._id,
            role: 'borrower',
            reviewer: resDoc.lender,
            rating: resDoc.reviews.borrowerRating,
            review: resDoc.reviews.borrowerReview,
            date: resDoc.updatedAt
        };
    }
    return null;
}

function formatGivenReview(resDoc, authorUser) {
    if (resDoc.borrower === authorUser && resDoc.reviews?.lenderRating !== undefined) {
        return {
            reservationId: resDoc._id,
            targetUser: resDoc.lender,
            targetRole: 'lender',
            rating: resDoc.reviews.lenderRating,
            review: resDoc.reviews.lenderReview,
            date: resDoc.updatedAt
        };
    }
    if (resDoc.lender === authorUser && resDoc.reviews?.borrowerRating !== undefined) {
        return {
            reservationId: resDoc._id,
            targetUser: resDoc.borrower,
            targetRole: 'borrower',
            rating: resDoc.reviews.borrowerRating,
            review: resDoc.reviews.borrowerReview,
            date: resDoc.updatedAt
        };
    }
    return null;
}

// POST /api/reviews/reservations/:reservationId/lender  (Borrower reviews Lender - Req 89)
export async function reviewLender(req, res, next) {
    const { value, error } = reviewSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const reservation = await Reservation.findById(reservationId);
        if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
        if (reservation.borrower !== req.user.id) {
            return res.status(403).json({ message: 'Only the borrower can review the lender for this reservation' });
        }
        if (reservation.status !== 'completed') {
            return res.status(409).json({ message: 'Reviews can only be left for completed reservations' });
        }
        if (reservation.reviews?.lenderRating !== undefined) {
            return res.status(409).json({ message: 'You have already reviewed the lender for this reservation' });
        }

        reservation.reviews = {
            ...reservation.reviews?.toObject?.() ?? reservation.reviews,
            lenderRating: value.rating,
            lenderReview: value.review
        };
        await reservation.save();

        return res.status(201).json({
            message: 'Review for lender submitted successfully',
            reviews: reservation.reviews
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/reviews/reservations/:reservationId/borrower  (Lender reviews Borrower - Req 90)
export async function reviewBorrower(req, res, next) {
    const { value, error } = reviewSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const reservation = await Reservation.findById(reservationId);
        if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
        if (reservation.lender !== req.user.id) {
            return res.status(403).json({ message: 'Only the lender can review the borrower for this reservation' });
        }
        if (reservation.status !== 'completed') {
            return res.status(409).json({ message: 'Reviews can only be left for completed reservations' });
        }
        if (reservation.reviews?.borrowerRating !== undefined) {
            return res.status(409).json({ message: 'You have already reviewed the borrower for this reservation' });
        }

        reservation.reviews = {
            ...reservation.reviews?.toObject?.() ?? reservation.reviews,
            borrowerRating: value.rating,
            borrowerReview: value.review
        };
        await reservation.save();

        return res.status(201).json({
            message: 'Review for borrower submitted successfully',
            reviews: reservation.reviews
        });
    } catch (error) {
        next(error);
    }
}

// GET /api/reviews/users/:username  (View a user's trust score and past reviews - Req 91)
export async function getUserTrustAndReviews(req, res, next) {
    try {
        const { username } = req.params;
        const user = await User.findById(username)
            .select('username role profile.name trustScore suspended')
            .lean();

        if (!user || user.suspended) {
            return res.status(404).json({ message: 'User not found' });
        }

        const reservations = await Reservation.find({
            status: 'completed',
            $or: [
                { lender: username, 'reviews.lenderRating': { $exists: true } },
                { borrower: username, 'reviews.borrowerRating': { $exists: true } }
            ]
        })
            .sort({ updatedAt: -1 })
            .lean();

        const reviews = reservations
            .map((r) => formatReceivedReview(r, username))
            .filter(Boolean);

        return res.status(200).json({
            user: {
                username: user.username,
                name: user.profile?.name,
                role: user.role,
                trustScore: user.trustScore
            },
            reviews
        });
    } catch (error) {
        next(error);
    }
}

// GET /api/reviews/me  (View all reviews I have given and received - Req 98)
export async function getMyReviews(req, res, next) {
    try {
        const userId = req.user.id;
        const reservations = await Reservation.find({
            status: 'completed',
            $or: [{ borrower: userId }, { lender: userId }]
        })
            .sort({ updatedAt: -1 })
            .lean();

        const given = reservations.map((r) => formatGivenReview(r, userId)).filter(Boolean);
        const received = reservations.map((r) => formatReceivedReview(r, userId)).filter(Boolean);

        return res.status(200).json({ given, received });
    } catch (error) {
        next(error);
    }
}