import { User } from '../models/User.js';
import { FriendLink } from '../models/FriendLink.js';

const RELATIONS = ['spouse', 'parent', 'child', 'siblings'];

// Returns the trimmed text, or null if it is not a non-empty string
function cleanText(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? text : null;
}

// Finds a member by exact email or phone, but never the logged-in user themselves or an admin
function findOtherMember(userId, emailOrPhone) {
    return User.findOne({
        _id: { $ne: userId },
        role: { $in: ['member', 'lender'] },
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

// GET /api/household/requests/incoming
export async function getIncomingRequests(req, res, next) {
    try {
        const userId = req.user?.id;

        // only requests sent to me that nobody has answered yet
        const requests = await FriendLink.find({ recipient: userId, status: 'pending' })
            .populate('requester', 'username profile.name');

        return res.status(200).json({ requests });
    } catch (error) {
        next(error);
    }
}

// what each decision word turns the status into
const DECISIONS = { accept: 'accepted', decline: 'rejected' };

// PATCH /api/household/requests/:requestId  body: { decision: 'accept' | 'decline' }
export async function respondToRequest(req, res, next) {
    try {
        const userId = req.user?.id;
        const { requestId } = req.params;

        const decision = req.body?.decision;
        if (!Object.hasOwn(DECISIONS, decision)) {
            return res.status(400).json({ message: 'Decision must be accept or decline' });
        }

        // only the recipient can answer, and only while it is still pending
        const request = await FriendLink.findOneAndUpdate(
            { _id: requestId, recipient: userId, status: 'pending' },
            { status: DECISIONS[decision] },
            { new: true }
        );
        if (!request) return res.status(404).json({ message: 'No pending request found' });

        const message = decision === 'accept' ? 'Household request accepted' : 'Household request declined';
        return res.status(200).json({ message, request });
    } catch (error) {
        next(error);
    }
}

// links where I am on either side, as the sender or the receiver
function involvesMe(userId) {
    return { $or: [{ requester: userId }, { recipient: userId }] };
}

// GET /api/household/links
export async function getMyLinks(req, res, next) {
    try {
        const userId = req.user?.id;

        const found = await FriendLink.find(involvesMe(userId))
            .populate('requester', 'username profile.name')
            .populate('recipient', 'username profile.name');

        // for each link, show the other person and whether I sent it
        const links = found.map((link) => {
            // populate gives null when the linked account no longer exists, so use ?. everywhere
            const sentByMe = link.requester?._id === userId;
            const other = sentByMe ? link.recipient : link.requester;
            return {
                _id: link._id,
                relation: link.relation,
                status: link.status,
                sentByMe,
                // member is null for a missing account, so the link can still be seen and removed
                member: other ? { username: other.username, name: other.profile?.name } : null,
            };
        });

        return res.status(200).json({ links });
    } catch (error) {
        next(error);
    }
}

// DELETE /api/household/links/:linkId
export async function removeLink(req, res, next) {
    try {
        const userId = req.user?.id;
        const { linkId } = req.params;

        // only a link I am part of can be removed
        const removed = await FriendLink.findOneAndDelete({ _id: linkId, ...involvesMe(userId) });
        if (!removed) return res.status(404).json({ message: 'Household link not found' });

        return res.status(200).json({ message: 'Household link removed' });
    } catch (error) {
        next(error);
    }
}