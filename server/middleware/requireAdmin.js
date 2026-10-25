function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'You must be logged in to perform this action.' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
}
export default requireAdmin;