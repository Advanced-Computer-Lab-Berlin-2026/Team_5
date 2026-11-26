// missing fields on old users count as on — same as the schema defaults
export function normalizeEmailPreferences(prefs) {
    const values = prefs ?? {};
    return {
        reservations: values.reservations ?? true,
        promotions: values.promotions ?? true,
        communityNotices: values.communityNotices ?? true
    };
}