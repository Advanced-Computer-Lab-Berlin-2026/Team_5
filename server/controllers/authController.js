import jwt from 'jsonwebtoken';
import joi from 'joi';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { env } from '../config/env.js'
import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';

const PHONE_NUMBER_REGEX_PATTERN = /^\+[1-9]\d{1,14}$/;

const userSchema = joi.object(
    {
        username: joi.string().min(6).max(20).required(),
        name: joi.string().trim().min(2).max(20).required(),
        email: joi.string().trim().email().required(),
        password: joi.string().min(6).max(40).required(),
        phoneNumber: joi.string().pattern(PHONE_NUMBER_REGEX_PATTERN).allow(''),
        homeAddress: joi.string().allow('')
    }
);

const loginSchema = joi.object(
    {
        username: joi.string().required(),
        password: joi.string().required()
    }
);

// POST /api/auth/register
export async function registerUser(req, res, next){
    try{
        const { value, error } = userSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.message });

        const existing = await User.findOne({ $or: [{username:value.username}, {email:value.email}] });
        if (existing) return res.status(409).json({ message: "Username or Email already exists"});

        const password = await bcrypt.hash(value.password, 10); 
        await User.create({ username: value.username, name: value.name, email: value.email, password: password, phoneNumber: value.phoneNumber || "", homeAddress: value.homeAddress || "" }); 
        
        res.status(201).json({message: "Registration Successful! Please log in."});
    } catch (error){
        if (error.code === 11000) { return res.status(409).json({ message: "Username or Email already exists" }); }
        next(error);
    }
}

//POST /api/auth/login
export async function login(req, res, next) {
    try{
        const { value, error } = loginSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.message });

        const user = await User.findOne({ username: value.username })
        if (!user) return res.status(401).json({ message: "Username or Password is incorrect!"});
        
        const passwordMatches = await bcrypt.compare(value.password, user.password);
        if (!passwordMatches) return res.status(401).json({ message: "Username or Password is incorrect!"});
        
        const accessToken = signToken(user);
        const refreshToken = await createRefreshToken(user);

        setRefreshCookie(res, refreshToken);

        res.status(200).json({ accessToken, user: publishUser(user)});
    } catch(error){
        next(error);
    }
}

function signToken(user){
    const payload = {id: user._id.toString(), username:user.username};
    return jwt.sign(payload, env.jwtSecret, { expiresIn: '15m'} );
}

function setRefreshCookie(res, refreshToken) {
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

async function createRefreshToken(user){
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await RefreshSession.create({
        userId: user._id,
        tokenHash,
        expiresAt
    });

    return refreshToken
}

function publishUser(user){
    return {
        id: user._id.toString(),
        username: user.username,
        name: user.name,
        email: user.email
    };
}

// POST '/api/auth/logout'
export async function logout(req, res, next) {
    try {
        const refreshToken = req.cookies?.refreshToken;

        if (refreshToken) {
            const tokenHash = crypto
                .createHash('sha256')
                .update(refreshToken)
                .digest('hex');

            await RefreshSession.deleteOne({ tokenHash });
        }

        res.clearCookie('refreshToken', { path: '/api/auth' });

        return res.status(200).json({
            message: 'Logged out successfully'
        });
    } catch (error) {
        next(error);
    }
}

//POST '/api/auth/refresh'
export async function refresh(req, res, next) {
    try{
        const refreshToken = req.cookies?.refreshToken;
        if (typeof refreshToken !== 'string' || !refreshToken) {
            res.clearCookie('refreshToken', { path: '/api/auth' });
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }

        const tokenHash = crypto
                .createHash('sha256')
                .update(refreshToken)
                .digest('hex');
        
        const session = await RefreshSession.findOneAndDelete({
            tokenHash,
            expiresAt: { $gt: new Date() }
        });
        if (!session) {
            res.clearCookie('refreshToken', { path: '/api/auth' });
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }

        const user = await User.findById(session.userId);
        if (!user) {
            res.clearCookie('refreshToken', { path: '/api/auth' });
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }

        const accessToken = signToken(user);
        const newRefreshToken = await createRefreshToken(user);
        setRefreshCookie(res, newRefreshToken);
        return res.status(200).json({ accessToken });
    } catch(error) {
        next(error);
    }
}
