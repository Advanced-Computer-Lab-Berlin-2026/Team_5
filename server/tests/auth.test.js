import { beforeEach, describe, expect, it, vi} from "vitest";
import request from "supertest";
import app from "../app.js";
import { Member } from "../models/Member.js";
import bcrypt from "bcrypt";
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

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

const invalidMembers= [
    { ...validMember, email: 'invalidEmail'},
    {...validMember, password: 'short'},
    {}, // Missing required fields
    { ...validMember, username: 'short' },
    { ...validMember, name: '' },
    { ...validMember, password: 'x'.repeat(41) },
    { ...validMember, phoneNumber: 'invalid' }
]

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
        expect(
            await bcrypt.compare(validMember.password, savedMember.password)
        ).toBe(true);
    });

    it.each(['findOne', 'create'])(
    'returns 500 when registration %s fails',
    async (operation) => {
        Member[operation].mockRejectedValue(
            new Error('Database unavailable')
        );

        const response = await request(app)
            .post('/api/auth/register')
            .send(validMember);

        expect(response.status).toBe(500);

        if (operation === 'findOne') {
            expect(Member.create).not.toHaveBeenCalled();
        }
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

const invalidLogin = [
    null,
    {
        _id: 123,
        username: 'martythebest',
        name: 'Martin',
        email: 'martin@example.com',
        password: await bcrypt.hash("mesh_malakshDa3wa?", 10)  
    }
]

const incompleteLogin = [
    {},
    {username: "nonofurbeez"},
    {password: "mesh2elakda3wa"},
    { username: '', password: 'secret123' },
    { username: 'martin123', password: '' },
    { username: 123, password: 'secret123' },
    { username: 'martin123', password: 123 }
]

describe('POST api/auth/login', () => {
    it('Returns 200 for successful login', async () =>{
        Member.findOne.mockResolvedValue({
                _id: 123,
                username: 'martythebest',
                name: 'Martin',
                email: 'martin@example.com',
                password: await bcrypt.hash("malakshDa3wa?", 10)
        });

        const response = await request(app)
            .post('/api/auth/login')
            .send({
                username: "martythebest",
                password: "malakshDa3wa?"
            });
        
        expect(Member.findOne).toHaveBeenCalledWith({
                username: 'martythebest'
        });

        expect(response.status).toBe(200);
        expect(response.body.token).toEqual(expect.any(String));
        
        const payload = jwt.verify(response.body.token, env.jwtSecret);

        expect(response.body.user).toEqual({
            id: '123',
            username: 'martythebest',
            name: 'Martin',
            email: 'martin@example.com'
        });
        expect(payload.id).toBe('123');
        expect(payload.username).toBe('martythebest');
        expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
    });

    it.each(invalidLogin)(
        'Returns 401 for unsuccessful login (username/password mismatch)',
        async (invalidLogin) =>{
        Member.findOne.mockResolvedValue(invalidLogin);

        const response = await request(app)
            .post('/api/auth/login')
            .send({
                username: "martythebest",
                password: "malakshDa3wa?"
            });
        
        expect(response.status).toBe(401);
        expect(response.body).not.toHaveProperty('token');
        expect(response.body).not.toHaveProperty('user');
    });

    it.each(incompleteLogin)('Returns 400 for incomplete login data',
        async (incompleteLogin) =>{
        const response = await request(app)
            .post('/api/auth/login')
            .send(incompleteLogin);
        
        expect(Member.findOne).not.toHaveBeenCalled();
        expect(response.status).toBe(400);
        expect(response.body).not.toHaveProperty('token');
        expect(response.body).not.toHaveProperty('user');
    });

    it('returns 500 when the login lookup fails', async () => {
    Member.findOne.mockRejectedValue(new Error('Database unavailable'));

    const response = await request(app)
        .post('/api/auth/login')
        .send({
            username: 'martythebest',
            password: 'secret123'
        });

    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('token');
    });
});