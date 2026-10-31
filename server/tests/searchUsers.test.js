
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchUsers } from '../controllers/adminController.js';
import { User } from '../models/User.js';

vi.mock('../models/User.js', () => ({
  User: {
    aggregate: vi.fn()
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
      name: 'Ahmed Hassan',
      email: 'ahmed@example.com'
    },
    verification: { status: 'accepted' }
  },
  {
    _id: 'ahmed456',
    username: 'ahmed456',
    role: 'lender',
    profile: {
      name: 'Ahmed Ali',
      email: 'ahmedali@example.com'
    },
    verification: { status: 'pending' }
  }
];

beforeEach(() => {
  vi.clearAllMocks();

  req.query = { name: 'Ahmed' };
  User.aggregate.mockResolvedValue(mockUsers);
});

describe('searchUsers', () => {

  it('should return matching users with status 200', async () => {
    await searchUsers(req, res);

    expect(User.aggregate).toHaveBeenCalledWith([
      {
          $search: {
              index: 'user_name_search',
              autocomplete: {
                  query: 'Ahmed',
                  path: 'profile.name',
                  tokenOrder: 'sequential',
                  fuzzy: {
                      maxEdits: 1,
                      prefixLength: 0
                  }
              }
          }
      },
      {
          $match: {
              role: { $in: ['member', 'lender'] }
          }
      },
      {
          $project: {
              username: 1,
              role: 1,
              'profile.name': 1,
              'profile.email': 1,
              'profile.phone': 1,
              'verification.status': 1,
              suspended: 1,
              score: { $meta: 'searchScore' }
          }
      },
      {
          $sort: { score: -1 }
      }
  ]);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      users: mockUsers
    });
  });

  it('should pass a lowercase search term to Atlas Search', async () => {
    req.query = { name: 'ahmed' };

    await searchUsers(req, res);

    const pipeline = User.aggregate.mock.calls[0][0];

    expect(pipeline[0].$search.autocomplete.query).toBe('ahmed');
    expect(pipeline[0].$search.index).toBe('user_name_search');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      users: mockUsers
    });
  });

  it('should return an empty list if no users match', async () => {
    req.query = { name: 'Nonexistent' };
    User.aggregate.mockResolvedValue([]);

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      users: []
    });
  });

  it('should return 400 if the name is missing', async () => {
    req.query = {};

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Name must be a non-empty string.'
    });

    expect(User.aggregate).not.toHaveBeenCalled();
  });

  it('should return 400 if the name is empty or whitespace', async () => {
    req.query = { name: '   ' };

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Name must be a non-empty string.'
    });

    expect(User.aggregate).not.toHaveBeenCalled();
  });

  it('should return 400 if the name is not a string', async () => {
    req.query = { name: ['Ahmed', 'Ali'] };

    await searchUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Name must be a non-empty string.'
    });

    expect(User.aggregate).not.toHaveBeenCalled();
  });

  it('should pass special characters as text without regex escaping', async () => {
    req.query = { name: 'Ali.*' };
    User.aggregate.mockResolvedValue([]);

    await searchUsers(req, res);

    const pipeline = User.aggregate.mock.calls[0][0];

    expect(pipeline[0].$search.autocomplete.query).toBe('Ali.*');

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 if the database query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    User.aggregate.mockRejectedValue(
      new Error('Database error')
    );

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
