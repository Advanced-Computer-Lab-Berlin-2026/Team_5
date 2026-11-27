import { useEffect, useState } from 'react';
import { listCategories } from '../api/categories.js';

// Every category has a deposit rate (depositMultiplier): when an item is booked, its deposit is multiplied by its category's rate.
// The categories are fetched once per page load and shared by every component that asks.
let cached = null;
const load = () => (cached ??= listCategories()
    .then(data => new Map((data.categories ?? []).map(category => [category._id, category.depositMultiplier ?? 1])))
    .catch(error => { cached = null; throw error; }));

const round = value => Math.round(value * 100) / 100;

// Returns { rateOf(category), depositOf(item) }. Until the rates have loaded, every rate counts as 1.
export function useDepositRates() {
    const [rates, setRates] = useState(null);
    useEffect(() => {
        let alive = true;
        load().then(map => { if (alive) setRates(map); }).catch(() => {});
        return () => { alive = false; };
    }, []);
    const rateOf = category => rates?.get(category) ?? 1;
    return { ready: Boolean(rates), rateOf, depositOf: item => round((item?.depositAmount ?? 0) * rateOf(item?.category)) };
}
