import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotice, listNotices } from '../controllers/noticeController.js';
import { Notice } from '../models/Notice.js';

vi.mock('../models/Notice.js', () => ({
    Notice: {
        create: vi.fn(),
        find: vi.fn()
    }
}));

const response = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
});

describe('createNotice', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('requires a non-empty title and body', async () => {
        const res = response();

        await createNotice(
            { body: { title: '  ', body: '' }, user: { id: 'admin123' } },
            res,
            vi.fn()
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Notice title and body are required.'
        });
        expect(Notice.create).not.toHaveBeenCalled();
    });

    it('creates a notice using the authenticated admin', async () => {
        const notice = { _id: 'NTC-1', title: 'Update', body: 'Details', postedBy: 'admin123' };
        Notice.create.mockResolvedValue(notice);
        const res = response();

        await createNotice(
            {
                body: { title: '  Update ', body: ' Details ' },
                user: { id: 'admin123' }
            },
            res,
            vi.fn()
        );

        expect(Notice.create).toHaveBeenCalledWith({
            title: 'Update',
            body: 'Details',
            postedBy: 'admin123'
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ notice });
    });
});

describe('listNotices', () => {
    it('returns notices newest first', async () => {
        const notices = [{ _id: 'NTC-1' }];
        const sort = vi.fn().mockResolvedValue(notices);
        Notice.find.mockReturnValue({ sort });
        const res = response();

        await listNotices({}, res, vi.fn());

        expect(Notice.find).toHaveBeenCalledWith();
        expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ notices });
    });
});
