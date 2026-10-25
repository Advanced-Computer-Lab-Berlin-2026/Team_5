import jwt from 'jsonwebtoken';
import joi from 'joi';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js'
import { Member } from '../models/Member.js';

const PHONE_NUMBER_REGEX_PATTERN = /^\+[1-9]\d{1,14}$/;

const memberSchema = joi.object(
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
export async function registerMember(req, res, next){
    try{
        const { value, error } = memberSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.message });

        const existing = await Member.findOne({ $or: [{username:value.username}, {email:value.email}] });
        if (existing) return res.status(409).json({ message: "Username or Email already exists"});

        const password = await bcrypt.hash(value.password, 10); 
        await Member.create({ username: value.username, name: value.name, email: value.email, password: password, phoneNumber: value.phoneNumber || "", homeAddress: value.homeAddress || "" }); 
        
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

        const user = await Member.findOne({ username: value.username })
        if (!user) return res.status(401).json({ message: "Username or Password is incorrect!"});
        
        const passwordMatches = await bcrypt.compare(value.password, user.password);
        if (!passwordMatches) return res.status(401).json({ message: "Username or Password is incorrect!"});
 
        const token = signToken(user);
        res.status(200).json({ token, user: publishUser(user)});
    } catch(error){
        next(error);
    }
}

function signToken(user){
    const payload = {id: user._id.toString(), username:user.username};
    return jwt.sign(payload, env.jwtSecret, { expiresIn: '12h'} );
}

function publishUser(user){
    return {
        id: user._id.toString(),
        username: user.username,
        name: user.name,
        email: user.email
    };
}