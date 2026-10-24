import joi from 'joi';
import bcrypt from 'bcrypt';
import { Member } from '../models/Member.js';

const PHONE_NUMBER_REGEX_PATTERN = /^\+[1-9]\d{1,14}$/;

const memberSchema = joi.object(
    {
        username: joi.string().trim().min(6).max(20).required(),
        name: joi.string().trim().min(2).max(20).required(),
        email: joi.string().trim().email().required(),
        password: joi.string().trim().min(6).max(40).required(),
        phoneNumber: joi.string().pattern(PHONE_NUMBER_REGEX_PATTERN).allow(''),
        homeAddress: joi.string().allow('')
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

// function publishUser(user){
//     return {
//         id: user._id.toString(),
//         username: user.username,
//         name: user.name,
//         email: user.email
//     };
// }