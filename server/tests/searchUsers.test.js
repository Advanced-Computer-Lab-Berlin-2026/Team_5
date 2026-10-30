
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchUsers } from '../controllers/adminController.js';
import { User } from '../models/User.js';

vi.mock('../models/User.js', () => ({
  User: {
    find: vi.fn()
  }
}));

const req = {
  query: { name: 'Ahmed' }
};

const res = {
  status: vi.fn().mockReturnThis(),
  json: vi.fn()
};

const mockUsers = [
  {
    _id: 'ahmed123',
    username: 'ahmed123',
    role: 'member',
    profile: {
      name: 'Ahmed Hazem',
      email: 'ahmed@example.com'
    },
    verification: { status: 'accepted' }
  },
  {
    _id: 'ahmed456',
    username: 'ahmed456',
    role: 'lender',
    profile: {
      name: 'Ahmed Hassan',
      email: 'ahmed456@example.com'
    },
    verification: { status: 'pending' }
  }
];

const selectedFields =
  'username role profile.name profile.email profile.phone verification.status suspended';

function mockUserQuery(users) {
  const mockSort = vi.fn().mockResolvedValue(users);
  const mockSelect = vi.fn().mockReturnValue({
    sort: mockSort
  });

  User.find.mockReturnValue({
    select: mockSelect
  });

  return { mockSelect, mockSort };
}

beforeEach(() => {
  vi.clearAllMocks();
  req.query = { name: 'Ahmed' };
});

describe('searchUsers', () => {

  it('should return matching users with status 200', async () => {
    const { mockSelect, mockSort } = mockUserQuery(mockUsers);

    await searchUsers(req, res);

    expect(User.find).toHaveBeenCalledWith({
      role: { $in: ['member', 'lender'] },
      'profile.name': { $regex: 'Ahmed', $options: 'i' }
    });

    expect(mockSelect).toHaveBeenCalledWith(selectedFields);
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ users: mockUsers });
  });

  it('should perform a case-insensitive search', async () => {
    req.query = { name: 'ahmed' };

    mockUserQuery(mockUsers);

    await searchUsers(req, res);

    expect(User.find).toHaveBeenCalledWith({
      role: { $in: ['member', 'lender'] },
      'profile.name': { $regex: 'ahmed', $options: 'i' }
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ users: mockUsers });
  });

  it('should return an empty list if no users match', async () => {
    req.query = { name: 'Nonexistent' };

    mockUserQuery([]);

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ users: [] });
  });

  it('should return 400 if the name is missing', async () => {
    req.query = {};

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Name must be a non-empty string.'
    });

    expect(User.find).not.toHaveBeenCalled();
  });

  it('should return 400 if the name is empty or whitespace', async () => {
    req.query = { name: '   ' };

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Name must be a non-empty string.'
    });

    expect(User.find).not.toHaveBeenCalled();
  });

  it('should return 400 if the name is not a string', async () => {
    req.query = { name: ['Ahmed', 'Ali'] };

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Name must be a non-empty string.'
    });

    expect(User.find).not.toHaveBeenCalled();
  });

  it('should escape special regex characters', async () => {
    req.query = { name: 'Ali.*' };

    mockUserQuery([]);

    await searchUsers(req, res);

    expect(User.find).toHaveBeenCalledWith({
      role: { $in: ['member', 'lender'] },
      'profile.name': { $regex: 'Ali\\.\\*', $options: 'i' }
    });

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 if the database query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    const mockSort = vi.fn().mockRejectedValue(
      new Error('Database error')
    );

    const mockSelect = vi.fn().mockReturnValue({
      sort: mockSort
    });

    User.find.mockReturnValue({
      select: mockSelect
    });

    try {
      await searchUsers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'An error occurred while searching users.'
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

});
