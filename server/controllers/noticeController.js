import { Notice } from '../models/Notice.js';

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
