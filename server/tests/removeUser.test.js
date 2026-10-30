
import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { removeUser } from '../controllers/adminController.js';
import { User } from '../models/User.js';
import { Item } from '../models/Item.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { Waitlist } from '../models/Waitlist.js';
import { PasswordReset } from '../models/PasswordReset.js';

vi.mock('mongoose', () => ({
  default: {
    startSession: vi.fn()
  }
}));

vi.mock('../models/User.js', () => ({
  User: {
    findById: vi.fn(),
    findByIdAndDelete: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock('../models/Item.js', () => ({
  Item: {
    find: vi.fn(),
    deleteMany: vi.fn()
  }
}));

vi.mock('../models/RefreshSession.js', () => ({
  RefreshSession: {
    deleteMany: vi.fn()
  }
}));

vi.mock('../models/Waitlist.js', () => ({
  Waitlist: {
    deleteMany: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock('../models/PasswordReset.js', () => ({
  PasswordReset: {
    deleteMany: vi.fn()
  }
}));

const req = {
  params: { id: 'ahmed123' },
  user: { id: 'admin123' }
};

const res = {
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
  clearCookie: vi.fn()
};

const mockSession = {
  withTransaction: vi.fn(),
  endSession: vi.fn()
};

const mockItems = [
  { _id: 'ITM-123' },
  { _id: 'ITM-456' }
];

beforeEach(() => {
  vi.clearAllMocks();

  req.params.id = 'ahmed123';
  req.user.id = 'admin123';

  User.findById.mockResolvedValue({
    _id: 'ahmed123',
    role: 'member'
  });

  mongoose.startSession.mockResolvedValue(mockSession);

  mockSession.withTransaction.mockImplementation(
    async (callback) => await callback()
  );

  mockSession.endSession.mockResolvedValue();

  Item.find.mockResolvedValue(mockItems);

  User.updateMany.mockResolvedValue({ modifiedCount: 2 });

  Waitlist.deleteMany.mockResolvedValue({ deletedCount: 1 });
  Waitlist.updateMany.mockResolvedValue({ modifiedCount: 1 });

  PasswordReset.deleteMany.mockResolvedValue({ deletedCount: 1 });

  Item.deleteMany.mockResolvedValue({ deletedCount: 2 });
  RefreshSession.deleteMany.mockResolvedValue({ deletedCount: 1 });

  User.findByIdAndDelete.mockResolvedValue({
    _id: 'ahmed123'
  });
});

describe('removeUser', () => {

  it('should delete a user, their items and related records with status 200', async () => {
    await removeUser(req, res);

    expect(User.findById).toHaveBeenCalledWith('ahmed123');
    expect(mongoose.startSession).toHaveBeenCalled();
    expect(mockSession.withTransaction).toHaveBeenCalled();

    // Retrieve the user's items before deleting them
    expect(Item.find).toHaveBeenCalledWith(
      { owner: 'ahmed123' },
      '_id',
      { session: mockSession }
    );

    // Remove deleted items from other users' wishlists
    expect(User.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'ahmed123' } },
      {
        $pull: {
          wishlist: { $in: ['ITM-123', 'ITM-456'] }
        }
      },
      { session: mockSession }
    );

    // Remove waitlists associated with deleted items
    expect(Waitlist.deleteMany).toHaveBeenCalledWith(
      { item: { $in: ['ITM-123', 'ITM-456'] } },
      { session: mockSession }
    );

    // Remove deleted user from other waitlists
    expect(Waitlist.updateMany).toHaveBeenCalledWith(
      { usernames: 'ahmed123' },
      { $pull: { usernames: 'ahmed123' } },
      { session: mockSession }
    );

    // Remove password-reset records
    expect(PasswordReset.deleteMany).toHaveBeenCalledWith(
      { userId: 'ahmed123' },
      { session: mockSession }
    );

    // Delete actual listings
    expect(Item.deleteMany).toHaveBeenCalledWith(
      { owner: 'ahmed123' },
      { session: mockSession }
    );

    // Delete refresh sessions
    expect(RefreshSession.deleteMany).toHaveBeenCalledWith(
      { userId: 'ahmed123' },
      { session: mockSession }
    );

    // Delete user account
    expect(User.findByIdAndDelete).toHaveBeenCalledWith(
      'ahmed123',
      { session: mockSession }
    );

    expect(mockSession.endSession).toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'User deleted successfully.'
    });

    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('should preserve borrow lists when removing deleted items from wishlists', async () => {
    await removeUser(req, res);

    // Only wishlist is modified, not borrow_list
    expect(User.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'ahmed123' } },
      {
        $pull: {
          wishlist: { $in: ['ITM-123', 'ITM-456'] }
        }
      },
      { session: mockSession }
    );

    const update = User.updateMany.mock.calls[0][1];

    expect(update.$pull).not.toHaveProperty('borrow_list');

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should handle users who have no item listings', async () => {
    Item.find.mockResolvedValue([]);

    await removeUser(req, res);

    // No item references need cleaning
    expect(User.updateMany).not.toHaveBeenCalled();
    expect(Waitlist.deleteMany).not.toHaveBeenCalled();

    // Other cleanup still happens
    expect(Waitlist.updateMany).toHaveBeenCalledWith(
      { usernames: 'ahmed123' },
      { $pull: { usernames: 'ahmed123' } },
      { session: mockSession }
    );

    expect(PasswordReset.deleteMany).toHaveBeenCalledWith(
      { userId: 'ahmed123' },
      { session: mockSession }
    );

    expect(Item.deleteMany).toHaveBeenCalledWith(
      { owner: 'ahmed123' },
      { session: mockSession }
    );

    expect(RefreshSession.deleteMany).toHaveBeenCalled();
    expect(User.findByIdAndDelete).toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'User deleted successfully.'
    });
  });

  it('should return 404 if the user does not exist', async () => {
    User.findById.mockResolvedValue(null);

    await removeUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'User not found.'
    });

    expect(mongoose.startSession).not.toHaveBeenCalled();
    expect(Item.find).not.toHaveBeenCalled();
    expect(User.updateMany).not.toHaveBeenCalled();
    expect(Item.deleteMany).not.toHaveBeenCalled();
    expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    expect(User.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('should allow an admin to delete themselves and clear cookies', async () => {
    req.params.id = 'admin123';
    req.user.id = 'admin123';

    User.findById.mockResolvedValue({
      _id: 'admin123',
      role: 'admin'
    });

    Item.find.mockResolvedValue([]);

    await removeUser(req, res);

    expect(User.findByIdAndDelete).toHaveBeenCalledWith(
      'admin123',
      { session: mockSession }
    );

    expect(RefreshSession.deleteMany).toHaveBeenCalledWith(
      { userId: 'admin123' },
      { session: mockSession }
    );

    expect(res.clearCookie).toHaveBeenCalledWith(
      'accessToken',
      { path: '/' }
    );

    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      { path: '/api/auth' }
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'User deleted successfully.'
    });
  });

  it('should allow deleting another admin', async () => {
    req.params.id = 'otherAdmin';

    User.findById.mockResolvedValue({
      _id: 'otherAdmin',
      role: 'admin'
    });

    await removeUser(req, res);

    expect(Item.deleteMany).toHaveBeenCalledWith(
      { owner: 'otherAdmin' },
      { session: mockSession }
    );

    expect(User.findByIdAndDelete).toHaveBeenCalledWith(
      'otherAdmin',
      { session: mockSession }
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('should return 500 and end the session if wishlist cleanup fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    User.updateMany.mockRejectedValue(
      new Error('Wishlist cleanup failed')
    );

    try {
      await removeUser(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'An error occurred while removing the user.'
      });

      // Deletion must not continue after cleanup fails
      expect(Item.deleteMany).not.toHaveBeenCalled();
      expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
      expect(User.findByIdAndDelete).not.toHaveBeenCalled();

      expect(mockSession.endSession).toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('should return 500 and end the session if item deletion fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    Item.deleteMany.mockRejectedValue(
      new Error('Database error')
    );

    try {
      await removeUser(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'An error occurred while removing the user.'
      });

      expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
      expect(User.findByIdAndDelete).not.toHaveBeenCalled();

      expect(mockSession.endSession).toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

});
