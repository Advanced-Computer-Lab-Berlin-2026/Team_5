// Answers 404 for any URL that no route matched
export function notFound(req, res) {
    res.status(404).json({ message: 'Endpoint not found' });
}

// Turns any error into a JSON response. Server errors (500+) get a general message so details like database errors never reach the browser; they are logged instead.
// Express spots an error handler by its 4 parameters, so `next` must stay even though it is unused.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);

    const message = status >= 500 ? 'Server Error' : err.message;
    res.status(status).json({ message });
}