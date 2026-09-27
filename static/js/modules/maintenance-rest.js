/**
 * What stands on the right of a maintenance task: text, urgency and progress.
 *
 * ONE place for the maintenance page and the home page's overview while the
 * printer is off -- both must say the same about the same task.
 *
 * Usage-based maintenance has no due date: converting "every 5 rolls" or
 * "every 720 print hours" into a date via the current consumption rate and
 * showing it as "due in 87 days" next to real due dates is misleading, so
 * these report their count instead. `prints` belongs here too: "every 10
 * prints" is a consumption metric just like hours and rolls.
 */
(function () {
    const text = (key, fallback) =>
        (typeof window.getText === 'function' ? window.getText(key, fallback) : fallback);

    const istVerbrauch = t => t.interval_type === 'hours'
        || t.interval_type === 'filament_rolls'
        || t.interval_type === 'prints';

    function einheit(task) {
        return task.interval_type === 'hours' ? 'h'
            : task.interval_type === 'prints'
                ? text('maintenance_prints_unit', 'Drucke')
                : text('maintenance_rolls_unit', 'Rollen');
    }

    /** Prints are whole numbers, hours are rounded, rolls get one decimal. */
    function zahl(task, n) {
        const stellen = (task.interval_type === 'filament_rolls') ? 1 : 0;
        const sprache = (window.i18nManager && window.i18nManager.currentLang) || undefined;
        return Number(n).toLocaleString(sprache, { maximumFractionDigits: stellen });
    }

    /** {text, art: '' | 'bald' | 'ueber', anteil: 0..100} */
    function restAngabe(task) {
        if (istVerbrauch(task)) {
            const ist = Number(task.progress_current || 0);
            const soll = Number(task.progress_target || task.interval_value || 0);
            const anteil = soll > 0 ? ist / soll : 0;
            return {
                text: `${zahl(task, ist)} / ${zahl(task, soll)} ${einheit(task)}`,
                art: anteil >= 1 ? 'ueber' : anteil >= 0.9 ? 'bald' : '',
                anteil: Math.min(100, anteil * 100)
            };
        }
        const tage = task.days_until_due;
        if (tage < 0) return {
            text: text('maintenance_overdue_days', '{days} Tage überfällig')
                .replace('{days}', Math.abs(tage)), art: 'ueber', anteil: 100 };
        if (tage === 0) return {
            text: text('maintenance_due_today', 'heute fällig'), art: 'bald', anteil: 100 };
        const spanne = parseFloat(task.interval_value) || 30;
        return {
            text: text('maintenance_due_in_short', 'in {days} Tagen').replace('{days}', tage),
            art: tage <= 7 ? 'bald' : '',
            anteil: Math.max(2, Math.min(100, (spanne - tage) / spanne * 100))
        };
    }

    /** "noch 1,2 Rollen" -- what is left of a consumption task that is not
     *  overdue yet; the plain rest text for everything else. */
    function restKurz(task) {
        const rest = restAngabe(task);
        if (!istVerbrauch(task) || rest.art === 'ueber') return rest.text;
        const soll = Number(task.progress_target || task.interval_value || 0);
        const uebrig = Math.max(0, task.progress_remaining != null
            ? Number(task.progress_remaining)
            : soll - Number(task.progress_current || 0));
        return text('home_off_remaining', 'noch {value}')
            .replace('{value}', `${zahl(task, uebrig)} ${einheit(task)}`);
    }

    window.WartungRest = { istVerbrauch, restAngabe, restKurz };
})();
