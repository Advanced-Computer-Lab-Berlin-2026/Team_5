import joi from 'joi';
import { Notification } from '../models/index.js';

const listNotificationsSchema = joi.object({
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(50).default(10)
});

// GET /api/notifications
export async function listNotifications(req, res, next) {
    try {
        const { value, error } = listNotificationsSchema.validate(req.query);
        if (error) return res.status(400).json({ message: error.message });

        // no unread filter yet, joi rejects unknown params so ?unread= is a 400
        // the username + read index can't do this sort, add { username: 1, createdAt: -1, _id: 1 } if it gets slow
        const filter = { username: req.user.id };
        const [notifications, total] = await Promise.all([
            Notification.find(filter, { __v: 0 }, {
                // _id breaks ties so paging stays stable when two land in the same millisecond
                sort: { createdAt: -1, _id: 1 },
                skip: (value.page - 1) * value.limit,
                limit: value.limit,
                lean: true
            }),
            Notification.countDocuments(filter)
        ]);

        res.status(200).json({
            notifications,
            pagination: {
                total,
                page: value.page,
                totalPages: Math.ceil(total / value.limit),
                limit: value.limit
            }
        });
    } catch (error) {
        next(error);
    }
}

// PATCH /api/notifications/:id/read
export async function markNotificationRead(req, res, next) {
    try {
        // username in the filter so someone else's id is a 404 (403 would confirm it exists)
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, username: req.user.id },
            { $set: { read: true } },
            { returnDocument: 'after', lean: true, projection: { __v: 0 } }
        );
        if (!notification) return res.status(404).json({ message: 'Notification not found' });

        res.status(200).json({ notification });
    } catch (error) {
        next(error);
    }
}
