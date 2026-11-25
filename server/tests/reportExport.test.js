import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Reservation } from "../models/Reservation.js";
import { DamageReport } from "../models/DamageReport.js";
import { toCsv } from "../services/reportExport.js";

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { aggregate: vi.fn(), find: vi.fn() },
    BLOCKING_STATUSES: []
}));

vi.mock('../models/DamageReport.js', () => ({
    DamageReport: { find: vi.fn() }
}));

const ADMIN_ID = 'admin1';
const USAGE_URL = '/api/admin/reports/usage/export';
const DAMAGE_URL = '/api/admin/reports/damage/export';
const ORIGIN = 'http://localhost:3000';

const usageRows = [
    { itemId: 'ITM-1', name: 'Drill', category: 'Power Tools', reservations: 3, daysReserved: 9, deposits: 600 },
    { itemId: 'ITM-3', name: 'Tent', category: 'Camping', reservations: 2, daysReserved: 6, deposits: 200 }
];

const damageEntries = [
    { _id: 'DMG-1', reservation: 'RES-C', type: 'report', report: {}, createdAt: new Date('2026-09-13T10:00:00Z') },
    { _id: 'DMG-2', reservation: 'RES-C', type: 'resolution', depositForfeit: 50, report: {}, createdAt: new Date('2026-09-15T10:00:00Z') }
];

const damageReservations = [
    { _id: 'RES-C', borrower: '=HYPERLINK("x")', lender: 'martinies', payment: { depositAmount: 100 }, item: { _id: 'ITM-6', name: 'Ladder, tall', category: 'Garden' } }
];

let loggedInRole;

function findUserById(id) {
    return Promise.resolve(id === ADMIN_ID ? { _id: ADMIN_ID, role: loggedInRole, suspended: false } : null);
}

function loginCookie(role) {
    loggedInRole = role;
    return `accessToken=${jwt.sign({ id: ADMIN_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

function asAdmin(req) {
    return req.set('Cookie', loginCookie('admin')).set('Origin', ORIGIN);
}

function fakeQuery(result) {
    const query = { select: vi.fn(), sort: vi.fn(), populate: vi.fn(), lean: vi.fn().mockResolvedValue(result) };
    query.select.mockReturnValue(query);
    query.sort.mockReturnValue(query);
    query.populate.mockReturnValue(query);
    return query;
}

function readBinary(res, done) {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
}

function csvLines(response) {
    expect(response.text.charCodeAt(0)).toBe(0xFEFF);
    return response.text.slice(1).split('\r\n');
}

beforeEach(() => {
    vi.resetAllMocks();

    User.findById.mockImplementation(findUserById);
    Reservation.aggregate.mockResolvedValue(usageRows);
    Reservation.find.mockReturnValue(fakeQuery(damageReservations));
    DamageReport.find.mockReturnValue(fakeQuery(damageEntries));
});

describe('toCsv', () => {
    const columns = [
        { label: 'Name', value: (row) => row.name },
        { label: 'Amount', value: (row) => row.amount }
    ];

    it('writes a header line and one line per row', () => {
        expect(toCsv(columns, [{ name: 'Drill', amount: 10 }])).toBe('Name,Amount\r\nDrill,10');
    });

    it('writes only the header when there are no rows', () => {
        expect(toCsv(columns, [])).toBe('Name,Amount');
    });

    it.each([
        ['a comma', 'Ladder, tall', '"Ladder, tall"'],
        ['a quote', 'The "big" drill', '"The ""big"" drill"'],
        ['a new line', 'line one\nline two', '"line one\nline two"']
    ])('quotes a value with %s', (_case, name, expected) => {
        expect(toCsv(columns, [{ name, amount: 1 }])).toBe(`Name,Amount\r\n${expected},1`);
    });

    it.each(['=SUM(A1)', '+1', '-1', '@cmd'])('stops "%s" from running as a formula', (name) => {
        expect(toCsv(columns, [{ name, amount: 1 }])).toBe(`Name,Amount\r\n'${name},1`);
    });

    it('writes empty cells for missing values', () => {
        expect(toCsv(columns, [{ name: null, amount: undefined }])).toBe('Name,Amount\r\n,');
    });
});

describe('Admin access', () => {
    it.each([USAGE_URL, DAMAGE_URL])('returns 401 for %s when not logged in', async (url) => {
        const response = await request(app).get(`${url}?format=csv`);

        expect(response.status).toBe(401);
    });

    it.each([USAGE_URL, DAMAGE_URL])('returns 403 for %s when the user is not an admin', async (url) => {
        const response = await request(app)
            .get(`${url}?format=csv`)
            .set('Cookie', loginCookie('member'));

        expect(response.status).toBe(403);
        expect(Reservation.aggregate).not.toHaveBeenCalled();
        expect(DamageReport.find).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/reports/usage/export', () => {
    it('downloads the usage report as a CSV file', async () => {
        const response = await asAdmin(request(app).get(`${USAGE_URL}?format=csv&month=2026-09`));

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
        expect(response.headers['content-disposition']).toBe('attachment; filename="usage-report-2026-09.csv"');
        expect(csvLines(response)).toEqual([
            'Item ID,Item,Category,Reservations,Days reserved,Deposits',
            'ITM-1,Drill,Power Tools,3,9,600',
            'ITM-3,Tent,Camping,2,6,200'
        ]);
    });

    it('uses the same filters as the usage report', async () => {
        const response = await asAdmin(request(app).get(`${USAGE_URL}?format=csv&from=2026-09-01&to=2026-09-15&item=ITM-1`));

        expect(response.status).toBe(200);
        expect(response.headers['content-disposition']).toBe('attachment; filename="usage-report-2026-09-01to2026-09-15.csv"');
        const [match] = Reservation.aggregate.mock.calls[0][0];
        expect(match.$match.item).toBe('ITM-1');
    });

    it('downloads the usage report as a PDF file', async () => {
        const response = await asAdmin(request(app).get(`${USAGE_URL}?format=pdf&month=2026-09`)).buffer(true).parse(readBinary);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toBe('attachment; filename="usage-report-2026-09.pdf"');
        expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('still creates a PDF when the month has no reservations', async () => {
        Reservation.aggregate.mockResolvedValue([]);

        const response = await asAdmin(request(app).get(`${USAGE_URL}?format=pdf&month=2026-01`)).buffer(true).parse(readBinary);

        expect(response.status).toBe(200);
        expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it.each([
        ['no format', '?month=2026-09'],
        ['an unknown format', '?format=xlsx&month=2026-09'],
        ['an invalid filter', '?format=csv&month=2026-13']
    ])('returns 400 for %s', async (_case, query) => {
        const response = await asAdmin(request(app).get(`${USAGE_URL}${query}`));

        expect(response.status).toBe(400);
        expect(Reservation.aggregate).not.toHaveBeenCalled();
    });

    it('returns 500 when the database fails', async () => {
        Reservation.aggregate.mockRejectedValue(new Error('Database unavailable'));

        const response = await asAdmin(request(app).get(`${USAGE_URL}?format=csv&month=2026-09`));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

describe('GET /api/admin/reports/damage/export', () => {
    it('downloads the damage report as a CSV file with escaped values', async () => {
        const response = await asAdmin(request(app).get(`${DAMAGE_URL}?format=csv`));

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
        expect(response.headers['content-disposition']).toMatch(/^attachment; filename="damage-report-\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(csvLines(response)).toEqual([
            'Reservation,Item,Borrower,Lender,Status,Disputed,Deposit,Forfeited,Opened,Last update',
            `RES-C,"Ladder, tall","'=HYPERLINK(""x"")",martinies,decided,No,100,50,2026-09-13,2026-09-15`
        ]);
    });

    it('only exports the cases with the chosen status', async () => {
        const response = await asAdmin(request(app).get(`${DAMAGE_URL}?format=csv&status=disputed`));

        expect(response.status).toBe(200);
        expect(csvLines(response)).toHaveLength(1);
    });

    it('downloads the damage report as a PDF file', async () => {
        const response = await asAdmin(request(app).get(`${DAMAGE_URL}?format=pdf`)).buffer(true).parse(readBinary);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it.each(['', '?format=doc', '?format=csv&status=open'])('returns 400 for "%s"', async (query) => {
        const response = await asAdmin(request(app).get(`${DAMAGE_URL}${query}`));

        expect(response.status).toBe(400);
        expect(DamageReport.find).not.toHaveBeenCalled();
    });

    it('returns 500 when the database fails', async () => {
        DamageReport.find.mockImplementation(() => {
            throw new Error('Database unavailable');
        });

        const response = await asAdmin(request(app).get(`${DAMAGE_URL}?format=csv`));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});
