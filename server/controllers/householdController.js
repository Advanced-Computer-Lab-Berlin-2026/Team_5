import { User } from '../models/User.js';
import { FriendLink } from '../models/FriendLink.js';

const RELATIONS = ['spouse', 'parent', 'child', 'siblings'];

// Returns the trimmed text, or null if it is not a non-empty string
function cleanText(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? text : null;
}

// Finds a member by exact email or phone, but never the logged-in user themselves
function findOtherMember(userId, emailOrPhone) {
    return User.findOne({
        _id: { $ne: userId },
        $or: [{ 'profile.email': emailOrPhone }, { 'profile.phone': emailOrPhone }],
    });
}

// True when both addresses are filled in and equal, so "12 Main St " and "12 main st" match
function sameAddress(first = '', second = '') {
    const a = first.trim().toLowerCase();
    return a !== '' && a === second.trim().toLowerCase();
}

// GET /api/household/search?query=...
export async function searchMember(req, res, next) {
    try {
        const userId = req.user?.id;

        const query = cleanText(req.query.query);
        if (!query) return res.status(400).json({ message: 'Email or phone number is required' });

        const member = await findOtherMember(userId, query);
        if (!member) return res.status(404).json({ message: 'No member found' });

        // only show what is needed to recognise the person
        return res.status(200).json({ member: { username: member.username, name: member.profile.name } });
    } catch (error) {
        next(error);
    }
}

// POST /api/household/requests  body: { emailOrPhone, relation }
export async function sendHouseholdRequest(req, res, next) {
    try {
        const userId = req.user?.id;

        const { emailOrPhone: rawEmailOrPhone, relation } = req.body ?? {};
        const emailOrPhone = cleanText(rawEmailOrPhone);
        if (!emailOrPhone) return res.status(400).json({ message: 'Email or phone number is required' });
        if (!RELATIONS.includes(relation)) return res.status(400).json({ message: 'Invalid relation' });

        const recipient = await findOtherMember(userId, emailOrPhone);
        if (!recipient) return res.status(404).json({ message: 'No member found' });

        const sender = await User.findById(userId);
        if (!sender) return res.status(401).json({ message: 'User not found' });

        if (!sameAddress(sender.profile.address, recipient.profile.address)) {
            return res.status(400).json({ message: 'You must live at the same address' });
        }

        // a link in either direction counts
        const alreadyLinked = await FriendLink.exists({
            $or: [
                { requester: userId, recipient: recipient._id },
                { requester: recipient._id, recipient: userId },
            ],
        });
        if (alreadyLinked) return res.status(409).json({ message: 'A household link already exists' });

        const request = await FriendLink.create({ requester: userId, recipient: recipient._id, relation });
        return res.status(201).json({ message: 'Household request sent', request });
    } catch (error) {
        next(error);
    }
}