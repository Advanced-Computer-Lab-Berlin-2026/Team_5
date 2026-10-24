import { beforeEach, describe, expect, it, vi} from "vitest";
import request from "supertest";
import app from "../app.js";
import { Member } from "../models/Member.js";

// Create a Mock model for Member where this model has these 2 functions, findone and Create. (because i call them in my auth.js)
vi.mock('../models/Member.js', () => ({
    Member : {
        findOne: vi.fn(),
        create: vi.fn()
    }
}));

//Before each runs this lambda function before each test.
beforeEach( () => {
    // resets mocks after each test to empty mocks, good ethic to always clean up before/after tests.
    vi.resetAllMocks();
    
    // create the actual mock return values for the Model mock created above
    Member.findOne.mockResolvedValue(null);
    Member.create.mockResolvedValue({_id: 'member123'});
});

const validMember = {
    username: 'martin123',
    name: 'Martin',
    email: 'martin@example.com',
    password: 'secret123'
};

const invalidMembers= [{
    username: 'martin123',
    name: 'Martin',
    email: 'invalidEmail',
    password: 'secret123'
},
{
    username: 'martin123',
    name: 'Martin',
    email: 'martin@example.com',
    password: 'short'
}]

/**
 * describe is a logical grouping of multiple tests together defined by 'it'. each it is its own test where you create a request to our app with the target
 * endpoint and and body and the check whether the outcome, status, error, output, number of function calls are as expected
 */

describe('POST /api/auth/register', () => {
    it('Returns 201 for valid registration', async() => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(validMember);
        
        expect(response.status).toBe(201);
        expect(Member.create).toHaveBeenCalledOnce();

        const savedMember = Member.create.mock.calls[0][0];
        expect(savedMember.username).toBe(validMember.username);
        expect(savedMember.name).toBe(validMember.name);
        expect(savedMember.email).toBe(validMember.email);
        expect(savedMember.password).not.toBe(validMember.password); //hashed
    });

    it.each(invalidMembers)(
        'returns 400 for invalid input %#', 
        async (member) => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(member);

        expect(response.status).toBe(400);
        expect(Member.findOne).not.toHaveBeenCalled();
        expect(Member.create).not.toHaveBeenCalled();
    });

    it('returns 409 when a member already exists', async () => {
        Member.findOne.mockResolvedValue({ username: 'martin123' });

        const response = await request(app)
            .post('/api/auth/register')
            .send(validMember);

        expect(response.status).toBe(409);
        expect(Member.create).not.toHaveBeenCalled();
    });

    it('returns 409 for a duplicate-key error during saving', async () => {
        Member.create.mockRejectedValue({ code: 11000 });

        const response = await request(app)
            .post('/api/auth/register')
            .send(validMember);

        expect(response.status).toBe(409);
    });
});