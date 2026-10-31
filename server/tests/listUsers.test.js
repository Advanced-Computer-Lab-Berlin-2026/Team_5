import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listUsers } from '../controllers/adminController.js';
import { User } from '../models/User.js';

vi.mock('../models/User.js', () => ({
  User: {
    find: vi.fn()
  }
}));

const req = {};

const res = {
  status: vi.fn().mockReturnThis(),
  json: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
});

const mockUsers = [
  {
    _id: 'ahmed123',
    username: 'ahmed123',
    role: 'member',
    verification: { status: 'none' }
  },
  {
    _id: 'mohamed456',
    username: 'mohamed456',
    role: 'lender',
    verification: { status: 'accepted' }
  }
];

describe('listUsers', () => {
  it('should return a list of users with status 200', async () => {
    const mockSort = vi.fn().mockResolvedValue(mockUsers);
    const mockSelect = vi.fn().mockReturnValue({
        sort: mockSort
    });

    User.find.mockReturnValue({
    select: mockSelect
    });

    await listUsers(req, res);

    expect(User.find).toHaveBeenCalledWith({ role: { $in: ['member', 'lender'] } });
    expect(mockSelect).toHaveBeenCalledWith('username role profile.name profile.email profile.phone verification.status suspended');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ users: mockUsers });
  });

  it('should return an empty list if no users are found', async () => {
    const mockSort = vi.fn().mockResolvedValue([]);
    const mockSelect = vi.fn().mockReturnValue({
        sort: mockSort
    });

    User.find.mockReturnValue({
      select: mockSelect
    });

    await listUsers(req, res);

    expect(User.find).toHaveBeenCalledWith({ role: { $in: ['member', 'lender'] } });
    expect(mockSelect).toHaveBeenCalledWith('username role profile.name profile.email profile.phone verification.status suspended');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ users: [] });
  });

  it('should handle errors and return status 500', async () => {
    const mockSelect = vi.fn().mockRejectedValue(new Error('Database error'));

    User.find.mockReturnValue({
        select: mockSelect
    });

    await listUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'An error occurred while listing users.' });
  });
});