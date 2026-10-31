import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listItems } from '../controllers/adminController.js';
import { Item } from '../models/Item.js';

vi.mock('../models/Item.js', () => ({
  Item: {
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

const mockItems = [
  {
    _id: 'ITM-a3f18c29',
    name: 'Canon Camera',
    category: 'Electronics',
    owner: 'ahmed123',
    depositAmount: 500,
    archived: false,
    flagged: false
  },
  {
    _id: 'ITM-b42d9031',
    name: 'Bicycle',
    category: 'Sports',
    owner: 'mohamed456',
    depositAmount: 200,
    archived: true,
    flagged: true
  }
];

describe('listItems', () => {

  it('should return a list of items with status 200', async () => {
    const mockSort = vi.fn().mockResolvedValue(mockItems);

    Item.find.mockReturnValue({
      sort: mockSort
    });

    await listItems(req, res);

    expect(Item.find).toHaveBeenCalledWith({});
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: mockItems });
  });

  it('should return an empty list if no items are found', async () => {
    const mockSort = vi.fn().mockResolvedValue([]);

    Item.find.mockReturnValue({
      sort: mockSort
    });

    await listItems(req, res);

    expect(Item.find).toHaveBeenCalledWith({});
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [] });
  });

  it('should handle errors and return status 500', async () => {
    const mockSort = vi.fn().mockRejectedValue(new Error('Database error'));

    Item.find.mockReturnValue({
      sort: mockSort
    });

    await listItems(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'An error occurred while listing items.'
    });
  });

});