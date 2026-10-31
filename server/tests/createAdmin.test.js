
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdmin } from '../controllers/adminController.js';
import { User } from '../models/User.js';
import bcrypt from 'bcrypt';

vi.mock('../models/User.js', () => ({
  User: {
    findOne: vi.fn(),
    create: vi.fn()
  }
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn()
  }
}));

const validBody = {
  username: 'newadmin',
  email: 'newadmin@example.com',
  password: 'SecurePassword123'
};

const req = {
  body: { ...validBody }
};

const res = {
  status: vi.fn().mockReturnThis(),
  json: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();

  req.body = { ...validBody };

  User.findOne.mockResolvedValue(null);
  User.create.mockResolvedValue({ _id: 'newadmin' });
  bcrypt.hash.mockResolvedValue('hashed-password');
});

describe('createAdmin', () => {

  it('should create an admin successfully with status 201', async () => {
    await createAdmin(req, res);

    expect(User.findOne).toHaveBeenCalledWith({
      $or: [
        { username: 'newadmin' },
        { 'profile.email': 'newadmin@example.com' }
      ]
    });

    expect(bcrypt.hash).toHaveBeenCalledWith(
      'SecurePassword123',
      10
    );

    expect(User.create).toHaveBeenCalledWith({
      username: 'newadmin',
      password: 'hashed-password',
      role: 'admin',
      profile: {
        name: 'newadmin',
        email: 'newadmin@example.com'
      }
    });

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Admin created successfully.'
    });
  });

  it('should trim username and email before creating admin', async () => {
    req.body = {
      username: '  newadmin  ',
      email: '  newadmin@example.com  ',
      password: 'SecurePassword123'
    };

    await createAdmin(req, res);

    expect(User.findOne).toHaveBeenCalledWith({
      $or: [
        { username: 'newadmin' },
        { 'profile.email': 'newadmin@example.com' }
      ]
    });

    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'newadmin',
        profile: {
          name: 'newadmin',
          email: 'newadmin@example.com'
        }
      })
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it.each([
    ['missing body', undefined],
    ['missing username', {
      email: 'newadmin@example.com',
      password: 'SecurePassword123'
    }],
    ['short username', {
      username: 'abc',
      email: 'newadmin@example.com',
      password: 'SecurePassword123'
    }],
    ['invalid email', {
      username: 'newadmin',
      email: 'invalid-email',
      password: 'SecurePassword123'
    }],
    ['short password', {
      username: 'newadmin',
      email: 'newadmin@example.com',
      password: '123'
    }],
    ['extra role field', {
      ...validBody,
      role: 'member'
    }]
  ])('should return 400 for %s', async (_scenario, body) => {
    req.body = body;

    await createAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.any(String)
    });

    expect(User.findOne).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  it('should return 409 if username or email already exists', async () => {
    User.findOne.mockResolvedValue({
      username: 'newadmin'
    });

    await createAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Username or email already exists.'
    });

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  it('should return 409 for MongoDB duplicate key error', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    User.create.mockRejectedValue(
      Object.assign(new Error('Duplicate key'), {
        code: 11000
      })
    );

    try {
      await createAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Username or email already exists.'
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('should return 500 if password hashing fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    bcrypt.hash.mockRejectedValue(
      new Error('Hashing failed')
    );

    try {
      await createAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'An error occurred while creating admin.'
      });

      expect(User.create).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('should return 500 if database creation fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});

    User.create.mockRejectedValue(
      new Error('Database error')
    );

    try {
      await createAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'An error occurred while creating admin.'
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('should never store or return the plain-text password', async () => {
    await createAdmin(req, res);

    const createdUser = User.create.mock.calls[0][0];
    const responseBody = res.json.mock.calls[0][0];

    expect(createdUser.password).toBe('hashed-password');
    expect(createdUser.password).not.toBe(validBody.password);

    expect(responseBody).not.toHaveProperty('password');
    expect(responseBody).not.toHaveProperty('user');
  });

});
