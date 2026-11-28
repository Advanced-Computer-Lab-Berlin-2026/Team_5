import { Notice } from '../models/Notice.js';
import { notifyCommunity } from '../services/notificationService.js';

export async function createNotice(req, res, next) {
    try {
        const { title, body } = req.body ?? {};
        if (
            typeof title !== 'string' ||
            !title.trim() ||
            typeof body !== 'string' ||
            !body.trim()
        ) {
            return res.status(400).json({
                error: 'Notice title and body are required.'
            });
        }

        const notice = await Notice.create({
            title: title.trim(),
            body: body.trim(),
            postedBy: req.user.id
        });

        notifyCommunity({ type: 'community-notice', subject: notice.title, message: notice.body })
            .catch(error => console.error('Community notice notifications failed', error));
        return res.status(201).json({ notice });
    } catch (error) {
        return next(error);
    }
}

export async function listNotices(req, res, next) {
    try {
        const notices = await Notice.find().sort({ createdAt: -1 });
        return res.status(200).json({ notices });
    } catch (error) {
        return next(error);
    }
}
