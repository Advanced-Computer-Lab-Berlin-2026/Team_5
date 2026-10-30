import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { removeUser } from '../controllers/adminController.js';
import { User } from '../models/User.js';
import { Item } from '../models/Item.js';
import { RefreshSession } from '../models/RefreshSession.js';

vi.mock('mongoose', () => ({
  default: {
    startSession: vi.fn()
  }
}));

vi.mock('../models/User.js', () => ({
  User: {
    findById: vi.fn(),
    findByIdAndDelete: vi.fn()
  }
}));

vi.mock('../models/Item.js', () => ({
  Item: {
    deleteMany: vi.fn()
  }
}));

vi.mock('../models/RefreshSession.js', () => ({
  RefreshSession: {
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

beforeEach(() => {
  vi.clearAllMocks();

  User.findById.mockResolvedValue({
    _id: 'ahmed123',
    role: 'member'
  });

  mongoose.startSession.mockResolvedValue(mockSession);

  mockSession.withTransaction.mockImplementation(
    async (callback) => await callback()
  );

  mockSession.endSession.mockResolvedValue();

  Item.deleteMany.mockResolvedValue({ deletedCount: 2 });
  RefreshSession.deleteMany.mockResolvedValue({ deletedCount: 1 });
  User.findByIdAndDelete.mockResolvedValue({ _id: 'ahmed123' });

  req.params.id = 'ahmed123';
  req.user.id = 'admin123';
});

describe('removeUser', () => {

  it('should delete a user, their items and sessions with status 200', async () => {
    await removeUser(req, res);

    expect(User.findById).toHaveBeenCalledWith('ahmed123');

    expect(mongoose.startSession).toHaveBeenCalled();
    expect(mockSession.withTransaction).toHaveBeenCalled();

    expect(Item.deleteMany).toHaveBeenCalledWith(
      { owner: 'ahmed123' },
      { session: mockSession }
    );

    expect(RefreshSession.deleteMany).toHaveBeenCalledWith(
      { userId: 'ahmed123' },
      { session: mockSession }
    );

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

  it('should return 404 if the user does not exist', async () => {
    User.findById.mockResolvedValue(null);

    await removeUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'User not found.'
    });

    expect(mongoose.startSession).not.toHaveBeenCalled();
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

    await removeUser(req, res);

    expect(User.findByIdAndDelete).toHaveBeenCalledWith(
      'admin123',
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

  it('should return 500 and end the session if deletion fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    Item.deleteMany.mockRejectedValue(new Error('Database error'));

    try {
      await removeUser(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'An error occurred while removing the user.'
      });

      expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
      expect(User.findByIdAndDelete).not.toHaveBeenCalled();

      expect(mockSession.endSession).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

});