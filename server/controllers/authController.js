import jwt from 'jsonwebtoken';
import joi from 'joi';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { env } from '../config/env.js'
import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { sendResetEmail } from '../services/emailService.js';

const PHONE_NUMBER_REGEX_PATTERN = /^\+[1-9]\d{1,14}$/;

const forgotPasswordSchema = joi.object({
    email: joi.string().trim().email().required()
});

const resetPasswordSchema = joi.object({
    resetToken: joi.string().pattern(/^[a-f0-9]{64}$/).required(),
    newPassword: joi.string().min(6).max(40).required()
});

const verifyResetOtpSchema = joi.object({
    email: joi.string().trim().email().required(),
    otp: joi.string().pattern(/^\d{6}$/).required()
});

const userSchema = joi.object(
    {
        username: joi.string().min(4).max(20).required(),
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
        // dummy changed from '/api/auth' to '/api' will be reverted back
        path: '/api',
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

// POST /api/auth/forgot-password
export async function forgetPassword(req, res, next) {
    
    try {
        const { value, error } = forgotPasswordSchema.validate(req.body ?? {});
        if (error) return res.status(400).json({ message: error.message });
       
        const user = await User.findOne({ email: value.email });
        const message = 'If an account exists, a reset code has been sent.';
        if (!user) return res.status(200).json({ message });
        
        const otp = crypto
            .randomInt(0, 1_000_000)
            .toString()
            .padStart(6, '0');

        const codeHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await PasswordReset.findOneAndUpdate(
            { userId: user._id },
            { $set: { codeHash, expiresAt, attempts: 0 }, $unset: { resetTokenHash: 1 } },
            { upsert: true, runValidators: true }
        );

        await sendResetEmail(user.email, otp);

        return res.status(200).json({ message });
    } catch (error) {
        next(error);
    }
}

// POST /api/auth/verify-reset-otp
export async function verifyResetOtp(req, res, next) {
    const { value, error } = verifyResetOtpSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    const invalid = () => res.status(401).json({ message: 'Invalid or expired reset code' });
    try {
        const user = await User.findOne({ email: value.email });
        if (!user) return invalid();

        const reset = await PasswordReset.findOneAndUpdate({
            userId: user._id,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: 5 },
            resetTokenHash: { $exists: false }
        }, { $inc: { attempts: 1 } }, { new: true });

        if (!reset || !(await bcrypt.compare(value.otp, reset.codeHash))) return invalid();

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        // Only one concurrent verification can exchange this code for a token.
        const result = await PasswordReset.updateOne({
            _id: reset._id,
            codeHash: reset.codeHash,
            expiresAt: { $gt: new Date() },
            resetTokenHash: { $exists: false }
        }, { $set: { resetTokenHash, expiresAt } });
        
        if (result.modifiedCount !== 1) return invalid();

        res.set('Cache-Control', 'no-store');
        return res.status(200).json({ resetToken, expiresIn: 300 });
    } catch (error) {
        next(error);
    }
}

// POST /api/auth/reset-password
export async function resetPassword(req, res, next) {
    const { value, error } = resetPasswordSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const resetTokenHash = crypto.createHash('sha256').update(value.resetToken).digest('hex');
        // Consume the credential atomically so it cannot authorize two password changes.
        const reset = await PasswordReset.findOneAndDelete({
            resetTokenHash,
            expiresAt: { $gt: new Date() }
        });
        if (!reset) return res.status(401).json({ message: 'Invalid or expired reset token' });

        const password = await bcrypt.hash(value.newPassword, 10);
        const result = await User.updateOne({ _id: reset.userId }, { $set: { password } }, { runValidators: true });
        if (result.matchedCount !== 1) {
            return res.status(401).json({ message: 'Invalid or expired reset token' });
        }

        await RefreshSession.deleteMany({ userId: reset.userId });
        res.clearCookie('refreshToken', { path: '/api/auth' });
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({ message: 'Password reset successfully. Please log in.' });
    } catch (error) {
        next(error);
    }
}
